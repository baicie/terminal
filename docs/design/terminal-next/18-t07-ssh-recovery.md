# T07 SSH 故障恢复 —— 核对结论与一个无法在词法层关闭的缺口

> 基线 `main@3c0c841`。核对于 2026-11-21。

## 1. 已有覆盖（不重复开发）

重连链路已经相当完整，五个测试文件、**26 项**在 `terminal-session-manager-reconnect.test.ts`
单一文件里：

| 能力 | 证据 |
| --- | --- |
| 退避阶梯与预算 | `terminal-session-reconnect-policy.test.ts` |
| 停滞队列的旧输入丢弃 | `drops stale queued input but preserves the first input after manual reconnect` |
| wake 不复活无关失败 | `does not let a wake over a connected session arm a later unrelated failure` |
| 成功连接后清除 arming | `does not let a wake arming from a successful attempt trigger a later unrelated recovery` |
| Vault 失败不进网络重试 | `a host wake cannot resurrect a vault failure either` |
| 认证期传输中断可重试 | `retries authentication transport reset caused by a transient network failure` |
| 认证期超时可重试 | `keeps the automatic reconnect for a first-connection timeout` |

真实 sshd harness 也已存在：`scripts/terminal-smoke-sshd.mjs`、
`terminal-smoke-password-sshd.mjs`，以及既有
`ssh-real-connect.e2e.test.ts` / `vault-ssh-real.e2e.test.ts`。

## 2. 缺口：`authentication_failed` 一个 kind 承载两种相反的情况

### 两种情况

| 情况 | 正确处理 |
| --- | --- |
| 握手期间连接中断（凭据从未被检查） | **重试** |
| 服务器检查了凭据并拒绝 | **不重试**，直接告诉用户 |

Rust 侧对两者都发 `SessionError::AuthenticationFailed`（`session/types.rs:112`），
前端因此只能比较文案。

### 实测

| 消息 | 当前判定 | 是否正确 |
| --- | --- | --- |
| `auth failed: connection reset by peer` | 重试 | ✅ |
| `failed to connect SSH agent: connection refused` | 重试 | ✅ |
| `authentication failed: all methods rejected` | 不重试 | ✅ |
| `authentication failed: password my-timeout-secret rejected` | **重试** | ❌ |

最后一行的消息是我构造的，**真实路径不会产生它** —— Rust 不把用户密码插进错误
（见 T05/T12 的脱敏工作）。所以这是一个**理论缺口，不是当前可达缺陷**，我把它如实
记在这里而不是写成一个假想的修复。

### 为什么不在词法层修

我试过两种规则，都被既有测试推翻：

1. **「含凭据名词 + 拒绝动词即终态」** → 把
   `auth failed: connection reset by peer` 判成终态，破坏了「认证期连接中断必须重试」
   这条既有用例。两种句子共享全部词类。
2. **「传输信号优先」** → 又让含 `timeout` 的密码误判通过（即上表最后一行）。

词法无法区分，因为**区别不在文案里，在事件顺序里**：传输失败发生在凭据被呈现之前，
拒绝发生在之后。那个信息 Rust 知道、前端不知道。

### 结构性修复（未做）

在 `SessionError` 里新增一个 kind，例如 `AuthenticationTransportFailed`，由构造点
决定用哪个。`ssh.rs` 里有 **28 处** `AuthenticationFailed`，其中 agent 连接失败、
`format!("auth failed: {}", e)` 这类明显是传输；`all methods rejected` 这类是拒绝。
分类本身是可行的，但 28 处的改动面超出本轮范围，而且需要为每一处判断它属于哪一侧。

不作为本轮交付，记为下一阶段。

## 3. 本轮实际改动

`TRANSIENT_AGENT_FAILURES` —— 一份**新增的**、只包含本应用自己产生的 agent 措辞的
列表（`failed to connect ssh agent`、`agent auth failed`、
`ssh agent has no available identities`、`windows openssh authentication agent is unavailable`）。

这些是本地环境问题（keychain 未解锁、agent 未启动），重试真的可能解决，而且
**服务器不会回显这些句子** —— 所以它们不会误捕凭据拒绝。

原来的 `TRANSIENT_AUTHENTICATION_MESSAGES`（含 `timed out`、`connection reset` 等）
保留，因为「认证期超时/重置应重试」这条既有用例依赖它。

### 新增测试 2 项

- `authentication failed: all methods rejected` 不消耗重连预算（断言 sleep 调用 **0 次**，
  不是只断言最终状态）
- `failed to connect SSH agent: connection refused` 仍然重试（控制组）

断言 sleep 次数而非状态，是因为这个缺陷的表现正是「五次退避之后才告诉用户凭据错了」。

## 4. 仍未覆盖（`NOT_RUN`）

| 项 | 原因 |
| --- | --- |
| 真实 sshd 下的密码/私钥/HostKey/超时/拒绝/强制 kill | 需要起 sshd 并驱动真实 Tauri 应用；本轮只跑了前端分类层 |
| 物理 sleep/wake、真实网络切换 | 需要真实设备与网络环境 |
| 切 Host 后旧连接污染 | `terminal-session-manager.test.ts` 有 generation 守卫测试，但没有真实双 sshd 的端到端用例 |

前两项 `MANUAL` / `BLOCKED_EXTERNAL`；第三项可由现有双 host fixture 补，未在本轮做。
