# RC15–RC18 — 终端运行时的真实环境依赖

这四项的共同点：**它们的核心机制已被实现且有单元测试，而任务书要求的验证方式
（真实 sshd 双跳、真实 WebView 长时压力、物理键盘）在本会话里无法构造。**

本文件不把它们记成 PASS。每一项写清楚：已有什么、缺什么、为什么缺。

---

## RC15 — 真实 SSH 重试预算

### 已实现且有测试

`terminal-session-manager-reconnect.ts` 与 `-errors.ts`：

| 机制 | 位置 | 测试 |
| --- | --- | --- |
| 重试上限 | `policy.maxAttempts`（`mode === 'automatic'` 时生效） | `terminal-session-manager-reconnect.test.ts` |
| 指数退避 + 可注入 jitter | 同上 | `uses injectable jitter over exponential retry delays` |
| 耗尽后落到可重试错误 + 恢复计时器 | 同上 | `ends in a retryable error after automatic reconnect attempts are exhausted` |
| 手动断开不再自动重连 | 同上 | `does not schedule automatic reconnect after a manual disconnect` |
| **认证拒绝是终态** | `NON_RETRYABLE_KINDS` 含 `authentication_rejected` | `terminal-session-manager-auth-kinds.test.ts` |
| 密码/密钥凭证失败不消耗网络预算 | `credential-retry.test.ts` | 多条 |

### 服务器侧计数（已补上）

任务书要求「从服务器日志和网络尝试次数独立验证」。现在由两个拒绝场景在**每次**
`--scenario` 运行时自动完成，不需要标志：

- `TARGET_AUTH_REJECTED` 数目标 sshd，`BASTION_AUTH_REJECTED` 数跳板 sshd
- 统计的是 `Failed publickey` 行，**不是** `Connection from`——fixture 自己的
  `waitUntilReady` 会先用正确密钥登录一次，那行是 harness 的流量，数进去会得到 2
  并把产品误判成缺陷（第一版正是如此）
- 判据是「恰好 1 次拒绝」：第二次意味着阶梯跑了，把服务器已经拒绝过的秘密又发了一遍

实测：两个场景各 1 次拒绝。**变异**（把 `authentication_rejected` 从
`NON_RETRYABLE_KINDS` 移除）后，同一场景记到 **4 次**——检查确实指向真实行为，
而不是一个总能通过的形状。

```
SSH_RETRY_BUDGET_IMPLEMENTED        = PASS   （代码 + 单测）
SSH_RETRY_COUNTED_FROM_SERVER_SIDE  = PASS   （真实 sshd，两次拒绝场景各 1 次）
```

**未覆盖**：密码认证路径（Docker 后端的 fixture 不暴露日志）与 Windows。上面计的是
公钥拒绝，而「拒绝不消耗预算」这条性质本身与认证方式无关。

---

## RC16 — SSH Jump 与身份隔离

### 已实现

跳板链路在 `session/ssh.rs`（`connect_stream_with_deadline` 带 `TcpShutdownGuard`），
`jumpHostId` 的两遍解析在 Phase 10.2 的 B3 里修过（别名 → 候选 id，解析不到标
`invalid` 并写 warning），并有 `import-plan-references` 的测试。

`ssh_real_connect.e2e.test.ts`（Phase 10.3）已经在**真实 sshd** 上验证过
Two-hop ProxyJump 各用各的凭据、Bastion 不可达不降级直连。

### 缺的验证

RC16 点名的八种情形里，以下需要**两个**隔离 sshd 与可控断连：

- 跳板认证失败 / 目标认证失败分别报什么；
- 跳板断开与目标断开的区别；
- HostKey 变更；
- A/B 切换时终端标题、Host ID、Session ID、远端回显的一致性。

```
JUMP_AUTH_CHAIN_REAL               = PASS      （跳板/目标认证各用自己的凭据，真实 sshd）
JUMP_DISCONNECT_MATRIX             = PARTIAL   （跳板腿三场景已覆盖；目标腿缺）
JUMP_ERROR_ATTRIBUTION             = PASS      （6 个归因用例，见 33-…md 的「闭合」）
```

归因这一项在本文写作时确实不存在。后来 `SessionFailure { error, hop, stage }` 作为
命令的返回类型解决了 `SessionError` 序列化边界的问题，证据见
`33-rc16-jump-attribution-gap.md` 的「闭合」一节。

`JUMP_DISCONNECT_MATRIX` 保持 PARTIAL 而不是 PASS：跳板腿的 healthy / blackhole /
reset 三场景已在 CI 上跑（F12），但**目标腿**的断开没有真实用例——跳板连接不直连
目标，`PermitOpen` 只放行目标真实端口，故障无法整形到那一腿。

---

## RC17 — PTY 大输出与背压

### 已实现且有测试

`session/terminal_output.rs` 的 `pause_high_watermark_bytes` 流控，
`terminal_output_tests.rs` 有 15 项，其中一项**明确驱动 10 MiB 并检查顺序**：

> The task asks for at least 10 MiB with ordering checked, so this drives exactly that

另外记录了 UTF-8 在块边界被截断的形态（三字节序列变成 U+FFFD，10 MiB 目标只到
达一部分）—— 那是这类测试最容易假绿的地方。

### 缺的验证

RC17 真正要的是**真实 Tauri WebView + xterm** 的大输出，并穿插输入、Ctrl+C、
切 Tab、切 Pane、滚动、Resize、关 Dock、窗口隐藏，同时采样回显延迟、吞吐、ACK、
CPU、RSS。

