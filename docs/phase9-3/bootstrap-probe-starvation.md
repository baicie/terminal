# Phase 9.3 — bootstrap 配置探测饥饿与测量收尾竞态

> 分支 `feat/phase9-2-sync-security-hardening`，起点 `9e0a75e`（Phase 9.2 收尾后）。
> 采集与验证时间 2026-11-03。所有数字均来自本文列出的真实 run，可复核。
>
> **状态口径**与 Phase 9.2 一致：PASS / FAIL / NOT_RUN / BLOCKED_EXTERNAL，不用「基本完成」这类表述。

## 1. 这两条缺陷是怎么被发现的

Phase 9.2 收尾时 CI 已经在 HEAD `9e0a75e` 上 **10/10 全绿**。
但**定时**实机矩阵 run `41437956656`（main `2f1d68f`）红了一条：

```
[ssh/default/nano-edit] running...  tauri app starting up
  startup: db bootstrap stage=frontend-boot detail=main.tsx evaluated
  ...
  startup: db bootstrap stage=session-create-requested detail=local
 FAILED: nano-edit shell probe result timed out after 60000 ms:
         the app never wrote result.json
```

`detail=local` 是决定性线索：探针请求的是 **remote** 会话，出现 `local` 说明挂载的是
**普通 App**，不是 shell probe 根组件。同 run 其余 6 条用例都正常打印
`input_probe_config invoked`，只有这一条整段**没有任何 probe 配置 IPC 到达 Rust**。

这条失败与产品功能无关，但它让证据采集链断掉，所以必须查到底。

## 2. Issue #166：五个配置探测串行共享 1 秒预算

### 2.1 根因

`bootstrapTerminalApp` 依次 await 五个配置读取：

```
terminal_smoke_config → remote_prompt_probe_config → input_probe_config
                      → raw_input_probe_config   → shell_probe_config
```

它们共用**同一个绝对截止时间** `attemptStartedAt + 1000 ms`
（`BOOTSTRAP_CONFIG_DEADLINE_MS`）。而 `loadBootstrapConfig` 只要发现预算已耗尽，
就**不调用加载器**、直接返回 `null`。

于是冷 WebView 的第一次 IPC 只要慢一点，后面所有加载器都**没有被调用过**，
全部得到 `null`，bootstrap 判定「没有任何探测启用」，静默挂载普通 App。
应用没有任何日志说明遇到了什么——只能从 `detail=local` 反推。

**这是队列饥饿，不是预算不够。** 把 1 秒改成 8 秒只会降低概率；排队结构本身
仍然让第一个慢调用吃掉后来者的全部机会。

### 2.2 修复

`packages/frontend/src/terminal-bootstrap-deadline.ts`：

```ts
const [remotePrompt, inputProbe, rawProbe, shellProbe] = await Promise.all([
  loadBootstrapConfig(loaders.remotePrompt, deadlineAt, signal),
  loadBootstrapConfig(loaders.inputProbe, deadlineAt, signal),
  loadBootstrapConfig(loaders.rawProbe, deadlineAt, signal),
  loadBootstrapConfig(loaders.shellProbe, deadlineAt, signal),
])
```

`terminal-bootstrap.tsx` 让 smoke 门与这四个**同时开始**：smoke 结果先判定，
非 smoke 时再 await 那四个已完成/在途的 Promise。

语义不变的部分：**每个加载器仍各自在同一个绝对截止时间放弃**。
改变的是：慢的不会拖死快的，也不会拖过全局预算。

### 2.3 回归（先红后绿）

| 测试 | 断言 | 串行实现下 |
| --- | --- | --- |
| `starts every optional config loader before any of them settles` | 一个宏任务后四个加载器都已被调用 | ❌ 红（仍停在第一个 unresolved promise） |
| `still resolves a later optional loader when an earlier one hangs` | 前面悬挂时 `shellProbe` 仍拿到自己的配置 | ❌ 红（得到 `null`） |
| `mounts the normal app when probe config IPC never settles…` | 既有断言改为 `loadRawProbeConfig` / `loadShellProbeConfig` **各被调用一次** | 原断言 `not.toHaveBeenCalled()` 冻结的正是缺陷行为 |

区分力是实测的：把 `loadOptionalBootstrapConfigs` 临时改回串行，前两项都变红；恢复后 4/4 通过。

### 2.4 真实验收

run `41478709578`（sha `3102093`）的 `Run the shell interaction matrix over real SSH`：

```
[ssh/default/nano-edit] running...  input_probe_config invoked
 ok (4770 ms)
```

全矩阵 **40 个 probe 用例 `ok`，0 个 FAILED**（macOS 本地 14 + 真实 SSH 7 + Linux 14 + Windows 5）。
证据文件里 `nano-edit` 两条（bash / zsh）均为 `ok: true`，4678 / 4675 ms。

## 3. Issue #167：测量成功后被清理阶段判红

同一次 `41475640293` 的 Linux job，失败在：

```
ENOTEMPTY: directory not empty, rmdir '.../.cache/mesa_shader_cache'
```

