# Phase 8 · P8.3 可靠性调查（进行中）

## A. Linux SSH reconnect stale-output 失败 —— 真实日志证据

**来源**：run 41112206442，Linux job 124256995007，日志行 4926-4927。原始日志，非文档转述。

事实（已确证）：

1. barrier marker 已到达 Rust 侧原始输出——rawOutputTail 含 TERMINAL_SMOKE_ACTIVE_OUTPUT_BARRIER
2. 队列与在途全部为空：queuedBytes=0, queuedChunks=0, inFlightBytes=0, writeInFlight=false
3. output.state = active（非 paused/closed）
4. 18 字节被接受但未计入 parsed：acceptedBytes 303 - parsedBytes 285 = 18
5. 观察到的终端最后 8 行全是空字符串：tail = ["","","","","","","",""]
6. 18 字节缺口不是任何 marker：STALE_OUTPUT_MARKER 与 ACTIVE_OUTPUT_BARRIER 均为 36 字节

被证伪的假设（记录以避免重复）：

- 18 字节是那条被正确拒绝的陈旧金丝雀 —— 算术不成立，两个 marker 都是 36 字节。已排除。
- 环境性抖动（旧文档口径）—— 无法解释 tail 为空与 parsedBytes 计数之间的矛盾。

根因候选（未确证，按优先级）：

1. 代际/实例错配：reconnect 后 barrier 被写入已退役的那一代终端，而 smoke 观察的是替换后的新实例（新实例缓冲为空）。这同时解释事实 4、5、6。
2. 观察者读取时机早于 xterm 提交：parsedBytes 在 write 回调里累加，但回调触发时 xterm 内部缓冲可能尚未对读取可见。
3. 18 字节属于被分片丢弃的残留：takeHead 在 receipt 失活时 queue.shift() 并 queuedBytes -= bytes，不报错不记录。

下一步：定位 tail 的采集点；在 write 回调与读取处打印 sessionId / generation / parsedBytes / terminal identity；设计最小用例；明确是代码缺陷还是观察判据缺陷。

## B. Linux zsh 三条 shell probe 用例（Issue #156）

已确认：稳定失败集合为 readline-history / readline-tab / pty-resize，恰好触到 30 秒 per-case deadline；相隔 30 分钟两次 run 完全一致；同一 runner 在 2026-10-17 上这三条是绿的（246/410/1341 ms）。故排除预算不足与环境抖动。

判定层缺陷已修（f74a33e）：原本 contract mismatch 是唯一失败出口。

未解决：这三条为何从未完成。本轮尚未取得拆分后的新日志——修复提交之后的 Linux run 仍在更早的 A 问题处失败，未走到 shell 矩阵。

## C. 关键结构事实

- parsedBytes 由前端 terminal-output-scheduler.ts 在 terminal.write 回调中累加（第 202-205 行），不是 Rust 侧计数。
- takeHead() 在 receipt 失活时静默丢弃已入队数据（queue.shift(); queuedBytes -= bytes），acceptedBytes 不减、无错误、无日志。这条路径与 P8.4「丢弃输出必须触发明确错误」直接冲突，无论是否为本次 Linux 失败的成因都必须改造。