那需要启动 GUI 并长时间驱动。**已补齐**：`e2e/gui/specs/e2e-08-large-output.e2e.mjs` 在
真实 Tauri WebView 里向本地终端灌入 11.6 MB / 5 秒，macOS GUI E2E 是阻塞门禁。

判据刻意避开了「跑完没崩」——那几乎总是真的，且对背压只字未提。三条同时成立才算过：

1. **缓冲区尾部在前进**：43 → 10043 行，数据被 xterm 吃掉而不是堵在队列里；
2. **缓冲区有界**：10043 = 43 + 10000，正好是 scrollback 上限加的基线，说明产品在
   按自己的淘汰策略工作；
3. **停止输出后输入仍可用**：再发一条命令并等到回显——背压失效最典型的症状是界面
   看着在滚、却再也敲不进东西。

**变异**：把默认 `scrollback` 从 10000 提到 100000，断言在有界那一条变红
（`Received: 21009, Expected: <= 12000`），失败点正确。

```
PTY_BACKPRESSURE_10MIB_RUST        = PASS
PTY_BACKPRESSURE_IN_REAL_WEBVIEW   = PASS（macOS，真实 WebView）
```

**未覆盖**：Linux / Windows（两平台 GUI E2E 仍是 informational），以及 RC17 原文里
「穿插 Ctrl+C / 切 Tab / 切 Pane / 滚动 / Resize / 关 Dock」这些并发操作——本 case
只测了灌入与之后的输入恢复。

---

## RC18 — 长时间资源稳定性

### 本会话能做的：没有

任务书要求 100 轮 Local PTY / SSH / Tab / Split / SFTP / Snippet / Inspector / Dock，
分阶段采样 RSS、CPU、FD、线程、PTY、Listener、Queue、Session Registry，并区分
缓存平台期、GC 波动与单调泄漏。

这需要真实 GUI 长时间运行。**没有捷径**：单元测试里的计数器不构成资源曲线。

```
RESOURCE_CURVE_100_ROUNDS          = PASS（真实 GUI，100 轮，进程外采样）
```

**已补齐**：`e2e/gui/specs/e2e-09-resource-curve.e2e.mjs` 在真实 Tauri WebView 里跑 100 轮
（打开命令面板 → Escape → 读终端快照），每轮从**进程外部**采一次样。

### 为什么采样必须在进程外

`fixtures/process-sampler.mjs` 读 `ps` / `lsof` / `/proc`。应用自己记的计数器是被测对象
产出的测量：插桩有 bug 数字就变，崩溃序列就没了，计数器停止更新则读成一条完美直线。
操作系统没有这些动机。

### 实测（本机，macOS）

| 资源 | 起点 → 终点 | 判定 |
| --- | --- | --- |
| RSS | 50.3 MB → 29.0 MB（−20.28 MiB） | `NO_LEAK_DETECTED` |
| 描述符 | 103 → 104 | `NO_LEAK_DETECTED` |
| 线程 | 30–35 | 记录 |

101 个采样点。RSS 下降而不是上升——启动期分配在结束时已经释放。

### 判读规则

`fixtures/resource-curve.mjs` 是纯函数，11 项测试用合成序列覆盖三种形态。判据是
**后半段的 floor 是否还在爬**，不是「末值比初值高」：

- 只比首末，锯齿波会被判成泄漏（末值碰巧落在高位）；
- 比整段 floor，热身会被判成泄漏——写这个模块时实测过，合成平台期被判「floor rose 1100%」。

**用真实序列做变异**：实测的 101 点 → `NO_LEAK_DETECTED`；同一序列每轮 +3 MiB →
`LEAK_SUSPECTED`；热身到 60 MiB 后持平 → `NO_LEAK_DETECTED`。规则在真实数据上工作，
不是只在合成数据上。

### 它不声称什么

单台 runner 上的曲线是关于那台 runner 的假设。任务要的是形状，不是合并门禁，所以
`LEAK_SUSPECTED` 记进证据而不是抛错——抛错会让共享 runner 的噪声阻塞无关工作，
`ssh-soak.yml` 同样拒绝这么做。

**未覆盖**：Linux / Windows（本 case 只在 macOS GUI E2E 的阻塞门禁里跑；两平台的 job
是 informational）；以及任务书点名的 SFTP / Snippet / Inspector 各阶段——本 case 的每轮
是命令面板的开关，这是三平台上唯一行为一致的控件。

### 一项可以在无 GUI 条件下做的替代

`upload_locks()` 注册表、`verifyingIds`、`SessionClaim` 的累积性已在 RC11 与
R07 里用「重复 N 轮」的方式验证过（那几项本来就跑在 Node 里）。它们覆盖了
「应用内可变状态」这一类，但**不覆盖进程级 RSS/FD/线程**。

---

## 汇总

```
RC15  SSH_RETRY_BUDGET_IMPLEMENTED        PASS
RC15  SSH_RETRY_SERVER_SIDE_COUNT         NOT_RUN
RC16  JUMP_TWO_HOP_CREDENTIALS            PASS   （Phase 10.3 真实 sshd）
RC16  JUMP_DISCONNECT_MATRIX              NOT_RUN
RC17  PTY_BACKPRESSURE_10MIB              PASS   （Rust）
RC17  PTY_BACKPRESSURE_REAL_WEBVIEW       NOT_RUN
RC18  RESOURCE_CURVE_100_ROUNDS           NOT_RUN
```

三项 NOT_RUN 的原因相同：**需要真实 GUI 会话或双跳 fixture，而本轮按用户要求不
启动应用窗口**。这不是「没时间做」，是「没有可以诚实地声称做了的条件」。
