# Phase 9.5.3 — Process Lifecycle

> 日期：2026-11-05
> 代码：`scripts/verify-install/process-lifecycle.mjs`
> 测试：`process-lifecycle.test.mjs`（7 项）
> 判定：`PROCESS_LIFECYCLE_VERIFIED = YES`（直接子进程；进程组隔离见第 5 节）

## 1. 修复的缺陷

旧 `stop()` 用 `Atomics.wait()` 同步阻塞 Node 主线程：

```js
while (Date.now() < deadline && child.exitCode === null) sleep(250)
```

退出事件与 stdout/stderr 的 `data`/`close` 回调都在同一事件循环里，阻塞轮询会
延迟它们，导致：

- SIGTERM 成功率与退出耗时被测量污染；
- SIGKILL 后的日志尚未 flush 就被读取；
- checkpoint 时实际进程可能仍存活，或反过来误判已退出。

`upgrade-e2e.mjs` 的所有 `sleep` 调用已改为异步 `delay()`；`launch`/`stop` 改为
`process-lifecycle.mjs`。

## 2. 结果结构

```ts
type ProcessStopResult = {
  outcome: 'already-exited' | 'graceful' | 'forced' | 'timeout' | 'spawn-error'
  pid: number | null
  exitCode: number | null
  signal: string | null
  exitObserved: boolean
  closeObserved: boolean
  elapsedMs: number
  escalationUsed: boolean
  error?: string
}
```

## 3. 行为

- `launchProcess` 在 spawn 后立即注册 `spawn/error/exit/close` 与 stdout/stderr
  的 `data/close`；日志在 **close** 时写入，而不是 exit。
- `stopProcess` 只在真实 `exit` 事件后判定 graceful；`kill()` 返回 true 不算退出。
- 超时后升级 SIGKILL，并有独立 `killWaitMs`；即使 SIGKILL 后仍无 exit，返回
  `timeout` 和 `error`，不会静默成功。
- 并发 `stop` 复用同一个 `stopPromise`，避免重复信号与重复监听。
- spawn 失败返回 `spawn-error`，不把 close code -2 当作正常退出。
- 只向传入的 child 发送信号，不按应用名或进程树做宽泛 pkill。

## 4. 测试结果

```bash
node --test scripts/verify-install/process-lifecycle.test.mjs
```

7/7 通过：

1. SIGTERM 后立即退出，stdout/stderr 在 close 前 flush；
2. 延迟 200 ms 的 graceful exit，elapsed 真实；
3. 忽略 SIGTERM 升级 SIGKILL（forced + escalation）；
4. 已退出进程返回 already-exited；
5. 并发 stop 只做一次决策；
6. 不存在的命令返回 spawn-error；
7. 停止 target 不影响另一个 sentinel 子进程。

真实 upgrade E2E（本机 Node 24）normal/restore 的 `A stopped`/`B stopped` 现在
记录 `outcome=graceful exitObserved=true closeObserved=true escalation=false`，
不再把 SIGKILL 当作默认停止方式。

## 5. 仍未覆盖

- Linux/macOS **进程组**：当前只停止直接子进程。Tauri 的 WebKit/PTY 子进程是否
  仍持有 DB 文件，需要 `lsof`/进程组确认；本轮没有实现。
- Windows Job Object/进程树清理。
- SIGKILL 后仍无 close 的 timeout 场景（单元测试未构造；代码 fail-closed）。
- 真实 E2E 多轮 graceful/forced 比例统计；需要在 CI 上采样。

因此 `PROCESS_ISOLATION_VERIFIED = PARTIAL`：直接子进程生命周期已验证，进程组
隔离与 lsof 二次确认仍是 NOT_RUN。
