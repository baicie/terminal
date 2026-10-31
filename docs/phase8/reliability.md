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

## C. 修复完成情况（提交 3e40823）

| # | 修复 | 位置 | 状态 |
| --- | --- | --- | --- |
| 1 | barrier 与 canary 增加前导 \r\n，各自独占一行 | terminal_smoke.rs | ✅ |
| 2 | 新增 hasLogicalLineContaining / waitForLogicalLineContaining；barrier 改包含语义；canary 由「整行相等即失败」改为「任意行包含即失败」（更严） | terminal-smoke-buffer.ts / run-terminal-smoke.ts | ✅ |
| 3 | 诊断 tail 改「最近非空行 ×8」并补 bufferLength/cursorY/viewportY/baseY | terminal-smoke-diagnostics.ts | ✅ |
| 4 | 新增 TerminalOutputDropLedger，丢弃计数 + 一次 warn；snapshot 暴露 droppedBytes/droppedChunks | terminal-output-queue.ts（新） | ✅ |
| 5 | reset() 的 in-flight 选择「明确记因」而非归零 | terminal-output-scheduler.ts | ✅ |

**测试**：新增 8 条（失效 receipt 丢弃被计数 / reset 清队列记账 / accepted=parsed+dropped /
reset 后陈旧在途写仍被记账 / barrier 与 prompt 同行时通过 / canary 嵌行中仍失败 /
tail 报最近非空行 / tail 为空时仍带 bufferLength=24）。既有 1293 用例未减少。

**未做（各需再动 1 个文件）**：Rust 侧缺「marker 必须带前导 CRLF」的发射端回归断言；
warn 未含 sessionId（scheduler 层无会话身份）。

**仍然待验证**：本次修复只证明判据正确，**没有在真实 Linux runner 上重跑过**。
需要下一次 matrix 的 Linux job 来确认 stale-output 阶段通过、且 shell 矩阵能真正执行。
