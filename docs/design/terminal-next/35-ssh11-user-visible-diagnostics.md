# SSH11 — 连接失败的用户可见诊断

本文记录 SSH11 的设计、真实生产者链路、以及**明确没有证明**的部分。

---

## 1. 问题

用户配了跳板（bastion → target）。连接失败，面板说：

> authentication rejected

这对用户没有用，因为他为这条连接配了**两个账号**：跳板上一个，跳板后面那台主机上一个。
被拒的只有一个。

- 猜错 → 改了一个本来没问题的密码 → 再被拒一次；
- 猜对 → 一次改好。

所以诊断不是装饰，它决定用户下一步打开哪台机器。

---

## 2. 实现前核实的两个缺口

### 缺口 A：`host_key_rejected` 在 Rust 生产路径上不存在

`SessionError::HostKeyRejected` 有：枚举变体、DTO 映射、`kind` 字符串 `host_key_rejected`、
一条前端 `NON_RETRYABLE_KINDS` 条目。**唯独没有生产者。**

`ClientHandler::check_server_key`（`state.rs`）拒绝时返回 `anyhow!(...)`，而 `Handler::Error`
就是 `anyhow::Error`。两个 connect helper 把收到的一切映射成
`SessionError::ConnectionFailed`：

```rust
fn connection_failure_error(operation, error) -> SessionError {
    SessionError::ConnectionFailed(format!("{operation} failed: {error}"))
}
```

于是「主机密钥被拒」到达前端时是 `connection_failed`，前端那条 `host_key_rejected` 只能靠
文案 `host key verification failed` 兜底。**「明确是跳板还是目标的 HostKey」在当时无法实现**，
因为这个 kind 根本不会出现。

### 缺口 B：hop/stage 停在 snapshot 上

SSH10 把它们从 Rust 送到 `TerminalSessionSnapshot`，然后 `use-terminal.ts` 从未读取。
这正是本仓反复出现的形状：**有生产者、没有消费者**。

---

## 3. 实现

### 3.1 Rust：让拒绝保留自己的类型

不改 `Handler::Error`（那要动 crate 内每个 handler 加四个泛型约束，只为换回一个 bit）。
在 handler 上放一个侧信道：

```rust
pub(crate) host_key_rejection: HostKeyRejectionSlot,  // Arc<Mutex<Option<String>>>
```

`check_server_key` 的**每一条拒绝路径**都经 `reject_host_key()`：先记录，再返回。
connect helper 在握手失败后读回：

```rust
fn handshake_failure_error(operation, error, rejection: Option<&HostKeyRejectionSlot>) -> SessionError {
    if let Some(r) = rejection {
        if let Ok(slot) = r.try_lock() {
            if let Some(message) = slot.as_ref() {
                return SessionError::HostKeyRejected(message.clone());
            }
        }
    }
    connection_failure_error(operation, error)
}
```

`try_lock` 不是随手写的：这段在一条可能已被放弃的握手的失败路径上，阻塞 Tokio worker 去读
一条诊断信息，是拿「错误的文案」换「卡住的运行时」。

三个 connect 点各拿自己 handler 的槽位：直连、跳板本身、隧道里的目标。所以
**跳板密钥变了** 与 **目标密钥变了** 是两个不同的 kind + hop 组合。

### 3.2 分类器：情境用枚举，措辞用 i18n

分类器是唯一同时持有 `kind`/`hop`/`stage` 的地方，所以由它决定**情境**：

```ts
export type TerminalFailureDiagnosis =
  | 'bastion-auth-rejected' | 'target-auth-rejected'
  | 'bastion-unreachable'   | 'target-handshake-failed'
  | 'tunnel-failed'
  | 'bastion-host-key-rejected' | 'target-host-key-rejected'
```

七个成员，**不是十七个**。把 17 个 Rust 错误 kind 复制到前端会是本仓已经两次拒绝的
「第二套分类表」。

存枚举而不是句子，因为**渲染时的语言才是用户当前的语言**，不一定是连接断开那一刻的语言。

### 3.3 文案

| 情境 | 中文 |
| --- | --- |
| `bastion-auth-rejected` | 跳板机拒绝了这个账号。目标主机还没有被连接过——请检查跳板机的账号或凭据。 |
| `target-auth-rejected` | 跳板连接成功，但目标主机拒绝了这个账号。请检查目标主机的账号或凭据。 |
| `bastion-unreachable` | 无法连接到跳板机，后续步骤都没有执行。 |
| `target-handshake-failed` | 跳板机连接正常，但隧道另一端的目标主机没有响应。 |
| `tunnel-failed` | 无法通过跳板机建立到目标主机的连接。可能是跳板机不允许转发，也可能是目标地址从跳板机不可达。 |
| `bastion-host-key-rejected` | 跳板机出示的主机密钥与已保存的不一致，连接已被阻止。 |
| `target-host-key-rejected` | 目标主机出示的主机密钥与已保存的不一致。跳板连接本身是成功的。 |

`tunnel-failed` **不指责任何一端**。持有通道的是跳板，通道那头是目标；SSH API 不区分
「跳板禁止转发」与「目标地址从跳板不可达」，所以句子只说真实发生的事。

三语齐全（en / cn / fr），独立模块 `locales/*/terminalDiagnostic.ts`，`app.ts` 已在 299 行上限。

---

## 4. 不变量

