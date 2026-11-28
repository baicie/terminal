# DDQ10 — 目标腿的断流矩阵

DDQ09 把 target proxy 放到了被测链路中间，并证明它确实承载流量。
本文件记录在这条链路上依次注入的故障，以及**产品从底层错误里实际能知道什么**。

---

## 六种形状与注入点的对应

一个只转发字节的 proxy 分不清"握手期"与"认证期"——它看到的是字节。所以映射用
**字节位置**，由 Rust 侧断言产品报告的是哪个阶段。

| 任务书要求的形状 | 注入方式 | 状态 |
| --- | --- | --- |
| Target TCP 拒绝 | 端口无监听（连 proxy 都没有） | ✅ 已覆盖 |
| Target SSH 握手期间 RST | `cutAfterBytes` 512/512 | ✅ 已覆盖（实测 cut 在 512 B） |
| Target 认证期间 RST | `cutAfterBytes` 4096/2048 | ✅ 已覆盖（实测 cut 在 2048/2126 B） |
| Target 通道打开失败 | `blackhole`（接受连接，不转发） | ✅ 已覆盖 |
| Target 已连接后中断 | — | ❌ **本测试结构上做不到**，见下 |
| Shell 正在输出时中断 | — | ❌ **同上**，属于 DDQ12 |

### 为什么后两种在这个 Rust 测试里做不到（两次实测）

| 阈值 | 实测结果 |
| --- | --- |
| `65536/65536` | `cut=0`，`up=2562 down=2893` |
| `3000/3000` | `cut=0`，`up=2562 down=2893` |

两次的字节数**完全相同**，而且与每一次健康运行的数字一致。这说明连接只承载
约 5.5 KiB 就停了——不是 runner 抖动：`connect_via_jump` 认证完两跳、把 handle
交回来，而**这个测试随后就把它们 drop 了**。之后没有东西再往通道里写，所以
更高的阈值没有流量可等。

一个注入不可能触发的场景不是"弱通过"。`cut: 0` 规则现在会把它判 FAIL，
这正是它被发现而不是被发布出去的原因。要驱动一个活会话（打开、写入、观察、切断），
需要一个**保持会话打开并从中读取**的用例——那是 DDQ12 通过产品自己的终端做的事，
不是这个 Rust 测试能做的。

那两种形状的**传输层那一半**仍被覆盖：任意字节位置的切断必须产生有界、非凭证、
非 bastion 的失败，`target-reset-handshake` 与 `target-reset-auth` 在两个不同位置
证明了这一点。

阈值是**测出来的起点**：`healthy` 场景每轮的 `upBytes`/`downBytes` 写在报告的
`targetLegMatrix` 里，下一次运行可以据此调整。

---

## 每个场景必须断言什么

### 共同的三条

1. **有界返回** —— 故障不变成挂起。由 `tokio::time::timeout(45s)` 兜住外层，
   内层 `connect_via_jump` 自己带 30 s deadline。
2. **不是凭证问题**（除 `target-reset-auth`，见下）—— 传输层故障不是
   `AuthenticationRejected`。
3. **零残留** —— `ssh_resource_keys()` 的 pool 与 registry 都回到空。

第 3 条尤其重要：一个"通过"却在每次运行泄漏一个池条目的故障场景，在 verdict 上
与干净的一模一样。

### 分配言：产品能知道什么，不许它假装知道什么

| 场景 | 断言 | **不**断言 | 理由 |
| --- | --- | --- | --- |
| `target-refused` | `stage == TunnelOpen`；非凭证错误 | 不排斥 `hop == Bastion` | 见下，这是产品**已文档化**的行为 |
| `target-blackhole` | 非凭证错误 | 不要求 `hop == Target` | 产品看到的是一个不再应答的通道，而它实际对话的对端是 bastion |
| `target-reset-handshake` | 非凭证错误；不得归因 bastion | 不要求 `hop` 有值 | 切断发生在任何凭证发出之前 |
| `target-reset-auth` | **不得**归因 bastion | **不**断言错误类别；允许 `hop == None` | 流在 userauth 中途死亡，可能合法地表现为连接错误或认证失败，客户端无法区分 |

### `target-refused` 的第一版断言是错的，产品是对的

第一版写的是 `assert_ne!(hop, Bastion)`——"bastion 没问题，所以不可能是它"。
实测直接红了：

```
stage=Some(TunnelOpen)
error=channel error: open jump host tunnel failed: Failed to open channel (ConnectFailed)
hop=Some(Bastion)
```

