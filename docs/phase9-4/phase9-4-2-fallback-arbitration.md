# Phase 9.4.2 — 启动恢复仲裁与证据收口

> 日期：2026-11-04
> 审查基线：`760096341d0273c3833a5244ff2cb522fbcdeb08`（F 轮）
> 状态：**代码与本地门禁完成，真实 runner 复测与证据重采待执行**

## 1. 本阶段要回答的问题

F 轮 run `41683645429` 的 298/300（0.67%）不是结尾：

- 2 个失败（样本 228/229）都挂载了 `local` tab，298 个成功样本全部挂载 `remote`。
- 两个失败的 `terminal-open-start` detail 都是
  `local-1793728115282@remote-cold-workspace@local`。
- 需要证明：这是产品恢复竞态、测量污染，还是 WebKit 崩溃。

## 2. 已确认的事实

### 2.1 fallback 截止时间被错传成 8 秒（确定性缺陷）

`terminal-bootstrap.tsx` 把 `startupDeadlineAt`（`attemptStartedAt +
BOOTSTRAP_APP_DEADLINE_MS` = 8 s，用于 App chunk 加载）直接作为
`startupTerminalFallbackAt` 传给 App。`BOOTSTRAP_TERMINAL_FALLBACK_MS = 2_000`
只有定义、没有调用点。

因此生产启动的本地 fallback 在 **attempt 开始后约 8 秒**才触发，而不是 2 秒。
F 轮样本 228 的本地 tab id 是 `local-1793728115282`，对应
`2026-11-03T17:48:35.282Z`；frontend boot 在 `17:48:27.05` 左右，正好约 8.2 秒。
10 秒探针只剩不到 2 秒给本地会话。

**修复**：`startupTerminalFallbackAt = attemptStartedAt +
BOOTSTRAP_TERMINAL_FALLBACK_MS`（2 秒）；App chunk 仍使用 8 秒 deadline。

### 2.2 跨样本污染：WKWebView localStorage 不在 per-sample HOME 里

样本 228 与 229 的 `terminal-open-start` detail 携带**完全相同的**本地 tab id
`local-1793728115282`。该 id 的时间戳 `17:48:35.282Z` **早于样本 229 的
`capturedAt` `17:48:37.399Z`**——样本 229 不可能自己生成这个 id。

WKWebView 的 localStorage 位于真实用户目录
`~/Library/WebKit/com.baicie.termius/WebsiteData/LocalStorage`，不受采样进程
`HOME` 重定向影响。恢复 journal 的键是
`terminal.workspace.recovery.v1.<workspaceId>`，而 fixture 的 workspaceId
恒为 `remote-cold-workspace`。于是：

1. 样本 228 在 8 秒 fallback 后创建 local tab，`schedule()` 立即把 local-only
   布局写入 journal。
2. 样本 229 启动时读到同一 journal；旧逻辑让 journal 优先于 SQLite，restore 了
   `local-1793728115282`。
3. 样本 229 的远程布局仍在 SQLite 里，但从未被读取。

这解释了 F 轮的两个失败为什么**相邻**，也解释了此前多轮的“失败成对”形态。

**修复（产品）**：

- 本地-only journal 不再遮蔽 SQLite 中含 remote tab 的布局；被丢弃的 journal 会被删除。
- layout 读取失败/超时不再被当作“没有布局”；此时不返回 recovery handle，也就不会
  订阅并写回 local-only 快照。
- “布局存在但没有任何可恢复 tab”抛错并重试，而不是按 absent 处理。

**修复（测量）**：

- stress workflow 在每个样本前删除
  `~/Library/WebKit/com.baicie.termius`、
  `~/Library/Caches/com.baicie.termius`、
  `~/Library/HTTPStorages/com.baicie.termius`。
- 新增 `verify-cold-start-isolation.mjs`：先跑一次 1 ms 的强制超时样本，再跑一次
  正常样本，断言临时目录已删除、fixture 端口不同、二进制 SHA 相同。

### 2.3 恢复链的其它确定性缺陷

| 缺陷 | 后果 | 修复 |
| --- | --- | --- |
| `loadLayout` 异常被 `console.warn` 吞掉 | 读取失败被当成“无布局”，不重试 | 抛错，交给 App 的有界重试 |
| workspace / layout 查询无超时 | 一次 IPC 不返回会让 recovery 永不 settle | 3 s 超时，超时按失败处理 |
| `loadHosts` 的 generation 去重 | 并发调用可能让本次结果被丢弃，`hostsLoaded=true` 但 hostIds 为空，远程 tab 被过滤 | `loadHosts` 返回本次行；`null` 表示结果不可用，远程 tab 保留 |
| `canReplaceStartupFallback` 全有或全无 | 用户输入过 fallback 后，远程布局整体不恢复 | 用户输入过的 fallback 与远程布局合并，保留用户 tab 和 active tab |
| 程序化写入清除 `startupFallback` | snippet / 命令面板 / 移动键栏被误当作用户接管 | `TerminalInputDiagnosticEvent.wasUserInput`；只有真实 xterm 输入才标记 owned |

### 2.4 WebKit 日志的判读

`CRASHSTRING: rdar://problem/28724618 Couldn't connect to launchservicesd.` 在
样本 228/229 都出现，但：

