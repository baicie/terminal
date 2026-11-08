# Phase 9.8-C1 — SSH writer 超时语义

分支 `feat/phase9-8-c1-ssh-writer`，base `feat/phase9-7-product-acceptance`。

## 根因

`ssh_writer.rs` 把两类完全不同的超时当成同一件事：

1. **命令从未进入队列**（queue timeout）——通道未被触碰，writer 仍健康；
2. **命令已出队但立即过期**——worker 直接 `continue` 丢掉 reply，调用方收到
   `RecvError`，被当成“writer 任务已停止”，**误杀健康会话**；
3. **命令已开始执行但超过 deadline**——调用方只拿到普通 `(command timeout)`，
   writer 仍被当作可用；可实际字节可能已经部分送达，重试会重复输入。

## 实现

每个命令携带 `CommandState { started }`；worker 出队时：

- `reply.is_closed()`（调用方已放弃）→ 跳过，不阻塞后续命令；
- deadline 已过且尚未开始 → 显式回 `... expired before it started`，**不杀 writer**；
- 否则先置 `started=true` 再执行。

调用方在 deadline 到达时按状态区分（`TimeoutPolicy`）：

| 命令 | 未开始超时 | 已开始超时 |
| --- | --- | --- |
| write | 非致命（`... (command timeout)`） | **致命**：报 “bytes may have been partially delivered”，并 retire writer |
| resize | 非致命 | 非致命（不含用户输入） |
| close | 致命 | 致命 |

retire 会通过 completion watch 通知 `SshSession`（既有机制），会话被标记为 dead，
错误上抛给调用方，而不是静默重连或重发。

## 测试（14 项，全部通过）

- FIFO 顺序与串行执行；连续 write/resize
- 队列中过期 write / resize 不执行、不杀 writer
- 队列容量 1：缓冲一条 + 第二条 queue timeout → writer 仍可服务后续写
- 已开始写超时 → 报“可能已部分送达”、writer 退役、后续写被拒
- 调用方丢弃 write future（reply 丢失）→ worker 跳过并继续
- worker panic → 当前命令报错、writer 退役、后续命令被拒、JoinHandle 为 Err
- 操作错误仍执行有界 close；close 到期停止 worker 并拒绝后续命令
- 干净 close 通知 completion；fatal completion 标记会话 dead（`ssh.rs` 既有测试）

## 验收判定

| 项 | 判定 | 证据 |
| --- | --- | --- |
| `SSH_WRITER_TIMEOUT_SEMANTICS` | **PASS** | 队列超时 / 已开始超时分别有确定性测试 |
| `SSH_WRITER_HEALTHY_SESSION_PRESERVED` | **PASS** | queue timeout、丢弃 future、队列容量 1 后仍可写 |
| `SSH_WRITER_FATAL_CLOSE_VERIFIED` | **PASS** | close 到期退役；panic 后拒写；fatal completion 标记 dead |

## 边界

- 已开始的写无法撤回，`russh` 的 future 被 drop 时字节可能已发出；因此选择
  “退役 writer + 明确告知不确定”，而不是重发。
- 未在真实 SSH 链路上注入纳秒级超时（由确定性 FakeWriter 覆盖）。