但日志显示应用把**全部** SSH 启动阶段走完（`ssh-tcp-handshake-done` →
`ssh-auth-done` → `ssh-pty-ready` → `ssh-shell-first-output` →
`ssh-startup-write-done` → `session-created`）。失败发生在 `finally` 的目录清理，
**测量结果已经算出来了**。

WebKitGTK 关闭后仍会有一小段时间在写 Mesa 着色器缓存，裸 `rm` 与那个子进程竞争。
`run-terminal-shell-probe.mjs` 早在 Issue #156 的修复里就为同一原因用过
`maxRetries: 20 / retryDelay: 100`，但冷启动的三个脚本从未同步这个策略。

修复：把策略提为 `run-cold-start-stopwatch.mjs` 导出的
`MEASUREMENT_DIRECTORY_CLEANUP_OPTIONS`，三处清理统一使用
（本地 `runDirectory`、远程 `runDirectory` + `home`、stopwatch 自建 `home`）。

回归钉住 `rm` 的 `maxRetries = 20` / `retryDelay = 100`；去掉策略后该用例变红，
恢复后三个冷启动测试文件 **55 项全过**。run `41478709578` 上该步骤通过。

**教训**：采集链的红要先确认**测量本身**是否已完成，再判断是不是产品回归。
`ENOTEMPTY` 与产品毫无关系，但它出现在证据采集链里，就足以让 6 份证据生成不出来。

## 4. 证据重采（Issue #168）

Issue #166 改了 `packages/frontend/src`，在 `FINGERPRINT_PATHS` 内，
旧证据（run `41434165000`，指纹 `365bdee7…`）立即失效，
`check-verification-evidence.mjs` 报 **7 problem / exit 1**——门禁在正确工作。

重采 run `41478709578`（sha `3102093`）三平台 3/3 success，macOS job 25 步全 success。

| 指标 | 旧证据（`a093fc7`） | 新证据（`3102093`） |
| --- | --- | --- |
| 源码指纹 | `365bdee7…` | **`c4faedfb…`** |
| debug 本地冷启动 | 7679 / 4042 / 3301 ms | **1944 / 1330 / 1323 ms** |
| release 本地冷启动 | 4692 / 3621 / 3128 ms | **2283 / 2074 / 1959 ms** |
| debug 远程冷启动（提示符） | 5061 ms | **3158 ms** |
| debug SSH 矩阵 | 11/11 | **11/11** |
| release SSH 矩阵 | 8/8 | **8/8** |
| shell 交互用例 | 14/14 | **14/14** |

**不得把冷启动数字下降解读为产品优化**：本阶段没有改冷启动路径，差异来自 runner 实例。

## 5. 中间一次失败 run 的定性（`41475640293`）

这一轮**同时**踩到 Issue #167（Linux，已修）与 macOS 远程冷启动超时：

```
terminal readiness did not complete within 10000 ms
(last probe: {"windowReady":false,"terminalReady":false,"markerReady":false})
(stages: frontend-boot@0ms → ... → ready@1081ms; first stage at 2678 ms)
```

**为什么判定不是本轮引入的回归**：
- 同 run 的本地冷启动三次全部正常（6234 / 4003 / 3534 ms，`readyAt: terminal`），
  说明二进制与 WebKit 本身能正常启动；
- 失败那一次整段没有任何应用自身的 tracing 输出，只有探测器报告，
  符合「WebView 主框架未完成加载」的形态（Issue #65 / #157 记录的同一类别）；
- 历史 4 次 run（`41231265959`、`41191060486`、`41112206442`、`41109246774`）
  该步骤全部 success；
- 同一提交的下一次 run `41478709578` **通过**。

**但这不等于「已证明稳定」**：Phase 9.0 记录的约 20% WebKit `-1004` 加载失败率
仍然没有被修复。这条风险继续开着，见 Issue #157 与 `docs/phase9-2/shell-and-webview-stability.md` 2.4。

## 6. 状态

| 项 | 状态 | 依据 |
| --- | --- | --- |
| Issue #166 修复 | ✅ **PASS** | run `41478709578`：`nano-edit` ok，40 个 probe 用例 0 FAILED |
| Issue #167 修复 | ✅ **PASS** | 同 run Linux job success |
| Issue #168 证据重采 | ✅ **PASS** | 指纹 `c4faedfb…`，门禁 0 problem exit 0 |
| macOS WebKit 冷启动稳定性 | ⚠️ **未证明** | 本轮 2 次 run 里 1 次失败，约 20% 的历史失败率未被排除 |
| 前端依赖漏洞审计 | 🔴 **NOT_RUN** | 沿袭 Phase 9.2：镜像源不提供 audit 端点 |

**可以声称**：`nano-edit` 的「从未写 result.json」有一个确定的根因，且该根因已修复并在真实 runner 上验收。

**不得声称**：macOS 远程冷启动已经稳定。本轮 2 次 run 里 1 次失败，样本不足以排除历史失败率。
