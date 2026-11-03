# macOS WebView 冷启动根因

> 日期：2026-11-03
> 基线：`44ae449` + Phase 9.4 压力工具

## 1. 历史证据

Phase 9.3.1 统计 16 次 real-machine run：

| 结论 | 次数 |
| --- | --- |
| success | 12 |
| failure | 3 |
| 日志过期无法判定 | 1 |

可判定失败率 **3/15 = 20%**。

已知失败不是同一种：

1. **WebView 一阶段都没有**：`stages: none recorded`，Issue #65 曾在非 smoke
   二进制上抓到 `didFailProvisionalLoadForFrame ... code=-1004`。
2. **DB ready 后停滞**：run `41475640293`
   `frontend-boot@0ms -> ... -> ready@1081ms`，之后 6 秒无阶段。
3. 早期两次失败日志只有 `terminalReady:false`，连阶段插桩都没有。

因此不能把历史 20% 全部归因成 `-1004`。

## 2. 五段判据

Phase 9.3.2/9.4 把冷启动拆成独立可观测阶段：

| 段 | 阶段 | 说明 |
| --- | --- | --- |
| 1 | `frontend-boot` | WebView 是否执行了 bundle |
| 2 | `ready` | 数据库 bootstrap 是否完成 |
| 3 | `terminal-mounted` | xterm 是否完成 open，携带 `tabId@workspaceId` |
| 4 | `session-create-requested` → `session-created` | 是否真的请求并建立了会话 |
| 5 | SSH prompt marker | 端到端 shell 是否可用 |

`terminal-mounted` 在 `term.open()` 与 viewport attach 之后发出，不表示 PTY/SSH
已建立；`open()` 抛错时不会发出。重复挂载会重复发出，分析脚本使用**首次**
`terminal-mounted`。

## 3. 本轮 30 次真实样本

工作流：`Cold-start stress` run `41601372583`
（`a1bd3b6`，instrumented debug binary
`613aeab7156350546b92d9a194f1bd4922986d5e1a7166b53bf0e099195f4b9f`）。

| 指标 | 值 |
| --- | --- |
| 样本 | 30 |
| 成功 | 30 |
| 失败 | 0 |
| 成功率 | 100% |
| spawn→ready 最小 / 中位 / p95 / 最大 | 3393 / 3512 / 3819 / 4858 ms |

阶段出现次数：

```text
frontend-boot=30 ready=30 terminal-mounted=30
session-create-requested=30 session-created=30
```

分段耗时（30 次）：

| 边 | 最小 | 中位 | p95 | 最大 |
| --- | --- | --- | --- | --- |
| `ready → terminal-mounted` | 389 | 406 | 426 | 740 ms |
| `terminal-mounted → session-create-requested` | 56 | 87 | 104 | 255 ms |
| `session-create-requested → ssh-connect-start` | 1 | 2 | 6 | 12 ms |

30/30 中 `session-create-requested` 均早于 `ssh-connect-start`，无因果倒置。

## 4. 统计边界

30 次全过**不能**证明失败率低于 1%。若真实失败率仍为 20%，30 次全过的概率约为
`0.8^30 ≈ 0.12%`；但这不是“失败率已经为 0”的证明。0/30 的单侧 95% 置信上界约为
**9.5%**，仍高于 RC 目标。

300 次扩展样本（run `41602408642`，commit `8542ca5`）结果：

| 指标 | 值 |
| --- | --- |
| 成功 / 失败 | 289 / 11 |
| 点估计失败率 | **3.7%** |
| Wilson 95% 失败率上界 | **约 6.4%** |
| spawn→ready 中位 / p95 / 最大 | 4602 / 6143 / 8814 ms |

失败不是单一形态：

- 5 次 `terminal-not-mounted`：`ready` 已到，但 9.5 秒内 xterm 没挂载；
- 1 次 `terminal-mounted@8756ms`：挂载太晚，已没有会话请求窗口；
- 5 次 `ssh-path`：`session-created` 已出现，但 prompt marker 未在 10 秒内出现。

这 300 次使用的是 1 秒 probe 配置预算的 `8542ca5`；其中 5 次 `ssh-path`
可能受 `remotePrompt` gate 超时影响。修复后的 `44ae449` 需要复测，不能把
11 次失败全部归因于 WebKit。**3.7% 仍不满足高可靠 RC**，历史 20% 也未得到
“已修复”的证明。

## 5. 根因状态