产品代码在产生这个失败的**同一个位置**写着契约（`ssh.rs:2117-2127`）：

> `Bastion` names the connection that *holds* the channel, not where the physical fault
> is: the bastion may refuse forwarding, or the target address may be unreachable from it.
> This API does not distinguish those, so only the stage is claimed — the tunnel never opened.

`direct-tcpip` 打开失败到达客户端时是一个拒绝，客户端分不清"bastion 的 PermitOpen
说不"和"bastion 拨号后被内核拒绝"。它能说的是**哪个阶段**失败了。所以断言改在 stage 上，
`Bastion` 被接受——**这个测试现在钉的是已文档化的行为，不是一种意见**。

`SessionFailure.hop` 是 `Option`。`None` 是诚实的答案，把证据不支持的主张
（"一定是目标机器挂了"）写进断言，会让测试变成一种意见。

---

## `cut: 0` 是注入没触发，不是弱通过

`cutAfterBytes` 场景如果阈值没到，报告里是 `cut: 0`，而 case 可能仍然"通过"——
一个正常完成的连接满足"不是认证拒绝"。

harness 因此把 `cut === 0` 记成 `INJECTION_NEVER_FIRED` 并判 **FAIL**。
这与 `accepted === 0` 是同一族：**故障注入了，但没注入到被测链路上**。

`target-refused` 场景豁免这两条规则：没有 proxy，`accepted` 为 `null` 是它的
正确形态——一个关闭的端口**按定义**不接受任何连接，在这里要求 `accepted >= 1`
就是要求场景的反面。

---

## 变异：把注入去掉，预期的失败必须变红

未在 CI 中自动执行，但手工可复现：

| 变异 | 预期 |
| --- | --- |
| `target-blackhole` 改成 `{}`（透传） | 连接成功 → `panic!("a forwarded path that carries nothing cannot produce a working session")` |
| `target-refused` 改成一个活着的 proxy | 连接成功 → `panic!("a port with no listener cannot produce a working session")` |
| 把 `cutAfterBytes` 阈值设到 10 GB | `cut: 0` → harness 判 `INJECTION_NEVER_FIRED` |

第三条是本轮新增的守卫，也是唯一一条**不需要改代码就能验证**的：
把任一阈值调大即可。

---

## 实测结果

本机 macOS，真实 `/usr/sbin/sshd`：

```
target-leg scenario healthy               passed (accepted=1, cut=0, upBytes=2562, downBytes=2893)
target-leg scenario target-refused        passed (no proxy: the target port is closed, so the connect is refused by the kernel)
target-leg scenario target-blackhole      passed (accepted=1, cut=0, upBytes=0,    downBytes=0)
target-leg scenario target-reset-handshake passed (accepted=1, cut=1, upBytes=22,   downBytes=512)
target-leg scenario target-reset-auth     passed (accepted=1, cut=1, upBytes=2126, downBytes=2048)
verdict: PASS
```

每个 `cut=1` 都是注入真的在路径上的证明：`cutAfterBytes` 达不到阈值就不会切。
`target-reset-handshake` 的 `up=22, down=512` 说明切在客户端还没发多少、服务端
已吐出 512 B 的位置——版本交换刚结束、KEX 刚开始。
`target-reset-auth` 的 `up=2126` 说明客户端已经发了将近一个完整握手的量——
userauth 阶段。

---

## 剩余限制

- 只在 macOS / Linux 上可跑（需 `/usr/sbin/sshd`）。Windows `NOT_RUN`。
- **四种形状已覆盖，两种结构上做不到**（"已连接后中断"与"Shell 输出中中断"）——
  原因与实测数据见上文表格。它们需要 DDQ12 那种保持会话打开并读取的用例。
- 每个场景都是**一次**注入，没有做同一场景的重复注入（例如连续断三次后的池状态）。
- `target-reset-auth` 不断言错误类别，因此它不能证明产品在该阶段的行为是"对的"，
  只能证明它不把责任推给 bastion。这是当前证据能支持的最强结论。
- `target-refused` 接受 `hop == Bastion`，因为这是产品文档化的契约
  （`direct-tcpip` 打开失败无法区分"跳板拒绝转发"与"目标不可达"）。
  **这一项不是产品的缺陷，也不应被读成"目标腿归因已完整"** ——
  它说明的是产品在该阶段只声称 stage，不声称物理位置。
- 本机运行；CI 的 `Real SSH jump matrix` 会跑同一套 harness，但 Windows job 不跑。
