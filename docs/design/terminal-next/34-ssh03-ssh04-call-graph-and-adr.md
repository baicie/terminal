# SSH03 / SSH04 — SSH 连接失败的调用图与错误架构决策

本文是 SSH05–SSH11 的前提：先把真实传播链画出来，再冻结一套设计，不试错。

---

## SSH03 — 影响面清单（实测，不是估算）

### 1. 类型定义

| 类型 | 位置 | 说明 |
| --- | --- | --- |
| `SessionError` | `session/types.rs:98` | 17 个变体的枚举，`#[serde(from/into = SessionErrorDto)]` |
| `SessionErrorDto` | `session/types.rs:145` | `{ type, message }`，**唯一**的 IPC 形状 |

### 2. Tauri command 出口

`grep -c "Result<[^>]*, SessionError>"` = **96 处**。

其中**只有 6 个是连接建立**：

```
session_create_ssh_password   commands.rs:126
session_create_ssh_key        commands.rs:194
session_create_ssh_agent      commands.rs:264
session_create_ssh_cert       commands.rs:327
session_create_ssh_jump       commands.rs:403
session_create_local          commands.rs:22   （Local PTY，无 hop 概念）
```

其余 90 个是 `session_write` / `session_resize` / `session_close` / `exec` / 密钥管理等 ——
任务书明确说「后四类不需要为了 Jump Hop 被全量迁移」。

### 3. 构造点

生产代码中 `SessionError::` 构造 = **174 处**（排除 `types.rs` 的 DTO 映射与测试）。

### 4. `match` / `matches!`

19 处。逐一核查后确认：**没有一处是穷举 match**，全部带 `_ =>` 通配臂。

实际查到的两处「看起来像穷举」的：

| 位置 | 结局 |
| --- | --- |
| `session/ssh_writer.rs:285` | 逐变体改写消息后跟 `_ => SessionError::ChannelError(...)` |
| `ssh_host_key.rs:244` | 三个变体转 `SshHostKeyError` 后同样有通配臂 |

这一条查起来值得：**如果我按「19 处 match」这个数字去决定架构，会高估加变体的代价**；
而按「174 个构造点」去决定，又会低估。真实的数字是 174 个构造（不能改）与 0 个穷举
match（改变体不破坏编译）。两者共同指向同一个结论：**不要动 `SessionError`，在它外面
包一层**。

### 5. 序列化

`SessionErrorDto::from` 是唯一转换点（`types.rs:151`）。`serde_json::to_value` 在错误
路径上只有 1 处（测试里的 round-trip）。

### 6. 前端消费者

| 位置 | 读什么 |
| --- | --- |
| `terminal-session-manager-errors.ts:153` | `record?.type ?? record?.kind` |
| 同上 `:42` | `NON_RETRYABLE_KINDS` 集合，按 `type` 判定 |
| 同上 `:134` | `CREDENTIAL_RECOVERY[credential.kind]`，与 hop 正交 |

**前端只读 `type` 与 `message`，不读任何其他字段。** 新增可选字段对它是透明的。

### 7. 真实的 SSH 连接失败传播链

```
session_create_ssh_jump (commands.rs:403)
  └─ TerminalSession::new_with_jump          session/ssh.rs
       └─ new_with_jump_inner                 :1558
            ├─ [1] connect_authenticated_jump_host_with_shutdown   ← 跳板
            │        └─ connect_tcp_with_shutdown + authenticate
            │           每一处 map_err → SessionError
            ├─ [2] open_jump_host_tunnel                            ← 隧道
            │        └─ channel_open_direct_tcpip
            └─ [3] connect_stream_with_deadline                     ← 目标
                     └─ 在 direct-tcpip channel 里做目标握手与认证
```

三处全用 `?` 上抛，**类型上不可区分**（这就是 RC16 的缺口）。

---

## SSH04 — 错误架构 ADR

### 决策

**保留 `SessionError` 作为底层原因类型，新增一个只用于连接建立路径的上下文包装。**

```rust
pub enum ConnectionHop { Direct, Bastion, Target }

pub enum ConnectionStage {
    TcpConnect, Handshake, HostKeyVerification, Authentication, TunnelOpen, ChannelOpen,
}

pub struct SessionFailure {
    pub error: SessionError,
    pub hop: Option<ConnectionHop>,
    pub stage: Option<ConnectionStage>,
}
```

### 被否掉的两个方案，与理由

#### 方案 A：把 `hop`/`stage` 加进 `SessionError` 的变体

**否决。** 174 个构造点里绝大部分与跳板无关（写、resize、close、exec、密钥生成）。
给它们全部加两个恒为 `None` 的参数，是把一个连接路径的需求扩散到整个错误类型。

