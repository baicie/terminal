# Phase 9.5.4 — Process Lifecycle Final Gates

> 日期：2026-11-05
> 代码：`process-lifecycle.mjs`、`quiescence.mjs`
> 判定：`PROCESS_STOP_FAIL_CLOSED = YES`、`PROCESS_RESOURCE_QUIESCENCE_VERIFIED = PARTIAL`

## 1. 严格 stop 门禁

`requireStopped()` 现在拒绝：

- `spawn-error`
- `timeout`
- `exitObserved=false`
- `closeObserved=false`
- `stdoutClosed=false` / `stderrClosed=false`
- 日志写入失败（`logError`）
- 非预期终止信号（默认只接受 SIGTERM；中断测试显式允许 SIGKILL）
- 未显式允许的 forced SIGKILL

`upgrade-e2e.mjs` 的 A/B、恢复、降级、Linux、AppImage 路径全部改用
`stopChecked()`；任何一项不满足会让场景 FAIL，而不是只写一个 PASS check。

## 2. 终止语义

`stopProcess` 结果新增：

- `termination=clean-exit`：应用自己 exit(0/非信号)；
- `termination=terminated-by-sigterm`：被 SIGTERM 终止，不能证明应用内部清理；
- `termination=forced-sigkill`：超时后被迫 SIGKILL；
- `termination=terminated-by-<signal>`：其他信号；
- `spawn-error` / `timeout`。

`outcome=graceful` 仍保留兼容，但只表示“未升级到 SIGKILL”；报告同时记录
`termination`、stdout/stderr closed、log error。

## 3. 日志错误

`close` 回调中的 `writeFileSync` 被 try/catch/finally 包裹：日志写失败记录
`logError`，`closePromise` 仍会 resolve，`closeObserved` 保留；`requireStopped`
将日志失败视为场景失败，不伪装成进程停止失败。

## 4. Quiescence

`quiescence.mjs` 拆成四项：

| fact | 来源 | 当前 |
| --- | --- | --- |
| `PROCESS_EXITED` | exit 事件 | 可观测 |
| `STREAMS_CLOSED` | close + stdout/stderr close | 可观测 |
| `OWNED_CHILDREN_SETTLED` | 进程树 | **NOT_RUN** |
| `DB_HANDLES_RELEASED` | `lsof -nP -t -- db/wal/shm/journal` | macOS 可观测；无 lsof 时 NOT_RUN |

`assertQuiescence()` 在 A/B、恢复 A、降级 A 之后执行；DB handle 存在即 FAIL。
不计入契约 required checks，避免把无 lsof 的平台误杀。

## 5. 测试

- `process-lifecycle.test.mjs`：9 项（含 clean-exit、terminated-by-sigterm、
  forced、spawn-error、并发、日志失败、requireStopped）。
- `quiescence.test.mjs`：3 项（facts、FAIL 组合、真实文件句柄 lsof）。
- 本地 Node 22 全量脚本测试 60+ 项；CI Node 24 运行 Argon2 项。

## 6. 限制

- 进程组/WebKit/PTY 子进程未枚举，`OWNED_CHILDREN_SETTLED=NOT_RUN`；
- 没有 `lsof` 的平台为 NOT_RUN；
- 本地 macOS 因 WKWebView localStorage 不受 HOME 重定向，连续多轮本地测试可能
  被共享恢复状态污染；CI 使用 fresh runner。该限制不写成产品 PASS。