| 项 | 状态 |
| --- | --- |
| 五段诊断链 | **PASS**（30/30 阶段完整） |
| 30 次真实重复测量 | **PASS**（30/30） |
| 修复前 300 次 | **FAIL**（289/300，3.67%） |
| 修复后 A 300 次 | **FAIL**（293/300，2.33%） |
| 修复后 B 300 次 | **FAIL**（291/300，3.00%） |
| 修复后 C 300 次（含产品修复） | **FAIL**（294/300，2.00%） |
| 修复后 D 300 次（第二次产品修复后） | **FAIL**（282/300，6.00%） |
| 修复后 E 300 次（late-tab + open 诊断后） | **FAIL**（294/300，2.00%） |
| 历史 20% 失败根因 | **NOT_RUN / 未完全复现** |
| WebKit Unified Log 失败回调 | **NOT_OBSERVED**：7 份/9 份失败日志里都没有 `didFail`、渲染进程退出或 WebKit 崩溃 |
| 失败阶段分类 | **PASS**（见 `cold-start-statistics.md` §3.4） |
| 恢复出的远程 tab 被本地 fallback 抢占 | **FIXED**（`app-startup-recovery.ts`） |
| tab 短暂缺失时默认启动本地 PTY | **FIXED**（`use-terminal-session-binding.ts`） |
| 失败对与 `log show` 窗口重合 | **CONFIRMED 相关性**，机制未完全证明 |

**不能**把 30/30 写成“20% 失败已修复”。300 次样本把当前失败率点估计压到 3.7%，
修复后仍为 2.33% / 3.00%，高于 1%，且失败形态至少两类。当前证据只能证明诊断链
能把失败定位到 `terminal-mounted` 前后，不能证明根因已消除。

## 6. 修复后的具体根因证据

### 6.1 `terminal-not-mounted` 不是 WebKit 崩溃

失败样本的 WebKit 日志里，主进程仍有页面加载、渲染树和图层树事件；完整日志中
没有 `didFailProvisionalLoadForFrame`、`processDidExit`、渲染进程崩溃或 Tauri 主进程
提前退出。`terminal-mounted` 缺失发生在 React 层，不是 `-1004`。

按现有证据只能确认：`ready` 之后、`useTerminalInstance` 的 effect 执行之前，终端
视图在 10 秒预算内没有完成挂载。组件没有抛出可观测错误，因为
`term.open()` 抛错时同样会被误报成“never mounted”。

### 6.2 `ssh-request-not-entered-rust` 的确定性来源

两次修复后运行的 9 个 `ssh` 失败中，6 个没有 `ssh-connect-start`。其中一组样本的
`session-created@2649ms` 出现在 `session-create-requested@2512ms` 之后约 137 ms，
但整个时间线没有任何 SSH 阶段；这与 SSH 握手、认证或 PTY 失败都不相容。

审查发现两条会把远程 tab 变成本地 PTY 的产品路径：

1. `useStartupWorkspaceRecovery` 只有在 host 列表已加载时才把远程 tab 视为可用。
   主机查询最长 1.5 秒，fallback timer 随后触发；布局已恢复但 host 查询未完成时，
   App 会额外添加 `startupFallback` 本地 tab 并抢走 active tab。
2. `useTerminalSessionBinding` 在 `tab === undefined` 时用 `?? 'local'` 启动本地 PTY。
   工作区切换或布局恢复的瞬时窗口里，这会让一个远程 tab id 对应 `session_create_local`，
   于是时间线出现 `session-created` 却永远没有 SSH 阶段。

两条路径都已修复并有前端回归：远程 tab 只要求自身 `hostId` 存在，不再要求 host
查询已完成；`tab` 缺失时 session hook 保持 `enabled: false`，直到 tab 恢复。

**证据边界**：这两条路径解释“已创建会话但没有 SSH 阶段”的机制，但旧样本没有记录
`session-created` 的 detail（仅成功结果有 stages detail），因此不能把 6 个样本逐一
认定为本地 PTY。修复需要用新构建重新采样验证，不能用推理代替实机结果。

### 6.3 成对失败与 `log show` 强相关

两次修复后运行的失败样本以固定成对出现（A：69/70、208/209；B：106/107、
190/191、201/202、293/294）。每对内部间隔 12.4–14.6 秒，正常样本约 5–6 秒；
失败样本之间的额外时间正好与 workflow 执行 `log show` 的窗口重合。

这说明测量夹具会影响后续样本。旧 workflow 用 `log show --last 4m` 采集失败证据，
它会把前一进程的日志并进来，同时延长下一次启动前的间隔。当前 workflow 已把窗口
收窄到该样本自己的 `capturedAt` 起 20 秒，并在 provenance 中记录环境；但这只修正
证据归属，**没有证明**驱动层/WebKit 的跨样本资源隔离已经干净。剩余问题保留为
P1 残余风险，不得用相关性替代机制证明。

### 6.4 跨样本隔离现状

已确认：

- stopwatch 在每次样本结束后对 Tauri 主进程发 SIGTERM，3 秒内不退出则 SIGKILL，
  并等待 `close` 事件；本次审查没有发现主进程存活到下一轮的日志。