- 同一 PID 之后仍有日志输出；
- 没有 `processDidExit` / `didCrash` / `SIGKILL`；
- 没有成功样本对照（F 轮只为失败样本采日志）。

**结论：不能判为 WebKit 崩溃。** 它更可能是启动早期的 launchservices 连接异常，
与恢复竞态同时出现，但不是已确认的因果。新 workflow 会为前 2 个成功样本采集
同样的日志，并在 `provenance.json` 中记录 `crashStrings` / `processExits` 计数。

## 3. 状态机

新增 `startup-recovery-arbiter.ts`，把 fallback 决策从 `tabs.length === 0` 改为
显式输入：

- `deadlineElapsed`：2 秒 fallback 截止是否已到。
- `deferBudgetElapsed`：在有界 defer（2 秒）之后是否已到。
- `recoveryActive` / `retryScheduled`。
- `layoutState`：`unknown` / `pending` / `known` / `absent` / `failed`。
- `usableTerminal` / `fallbackOpened`。

决策优先级：

1. 已有可用终端 → `suppress`。
2. 未到截止 → `defer`。
3. defer 预算耗尽 → `create`（防止一个卡死的查询让窗口永远空白）。
4. 布局**确定不存在** → `create`。
5. recovery 进行中 / 重试待执行 / 布局仍在读取 → `defer`。
6. 布局确定失败 / 已知布局但没有可用 tab → `create`。

正常启动仍在截止前恢复并清掉 timer；只有“无法确定布局”的启动才会用满 defer
预算。没有把 2 秒简单改成 4 秒。

## 4. 分段 trace

恢复链新增以下阶段，全部带 `correlationId`（不包含 host / 凭据）：

`workspace-load-start/done/failed`、`layout-load-start/done/failed`、
`layout-absent`、`host-load-start/done/failed`、`recovery-layout-available`、
`restore-layout-committed`、`restore-layout-skipped`；
App 侧新增 `fallback-deadline-reached`、`fallback-decision`、
`fallback-defer-expired`、`fallback-opened`、`workspace-recovery-retry`、
`workspace-recovery-failed`；恢复提交后记录 `active-tab-selected`。

下一轮失败样本可以直接回答：布局是否读到、host 是否返回、fallback 是
`created` / `suppressed` / `deferred`，以及哪个 correlation id 对应哪次恢复。

## 5. Provenance 与证据链

- 失败样本现在也带 `binarySha256`、`stages`、`probe`、`fixture`、
  `shell`/`shellIntegration`、`marker`/`promptMarker`、`tempDirectories`。
- `cleanup` 失败不再替换 readiness 主错误；`cleanupError`/`cleanupErrors` 附在错误上。
- parent SHA 解析区分 `git` / `unknown`，并记录
  `shallow-checkout` / `root-commit` / `command-failed`；workflow checkout 改为
  `fetch-depth: 2`。
- 汇总器新增 `--require-provenance`、`--expected-binary-sha256`、
  `--expected-source-sha`、`--expected-timeout-ms`、`--require-mount remote`；
  跨样本 SHA 矛盾、缺失、timeout 不一致、成功样本挂 local tab 都会 fail closed。
- 因果违例的样本 verdict 改为 `MEASUREMENT_INVALID`，不再可能得到
  `RELIABILITY_PASS`。

## 6. 本地验证

| 门禁 | 结果 |
| --- | --- |
| 前端全量 | **153 文件 / 1393 项** 全部通过 |
| 新增仲裁器测试 | 12 项 |
| 冷启动脚本测试 | **83 项**（含隔离验证 3 项、provenance 门禁测试） |
| TypeScript | `tsc --project tsconfig.json --noEmit` 通过 |
| ESLint | 改动文件全部通过 |
| source-size | **568 个生产文件**通过 |
| actionlint | `cold-start-stress.yml` 通过 |
| 本机真实回归（非 CI 证据） | **10/10 remote、0 local**；中位 3475 ms、p95 3998 ms；严格 provenance 汇总通过 |
| 本机隔离验证（非 CI 证据） | **ISOLATION_PASS**：强制 1 ms 超时样本 + 正常样本；临时目录已删除、fixture 端口不同、binary SHA 相同 |

本机回归使用的二进制由**未提交工作树**构建（`sourceTreeClean=false`），只能证明
产品路径在开发机上工作，不能替代真实 runner 证据。

## 7. 仍未完成（不能写成 PASS）

1. 在真实 runner 上重跑多轮 300 次样本；当前只有本地单元/脚本证据。
2. 用新的分段 trace 证明样本 228 的 recovery 到底停在哪一步。
3. 成功样本 WebKit 对照日志是否出现同样的 `CRASHSTRING`；目前只是已采集，未判读。
4. 故意超时的真实 runner 隔离样本（workflow step 已就绪，未执行）。
5. 六份验收证据重采、最终 CI 11/11。
6. Windows / Pageant / 串口 / 物理键盘 / 跨版本升级 / 签名等既有 NOT_RUN。

## 8. 判定

- **READY_FOR_REVIEW**：代码与本地门禁通过后为是（待推送后的 CI 确认）。
- **READY_FOR_MERGE**：Phase 9.4 仍是 stacked branch；PR #6 合并后需 rebase。
- **READY_FOR_RC**：**否**。真实 300 次复测、证据重采、隔离负面测试与最终 CI 未完成。
- **READY_FOR_RELEASE**：**否**。
