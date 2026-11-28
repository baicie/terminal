# DDQ09 — 目标腿的故障整形拓扑

**问题**：跳板腿的故障注入早就能做（F12），目标腿不能。这不是产品架构的问题，
是 fixture 拓扑的问题——而它让 `JUMP_DISCONNECT_MATRIX` 一直停在 PARTIAL。

---

## 旧拓扑：proxy 在链上，但不在**被测那条**链上

```
product → bastion proxy → bastion sshd → (direct-tcpip) → 真实 target 端口
                                                              ↑
                                            target proxy 挂在这里，却没人经过它
```

`scripts/verify-install/ssh-jump-e2e.mjs` 启动了两个 proxy：

```js
const targetProxy  = await startShapingProxy({ targetPort: target.port })
const bastionProxy = await startShapingProxy({ targetPort: bastion.port })
```

但 bastion 的 `PermitOpen` 写的是**真实 target 端口**：

```
PermitOpen 127.0.0.1:<target.port>
```

而产品的 `JumpTarget.port` 也是 `fixture.target_port`。所以从产品到 target 的每一个
字节都绕开了 `targetProxy`。它在报告里有一个端口号，`accepted` 永远是 0。

`FixtureProxies` 的文档注释记着第一次尝试把产品指向 target proxy 的结果：

> The first version carried a target proxy port and pointed the product at it, which
> measured as `AdministrativelyProhibited`: the bastion correctly refusing an address it
> had never been configured for.

**那句诊断是对的，结论却下反了**：`AdministrativelyProhibited` 说明 bastion 在正确工作，
说明 fixture 少配了一样东西——`PermitOpen` 没放行 proxy 的地址。不是"目标腿测不了"。

同时 `SSH_JUMP_E2E_TARGET_PROXY_PORT` 这个环境变量一直被 harness 设着，
**Rust 侧从来没有读过它**。一个被设置、被记录、被写进 `fixtureEnvironment`、
却无人消费的配置项，是"看起来有覆盖"的最经济形态。

---

## 新拓扑：proxy 在中间，两端都指向它

DDQ09 用一个**专用 bastion**，`PermitOpen` 只放行 proxy 的端口：

```
product → bastion sshd → (direct-tcpip) → target-leg proxy → 真实 target sshd
                ↑                                   ↑
        PermitOpen 只放行 proxy 端口        产品的 JumpTarget.port = proxy 端口
```

关键点：

1. **proxy 是透明的。** 它只做 `net.connect` 字节转发，不终结 SSH。所以
   `expected_host_key: Some(target 的真实 host key)` 仍然成立——一个自己终结
   握手的 proxy 会在这里失败。**HostKey 校验没有关掉，也没有放宽。**
2. **不复用主 bastion。** 主 bastion 的 `PermitOpen` 同时放行 target A 和 B，
   是 F11 隔离矩阵需要的。改它会让那些用例失去意义。目标腿的 bastion 只放行一个地址，
   所以"流量到底走了哪"不是配置能回答的问题。
3. **每个场景一个 proxy + 一个 bastion。** 新 proxy 拿新的临时端口，
   一个 bastion 无法服务三个场景——第一版复用了，连接被拒在一个没人放行的端口上。

镜像里没有改任何生产代码：`PermitOpen` 是 fixture 的配置，`connect_via_jump` 的
调用参数是测试的输入。**产品的 SSH 安全逻辑一行未动。**

---

## 实测（本机 macOS，真实 sshd）

```
[ssh12] target-leg scenario healthy         passed (accepted=1, cut=0, upBytes=2562, downBytes=2893)
[ssh12] target-leg scenario target-blackhole passed (accepted=1, cut=0, upBytes=0, downBytes=0)
[ssh12] target-leg scenario target-reset     passed (accepted=1, cut=1, upBytes=512, downBytes=21)
[ssh12] verdict: PASS
```

三个数字各自证明一件事，缺一不可：