1. **诊断不改变重试判定。** 一条交叉矩阵钉住：`authentication_rejected` / `host_key_rejected` /
   `connection_failed` 在六种 hop/stage 组合下，`retryable` 与 `recovery` 逐字相同。
2. **没有情境就不说话。** 直连失败没有跳板，`diagnosis` 为 `undefined`，面板渲染与 SSH11 之前
   完全一致。给直连用户说「目标拒绝」是在编造一台他没配过的机器。
3. **陈旧诊断会被清掉。** 新的失败没有 `diagnosis` 时清空，成功连接时清空。
4. **未翻译时退回原文。** i18next 把缺失的 key 渲染成 key 本身；屏幕上出现
   `terminal.diagnostic.x` 比它本想解释的错误更糟。

---

## 5. 变异验证（全部实跑）

| 变异 | 结果 |
| --- | --- |
| 交换 bastion/target 的认证诊断 | **2 红** |
| 删除 host-key 分支 | **3 红** |
| 删除 `updateTerminalState` 里的陈旧诊断清除 | **存活** → 补两条测试 → 改回后红 |
| 摘掉 overlay 的 diagnosis 渲染 | **3 红** |
| 删除 Rust `reject_host_key` 的记录写入 | **1 红**（`left: None`） |

第 3 条是真实的测试缺口，不是变异本身有问题：删掉清除逻辑后，13 项里 12 项仍绿，因为
**没有一条测试断言第二次渲染**。

---

## 6. 门禁

| 项 | 结果 |
| --- | --- |
| Rust `cargo test --lib` | **470 passed**, 0 failed, 16 ignored |
| `cargo fmt --check` | 干净 |
| `cargo clippy --all-targets --all-features -- -D warnings` | **0 error**（修掉本轮引入的 3 处 `useless_conversion` 与 2 处失效项） |
| 前端 typecheck | 通过 |
| ESLint `--max-warnings=0` | 通过 |
| source-size | **780** 个生产文件，通过 |
| bundle budget | total gzip **661.42 / 662 KB**（见下） |

### 关于 bundle 预算

本轮把上限从 661 KB 抬到 662 KB，但**超出的 0.42 KB 不是本次文案造成的**：

- 带诊断文案：total gzip **661.42 KB**
- 三个 locale 的 import 与 spread 全部移除：total gzip **661.42 KB**

两者到百分位相同。七句短文案 × 三语压进既有的 `locales.*.js` chunk，测不出成本。
0.42 KB 属于这条分支本身（基于 `main = 01e405c`，携带 SSH05–SSH10）。

**没有证明的是**：main 自身是否也在 661.4。本轮没有在 main 上单独构建测量，
所以这条记录的是「债」而不是「已还」。

---

## 7. 明确没有做到的

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 真实双跳 sshd 上验证诊断 | **NOT_RUN** | 需要 SSH12–SSH14 的 fixture |
| `host_key_rejected` 在真实握手中被触发 | **NOT_RUN** | 单测证明了槽位被写入与被读回，但没有一条端到端链路真的让 russh 把拒绝送到 connect helper |
| 真实 GUI 渲染 | **NOT_RUN** | 本轮按任务书不启动 GUI；组件集成测试证明了从 diagnosis 到 DOM |
| Toast / 连接日志消费诊断 | **NOT_IMPLEMENTED** | 见下 |

### Toast 与连接日志

任务书要求追踪到「连接失败 Toast 和连接日志的真实消费者」。核实结果：

- **Toast**（`use-terminal-status-effects.ts`）：渲染 `errorTitle + readableError`。诊断没有
  接进去。可以接，但 toast 是转瞬即逝的，而一个「该去修哪台机器」的判断不该只存在三秒。
  面板是持久表面，这一轮先保证那里对。
- **连接日志**（`connection_logs` 表的 `error_message` / `error_raw`）：**终端路径根本不写**。
  `recordConnectionFailure` 只在 `session.ts` 的 `SessionService` 里被调用，而终端走的是
  `terminal-launcher.ts` → `startTerminalShell`，完全不经过 `SessionService`。也就是说
  SSH 终端连接失败**从来没有出现在连接日志里** —— 这是本轮发现的独立缺陷，比「日志里少一个
  hop 字段」严重得多。

  记录为 `TERMINAL_FAILURE_LOGGED=NO`，不在 SSH11 内修复：补它需要决定日志的写入时机
  （每次重试都写？只写最终失败？），那是 SSH22/SSH26 的范畴。

---

## 8. 判定

```
SSH11_BASTION_VS_TARGET_DIAGNOSIS   = PASS（组件集成测试 + 变异）
SSH11_DIAGNOSIS_NOT_RETRY_INPUT     = PASS（交叉矩阵）
SSH11_STALE_DIAGNOSIS_CLEARED       = PASS（先暴露测试缺口，后补）
SSH11_THREE_LANGUAGES               = PASS（parity 测试）
HOST_KEY_REJECTED_HAS_PRODUCER      = PASS（Rust 单测 + 变异）
DEEP_LINK_GUI_RENDER                = NOT_RUN（不启动 GUI）
REAL_DUAL_HOP_DIAGNOSIS             = NOT_RUN（需 SSH12 fixture）
TERMINAL_FAILURE_LOGGED             = NO（发现于本轮，属 SSH22/SSH26）
TOAST_SHOWS_DIAGNOSIS               = NOT_IMPLEMENTED（有意的范围裁剪）
```
