# Phase 8 · P8.3 可靠性调查

## A. Linux SSH reconnect stale-output —— 根因已确诊

**来源**：run 41112206442，Linux job 124256995007，日志行 4926-4927。

### 结论：测试观察判据缺陷（类别 b），不是环境问题，也不是输出丢失

决定性证据（三段代码 + 一行真实日志）：

1. 判定用**整行精确相等**：`hasExactLogicalLine(term, expected)` = `readLogicalTail(term).some(line => line === expected)`（`terminal-smoke-buffer.ts:41-46`）。
2. barrier 发射时**没有前导换行**：`data: format!("{ACTIVE_OUTPUT_BARRIER}\r\n")`（`terminal_smoke.rs:1196`）。
3. 真实日志里 prompt 与 marker **在同一行**：
   `rawOutputTail: "\u001b]133;A\u0007$ TERMINAL_SMOKE_ACTIVE_OUTPUT_BARRIER\r\n"`

于是逻辑行是 `$ TERMINAL_SMOKE_ACTIVE_OUTPUT_BARRIER`，永远不等于 `TERMINAL_SMOKE_ACTIVE_OUTPUT_BARRIER`。
`waitForExactLogicalLine` 只能等到 frontendTimeout 中止，`stage` 停在 `stale-output`。

这也解释了 Linux 特异性：Linux 冒烟 shell 会打印 prompt，marker 被粘在其行尾；非交互场景不打 prompt 时判定才会通过。

### 本文件此前的两处错误结论（已作废，保留以免重复）

| 错误结论 | 为何错 |
| --- | --- |
| 「tail 全空 ⇒ 观察者看到空终端」 | `readLogicalTail(term, 32).slice(-8)` 取「最后 32 条的后 8 条」，而 xterm 清屏后缓冲区恒为 rows=24 条空行；内容在上部时后 8 条**必然全空**。这是诊断字段造成的假象，不证明终端为空。 |
| 「marker 已到达 Rust 侧原始输出」 | `rawOutputTail` 是**前端**字符串 ref，在 `onOutput` 里、`enqueue()` **之前**累加（`use-terminal.ts:117-131`）。它只能证明事件到达前端，与 Rust 无关。 |
| 「代际/实例错配」 | 结构上不可达：整轮只有 1 个 xterm 与 1 个 scheduler（`use-terminal-smoke-round.ts:52-60`），reconnect 不重建（effect 依赖全稳定）。 |

### 18 字节缺口：另一条独立的真实缺陷

`acceptedBytes 303 - parsedBytes 285 = 18` 与失败无因果，但**它本身是一个必须修的缺陷**：

`takeHead()`（`terminal-output-scheduler.ts:251-256`）在 receipt 失效时整块丢弃已入队数据：

```ts
while (output?.receipt && !output.receipt.isActive()) {
  this.queue.shift()
  this.queuedBytes -= output.bytes   // acceptedBytes 不减、无错误、无日志、不 ack
  output = this.queue[0]
}
```

reconnect 起手会 `audience.retireAll()`（`terminal-session-manager-reconnect.ts:241`），使当时仍在队列里的会话数据 receipt 全部失效，
于是下一次 `flushFrame` 把它们静默删除。被丢的**完全可能是当时处于 active 的会话数据**。

第二处：`clearPending()`（:279-287）在 reset/dispose/fail 时清空队列，且**不清 `inFlightBytes/writeInFlight`**。

两者共同违背 P8.4 的「丢弃输出必须触发明确错误，不能静默当作已展示」。

## B. Linux zsh 三条 shell probe 用例（Issue #156）

已确认：稳定失败集合为 readline-history / readline-tab / pty-resize，恰好触到 30 秒 per-case deadline；相隔 30 分钟两次 run 完全一致；同一 runner 在 2026-10-17 上这三条是绿的（246/410/1341 ms）。故排除预算不足与环境抖动。

判定层缺陷已修（f74a33e）：原本 contract mismatch 是唯一失败出口。

**未解决**：这三条为何从未完成。本轮仍未取得拆分后的新日志——修复提交之后的 Linux run 在更早的 A 问题处失败，未走到 shell 矩阵。A 修复后应能拿到新日志。

## C. 待实施的修复（本阶段）

| # | 修复 | 位置 |
| --- | --- | --- |
| 1 | barrier 与 canary 增加前导 `\r\n`，确保独占一行 | `terminal_smoke.rs:1188,1196` |
| 2 | 判定改为「逻辑行包含 marker」，prompt 前缀不再破坏匹配；canary 用同一语义（更严） | `terminal-smoke-buffer.ts` + `run-terminal-smoke.ts:134,137` |
| 3 | 诊断 `tail` 改为「最近非空行」，并补 buffer 几何字段以区分「真空」与「视口底部空行」 | `terminal-smoke-diagnostics.ts:10-12` |
| 4 | 两处丢弃点计数 + warn，并把 `droppedBytes` 放进 snapshot，维持不变量 accepted = parsed + dropped | `terminal-output-scheduler.ts:251-256,279-287,100-110` |
| 5 | `reset()` 明确归零 inFlight 状态并记因 | 同上 |