| 场景 | 证据 | 证明了什么 |
| --- | --- | --- |
| `healthy` | `up=2562, down=2893` | proxy **真的承载了双向 SSH 流量**；拓扑成立 |
| `target-blackhole` | `accepted=1, up=0, down=0` | 连接到了 proxy、握手开始、然后什么都不来 |
| `target-reset` | `cut=1, up=512` | `cutAfterBytes` 达到阈值才能切断——**proxy 必然在路径上** |

`accepted=1` 是每个场景的前置断言。一个 `accepted=0` 的"通过"意味着故障注入在
产品从未经过的地方，harness 现在把这种情况记成 `TARGET_LEG_NOT_ON_PATH` 并判 FAIL。

### 为什么 `healthy` 不是可选项

如果只有两个故障场景，一个**拒绝一切连接**的 target proxy 会让它们全部"通过"——
连接失败、没有认证错误、有界返回，每条断言都满足，而产品根本没被测到。
`healthy` 要求同样的拓扑下两跳连接仍然成功，这才是"proxy 是透明的"的证明。

---

## 判定语义：产品能知道什么，不许它假装知道什么

`SessionFailure.hop` 是 `Option<ConnectionHop>`，`None` 是一个诚实的答案。
目标腿的三种故障里，只有一部分能被产品可靠归因：

| 场景 | 断言 | 不a assert 什么 | 理由 |
| --- | --- | --- | --- |
| `target-blackhole` | 有界返回；**不是** `AuthenticationRejected` | 不要求 `hop == Target` | 产品看到的是一个不再应答的通道，而它实际对话的对端是 bastion |
| `target-reset` | 有界返回；**不是** `AuthenticationRejected`；**不得**归因给 bastion | 允许 `hop == None` | bastion 认证并转发都成功了，但中途关闭不携带客户端可验证的归因 |

任务书要求区分两件事：

1. fixture 知道故障注在哪条链路；
2. 产品从底层错误里**实际**能知道什么。

关于 2，`target-blackhole` 的结论是：产品分不清"目标机器没了"和"到它的路径断了"。
两者都是同一个 EOF。强行断言 `hop == Target` 会把一个证据不支持的主张写进测试。

---

## 一个可以在无外部条件时复现的命令

```bash
SSH_JUMP_E2E_REPORT=/tmp/ddq09-report.json node scripts/verify-install/ssh-jump-e2e.mjs
```

报告里的 `targetLegMatrix` 每项带 `accepted` / `cut` / `upBytes` / `downBytes`，
读者可以据此判断故障注入是否真的作用于被测链路，而不必相信 verdict 字段。

---

## 剩余限制

- 目标腿的矩阵只在 **macOS / Linux** 上跑（需要 `/usr/sbin/sshd`）。Windows 上没有
  OpenSSH server fixture，这一项在那里是 `NOT_RUN`，不是 PASS。
- `hop` 的断言按"证据支持到哪"分级，所以两个故障场景**不**要求 `hop == Target`。
  这是刻意的，不是遗漏——见上表。
- 三个场景覆盖的是"连接建立期"和"已连接后中断"。任务书列的六种（TCP 拒绝、
  握手期 RST、认证期 RST、通道打开失败、已连接后中断、Shell 输出中中断）里，
  `target-blackhole` 与 `target-reset` 覆盖了其中四种的传输层形状；
  **认证期与 Shell 输出期需要按字节位置区分的注入点，本轮没有做**。
- 断流期间的 Shell 输出断言（"正在输出时中断，已有输出不丢、会话可回收"）不在本轮。

---

## 这一轮改动的文件

| 文件 | 改动 |
| --- | --- |
| `src-tauri/src/session/ssh/ssh_jump_target_leg_tests.rs` | 新增。目标腿场景的 Rust 侧断言 |
| `src-tauri/src/session/ssh.rs` | 注册新测试模块 |
| `src-tauri/src/session/ssh/ssh_jump_e2e_tests.rs` | `Fixture` 及其字段改为 `pub(super)`，供新模块复用 |
| `scripts/verify-install/ssh-jump-e2e.mjs` | 目标腿矩阵：每场景一个 proxy + 一个只放行该 proxy 的 bastion |

**未改动**：`connect_via_jump`、`PermitOpen` 的生产逻辑、任何 SSH 安全代码。