- 每次样本使用独立 `mkdtemp` HOME、独立 SQLite 与独立 loopback sshd 临时目录。
- 失败样本日志的时间窗内没有发现上一轮 `terminal` 主进程仍在运行。

未确认：

- WebKit WebContent/GPU 子进程在父进程退出后的完整回收时序；
- 端口、socket、文件锁在下一轮开始前的残留；
- 人为超时后下一轮是否仍从干净状态运行（尚无自动化负面测试）。

因此不能声称“跨样本隔离已闭合”。新增的日志时间窗与 provenance 是让下一次采样
能回答这些问题的前提，不是答案。

## 7. 修复后 C 轮的新事实

run `41637922942` 在 `0ba671e` 上运行，包含两条产品修复。失败降到 6 个（2.00%），
但失败仍严格成对：`189/190`、`260/261`、`287/288`。每对中的第一条是
`terminal-not-mounted`（最后阶段 `ready`），第二条是 `ssh-request-not-entered-rust`
（最后阶段 `session-created`，没有任何 SSH 阶段）。

这说明：

- 本地 fallback 与 tab 缺失两条路径的代码修复**没有消除这 6 个失败**；它们可能解释
  了“session-created 却无 SSH stage”的旧形态，但不能解释第一条的挂载失败，也不能
  证明成对失败已经消失。
- 成功样本的 SSH 阶段完整（`ssh-connect-start → … → ssh-pty-ready →
  ssh-shell-first-output → ssh-startup-write-done → session-created`），
  所以第二条失败不是整体 SSH 服务不可用。
- 失败对间隔从旧 run 的 12–15 s 降到约 11 s，仍显著高于正常样本的 5–6 s。
  这与 `log show` 的采集窗口、以及失败后的额外进程清理时间一致，但机制仍未证明。

不得把 294/300 写成“修复成功”。它只把失败率从 2.33–3.00% 降到 2.00%，仍未达到 1%
的 RC 目标，也仍不满足“稳定”的定义。

## 8. 修复后 D：挂载竞态被确认，但采样条件仍不可信

run `41644270883`（`fda76ae`）为 **282/300（6.00%）**，比上一轮更差。失败结构
仍是相同的两段式：前一条 `terminal-not-mounted`，后一条
`ssh-request-not-entered-rust`。

这一轮的价值在于暴露了 `terminal-mounted` 缺失的确定性代码缺陷：

- `useTerminalInstance` 的 effect 依赖只有 `[tabId, workspaceId]`。容器先于 tab
  恢复渲染时 `containerRef.current` 为空，effect 直接 return；tab 随后出现但
  effect 不重跑，xterm 永远不会 `open()`。
- `term.open()` 抛错会跳出 effect，与“从未挂载”在阶段上不可区分。

两者都已修复：`tabAvailable` 参与依赖；`term.open()` 失败记录为
`terminal-open-failed`，并新增 `terminal-open-start` / `terminal-open-done`
证据。由于修复后尚未完成一次测量脚本可靠的 300 次采样，不能把这轮 18 个失败
算作已消除。

同一轮还证明测量链本身必须 fail closed：

- 样本内 `sourceSha` 全为 null；
- `cold-start-build.json` 声称 `instrumentedBuild=false`，provenance 却硬编码 true；
- 所有失败样本的 WebKit 日志为 0 字节（`log show` 的日期格式/时区处理错误）。

这些缺陷已经修复，并在 provenance 中加入“失败样本必须有非空 WebKit 日志”的
硬失败，避免“没有证据”被静默当成“没有 WebKit 失败”。

## 9. 修复后 E：分类终于可自证

run `41674133535`（`b5c7f46`）的 `terminal-mounted` detail 已带上 tab 类型，
6 个失败第一次可以逐条说清：

| 类型 | 样本 | 证据 |
| --- | --- | --- |
| 容器未出现 | `122, 194, 292` | 只有 `ready`，连 `terminal-open-start` 都没有 |
| 本地 fallback | `195, 293` | `terminal-open-*` 和 `terminal-mounted` 的 detail 都是 `local-...@...@local` |
| SSH prompt 未完成 | `1` | `ssh-startup-settle@3609ms` 后无 `ssh-startup-write-begin` |

这证明两件事：

1. “session created 但没有 SSH stage”不一定是 SSH 问题；E 轮有 2 个明确是本地
   fallback 会话。旧分类把它们叫 `ssh-path` 是错的。
2. `terminal-not-mounted` 仍有 3 个发生在 `terminal-open-start` 之前，说明 late-tab
   effect 修复没有覆盖“容器/tab 本身没有出现”的上游路径，根因仍未闭合。

不能把 294/300 写成修复成功：失败率仍 2.00%，且这三类失败分别需要不同的修复。
