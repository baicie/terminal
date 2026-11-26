# RC16 — 跳板失败无法归因到「哪一跳」

> **状态：已闭合。** 本文是缺口当时的记录，保留原样。`SessionFailure { error, hop, stage }`
> 就是这里论证出的方案——它作为命令的返回类型携带归因，绕开了 `SessionError` 的序列化
> 边界。落地与验证见下方「闭合」一节；判定已更新。

## 缺口

用户配了跳板（bastion → target）。连接失败时，前端拿到的是：

```json
{ "type": "authentication_rejected", "message": "..." }
```

**没有说这是跳板的凭据被拒，还是目标主机的凭据被拒。** 那是两台机器上的两个账号，
修法完全不同。

`connect_via_jump_inner`（`session/ssh.rs`）的三个出错点全部用 `?` 上抛：

```rust
let (jump_handle, jump_shutdown) =
    connect_authenticated_jump_host_with_shutdown(config.clone(), &jump_host, Some(deadline))
        .await?;                                    // ← 跳板认证失败
let target_channel = match open_jump_host_tunnel(...).await {
    Err(error) => { /* 清理 */ return Err(error) } // ← 隧道打开失败
};
// 第三步：目标主机在这一跳里认证
```

三种失败在类型上不可区分。

## 为什么不是一个「加个字段」的改动

试过的最短路径是给 `SessionErrorDto` 加 `hop: Option<Hop>`，再在跳板路径上标注。
它撞在三处：

1. **`SessionError` 本身就是序列化边界**。它有
   `#[serde(from = "SessionErrorDto", into = "SessionErrorDto")]`，而 Tauri 命令的签名是
   `Result<_, SessionError>`。所以 hop 必须能随 `SessionError` 走完整个返回链 ——
   一个包装类型（`HopAttributed`）在第一个 `?` 处就会被拒绝。

2. **加变体要动 55 个 `match` 点**。`SessionError` 有 20 个变体，全仓 55 处
   `SessionError::` 的匹配与构造。加一个携带 hop 的变体，会让每一个**穷举** match
   多一个分支。

3. **改 4 个认证变体的签名要动 16 处构造**，且它们的 DTO 往返也需要同步改。

## 已经确认的事实（可直接复用）

- `parseCredentialRef` 的三态与 `SessionError` 的 `kind` 分类都已正确，
  **问题只在于缺少「哪一跳」这一维**；
- `connection_key` 已把 bastion 身份编进连接池键（`jump_pool_key_includes_bastion_identity`、
  `direct_and_jump_pool_keys_cannot_collide` 两条测试），所以**池污染不是问题**——
  两个不同跳板不会共享会话；
- `validate_jump_auth_config` 已覆盖「跳板与目标的凭据类型不匹配」这一类**配置**
  错误，且能明确指出是哪一边配错了（`jump_auth_rejects_incomplete_certificate_credentials`）。

  换句话说：**配置阶段的错误已经能归因，运行阶段的不能。**

- 前端 `NON_RETRYABLE_KINDS` 按 `kind` 判定重试语义，与 hop 正交 —— 加 hop 不会改变
  任何重试行为，只是让提示能说清是哪一台。

## 一个被否掉的设计

把 hop 编进 `message` 的前缀（`"jump: authentication rejected"`），前端解析。
否掉的理由是本仓反复批评过的「靠文案猜」：`terminal-session-manager-errors.ts` 的
注释里已经记过一次同类教训（`could not be read` 被映射成 Unlock）。

## 建议的下一轮做法

把 hop 放进 `SessionError` 的**外层结构**而不是枚举变体：

```rust
pub struct SessionFailure {
    pub error: SessionError,
    pub hop: Option<Hop>,
}
```

代价是改 Tauri 命令签名（`Result<_, SessionFailure>`）与前端类型。收益是它一次性
解决，而不是给 20 个变体各开一个口子。**这需要单独一轮**，且要先确认前端**确实会
用它**——否则就是在错误类型上加一个没人读的字段。

## 闭合

`SessionFailure`（`session/types.rs:758`）把 `hop: Option<ConnectionHop>` 与
`stage: Option<ConnectionStage>` 挂在错误旁边，由命令签名的返回类型携带，
`SessionFailureDto` 逐字段序列化，前端 `TerminalFailure` 原样承接。三条当初"类型上
不可区分"的失败现在各有真实用例，且都在 CI 的 `Real SSH jump matrix` 里跑：

| 失败 | 用例 | 断言 |
| --- | --- | --- |
| 跳板认证被拒 | `a_bastion_refusal_is_attributed_to_the_bastion` | `hop=Bastion` |
| 目标认证被拒 | `a_target_refusal_is_attributed_to_the_target` | `hop=Target` |
| 跳板 host-key 不符 | `a_bastion_host_key_mismatch_is_refused_as_its_own_kind` | 自己的 kind + hop |
| 目标 host-key 不符 | `a_target_host_key_mismatch_is_attributed_to_the_target` | `hop=Target` |
| 跳板传输中断 | `an_injected_fault_names_its_own_leg_and_no_more` | `hop=Bastion`，且 blackhole 在预算内结束 |
| 跨跳板身份隔离 | `four_machines_keep_their_own_identity` | 四台各用自己的身份 |

「归因不得影响重试」这条不变量也有守护：只有 `kind` 决定可重试性，`hop`/`stage` 只
参与描述。真实运行里 `authentication_rejected` 被拒一次即停（RC15），`connection_failed`
走完预算。

## 判定

```
JUMP_CONFIG_MISMATCH_ATTRIBUTED   = PASS      （配置阶段，既有测试）
JUMP_RUNTIME_FAILURE_ATTRIBUTED   = PASS      （6 个真实双跳用例，CI 阻塞）
JUMP_POOL_KEY_ISOLATION           = PASS      （既有测试）
JUMP_DISCONNECT_MATRIX            = PARTIAL   （跳板腿三场景已覆盖；目标腿缺）
```