#### 方案 B：把 96 个命令出口的返回类型全换成 `SessionFailure`

**否决。** 90 个命令永远没有 hop。换签名是在说「这些也可能有」，而它们不会有。

#### 方案 C：改 `SessionError` 外层但保持 `Result<_, SessionError>` 不变

**否决。** `SessionError` 是序列化边界（`#[serde(into = "SessionErrorDto")]`），
hop 装不进去；包装类型在第一个 `?` 处就被拒绝 —— 这是我上一轮实测撞到的墙。

### 采用的方案：只改 6 个连接命令的返回类型

```rust
// 6 个 session_create_ssh_* 的签名
) -> Result<String, SessionFailure>
```

```rust
impl From<SessionError> for SessionFailure {
    fn from(error: SessionError) -> Self {
        // 未附加上下文。这是**允许**的方向：不是每个失败都知道自己在哪一跳。
        Self { error, hop: None, stage: None }
    }
}
```

**禁止**反向转换（`From<SessionFailure> for SessionError`）：那会静默丢掉 hop，
而生产传播链中一旦有人用了它，这个特性就名存实亡。如果某处确实需要裸错误，
必须显式 `.error`，让调用点可见。

### IPC 契约（SSH05 的输入）

扁平结构，三个新字段全部可选、序列化时省略：

```json
{ "type": "authentication_rejected", "message": "…", "hop": "bastion", "stage": "authentication" }
```

| 要求 | 满足方式 |
| --- | --- |
| 原 `type` 值不变 | 复用现有 `SessionErrorDto` 的 17 路映射 |
| 原 `message` 语义不变 | 同上 |
| `None` 时省略 | `#[serde(skip_serializing_if = "Option::is_none")]` |
| 旧消费者忽略新字段 | 前端只读 `type`/`message`，已核实 |
| 旧输入仍可解析 | `#[serde(default)]` |
| 未知值不 panic | `#[serde(other)]` 兜底或 `Option<String>` |
| 不含秘密 | hop/stage 是枚举常量，无自由文本 |

**不复制二十多个错误分类**：`SessionFailureDto` 复用 `SessionErrorDto` 的映射，
只额外携带两个枚举字段。

### 序列化实现的选择

用 `#[serde(flatten)]` 把 `SessionErrorDto` 嵌进 `SessionFailureDto`：

```rust
#[derive(Serialize)]
struct SessionFailureDto {
    #[serde(flatten)]
    error: SessionErrorDto,
    #[serde(skip_serializing_if = "Option::is_none")]
    hop: Option<ConnectionHop>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stage: Option<ConnectionStage>,
}
```

理由：扁平形状由 serde 保证，不需要手写 `Serialize`；`SessionErrorDto` 是私有的，
flatten 不会把它泄漏成第二个公开契约。

### 不变量

1. **hop 不决定重试**。`NON_RETRYABLE_KINDS` 只看 `type`。跳板认证失败与目标认证失败
   的重试语义完全相同 —— 换一台机器登录，同样是「别再试了」。
2. **不确定就不填**。外层超时不知道卡在哪一阶段时，`stage` 留空而不是猜。
3. **次级错误不覆盖原始错误**。清理阶段（`disconnect_*`、`cleanup_deadline`）的失败
   只记日志，不上浮。
4. **`Direct` 是显式的，但可以不填**。直连失败 `hop` 为 `None` 而非 `Some(Direct)`：
   两者语义相同，而 `None` 让"这个字段只有跳板路径才有意义"这件事在类型上成立。

### 迁移边界

| 层 | 是否改 |
| --- | --- |
| `session_create_ssh_*` × 5 | **是**（返回 `SessionFailure`） |
| `session_create_local` | 否（无 hop 概念） |
| 其余 90 个命令 | 否 |
| `SessionError` 本身 | 否 |
| `BoxedSshFuture` | 否（它不是错误类型） |
| 连接池获取失败 | **是**（它发生在连接路径上） |

### 长期维护成本

- 新增一个错误类型时，只需在 `SessionErrorDto` 的 17 路映射里加一行，`SessionFailureDto`
  自动携带；
- 新增一个 stage 时，只改枚举；
- 反向转换被禁止，所以不会有"加了 hop 又被丢掉"的静默退化。

---

## 判定

```
SSH03_CALL_GRAPH_COMPLETE          = PASS（本文 §1–§7）
SSH04_ADR_FROZEN                   = PASS（采用 SessionFailure，只改 6 个命令）
CONNECTION_COMMANDS_TO_MIGRATE     = 5（不含 local）
EXHAUSTIVE_MATCHES_ON_SessionError = 0（实测，降低了加变体的代价）
```
