# 04 — Rust Rig AI MVP：Model Profile、Driver 与 UI 契约

- 状态：**提案（Draft）**，UX-4 才实施
- **前置阻断**：MSRV ADR（见 `00-adr-architecture.md` §3.2）

---

## 1. 已实测的事实

| 项 | 值 | 来源 |
| --- | --- | --- |
| 本项目 `rust-version` | **1.96** | `src-tauri/Cargo.toml:8` |
| `rig-core 0.46.0` 要求 | **1.97.1** | `cargo generate-lockfile` 实测 |
| `reqwest` 是否冲突 | **否**（都是 0.13.x） | 实测锁定 `0.13.5` |
| 1.97.1 能否编译 | **能** | `cargo +1.97.1 check` 退出码 0 |
| 依赖增量 | **238 包** | 同上 |

## 2. 为什么需要独立的 MSRV ADR

把 `rust-toolchain.toml` 从 1.96 提到 1.97.1 会影响：

- `.github/workflows/*` 的三平台 CI（`rust-toolchain.toml` 被 CI 读取）
- `Cargo.lock` 全量重解析（238 个新包的传递依赖）
- `cargo audit` 基线（新包可能引入新 advisory）
- 证据指纹（`src-tauri/Cargo.toml`、`Cargo.lock` 都在 `FINGERPRINT_PATHS` 内）

**这不是「加个依赖」，是一次工具链升级。** 必须单独决策、单独验证、单独重采证据。

## 3. 依赖集成方式

```text
src-tauri/
  src/ai/            ← 隔离模块，feature gate
    mod.rs
    profile.rs       ← ModelProfilePublic 的存取
    driver.rs        ← ModelDriver trait
    rig_driver.rs    ← Rig 实现（feature = "ai-rig"）
```

**默认构建不包含 AI。** 未启用时：不建立模型连接、不启动任何后台任务、不注册额外 Tauri command。

理由：238 个依赖的编译成本与供应链面，不应由不用 AI 的用户承担。

## 4. 数据契约

### 4.1 可入 SQLite 的公开元数据

```sql
ai_model_profiles(
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  provider      TEXT NOT NULL,   -- 'openai-compatible' | 'anthropic'
  endpoint      TEXT NOT NULL,
  model_id      TEXT NOT NULL,
  parameters    TEXT NOT NULL,   -- JSON: temperature / max_tokens / timeout / streaming
  is_default    INTEGER NOT NULL DEFAULT 0,
  secret_ref    TEXT,            -- provider 引用，本身不能直接读秘密
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
)
```

**`secret_ref` 与 SSH 凭据的 `host:<id>` 命名空间必须隔离。** 见 `01-credential-keychain-vault.md` §2.1。

### 4.2 Rust 边界

```rust
pub struct ModelProfilePublic {
    pub id: String,
    pub provider: String,
    pub endpoint: String,
    pub model_id: String,
    pub max_output_tokens: u32,
}

pub enum AiAction {
    ExplainSelection,
    ExplainError,
    DraftCommand,
    SummarizeOutput,
}

pub struct AiRequest {
    pub request_id: String,
    pub model_profile_id: String,
    pub action: AiAction,
    /// 用户明确批准发送的文本。
    pub user_approved_text: String,
    // 无 API key、无 SSH credential、无 raw PTY handle
}

#[async_trait]
pub trait ModelDriver {
    async fn complete(
        &self,
        request: AiRequest,
        cancel: CancellationToken,
    ) -> Result<AiResponse, AiFailure>;
}
```

## 5. IPC 命令面

| 命令 | 用途 | 安全约束 |
| --- | --- | --- |
| `ai_profiles_list` | 列出 profile（不含 key） | — |
| `ai_profile_upsert` | 新建/更新 | key 走专属安全写入，**不是**通用 IPC |
| `ai_profile_delete` | 删除 | 同步清理 secret |
| `ai_test_connection` | 测试连通 | 不发送终端上下文 |
| `ai_generate` | 执行一次 action | 校验 requestId / 大小 / 超时 |
| `ai_cancel` | 取消 | 按 requestId |

**禁止**暴露 `read_secret(id)` 这类通用 IPC 给 WebView 或插件。

## 6. UI 契约

### 6.1 Settings > AI

| 字段 | 说明 |
| --- | --- |
| Profile 名称 | 如 `Work / DeepSeek` |
| Provider 类型 | OpenAI Compatible / Anthropic（先支持前者） |
| Endpoint | 官方预设 + 用户可覆盖 |
| Model ID | 自由输入，**不强制来自固定列表** |
| API Key | 只进系统凭据库或会话内存 |
| 参数 | temperature / max_tokens / timeout / streaming |
| Test Connection | 返回真实模型、延迟、HTTP 错误类别 |
| 状态 | Configured / Requires Key / Testing / Reachable / Unauthorized / Rate Limited / Unsupported / Offline |

### 6.2 Endpoint 安全

| 情况 | 处理 |
| --- | --- |
| HTTPS | 默认允许 |
| `localhost` / `127.0.0.1` 的 HTTP | 显式允许 |
| 其它明文 HTTP | **警告并要求确认** |
| 远程自定义 endpoint | 显示数据发送目标 |

## 7. V1 功能边界

| 功能 | 输入 | 输出 | 能否执行命令 |
| --- | --- | --- | --- |
| Explain Selection | 用户**主动选中**的文本 | 说明 + 风险提示 | **否** |
| Explain Last Error | 选中的错误片段 | 原因 + 建议 | **否** |
| Draft Command | 自然语言目标 | **只生成草稿** | **否** |
| Summarize Output | 用户明确选择的区间 | 脱敏摘要 | **否** |
| Save as Snippet | 用户审阅后的草稿 | 写入现有 Snippet 表 | 需点击确认 |

**禁止**：隐式读取整个 scrollback、clipboard、私钥、环境变量、SSH 认证参数、团队 token。

## 8. 安全门禁

- 模型输出是**不可信文本**，不得直接执行或自动复制进 Shell 输入队列
- 显示「将发送到模型」的预览，脱敏可编辑、可取消
- 缺 key / 401 / 403 / 429 / 超时 / 取消 / 流中断都要可恢复，且**不吞掉终端焦点、不销毁 Session**
- API Key 不在前端 devtools、日志、SQLite、错误对象、崩溃报告；集成测试实际扫描
- 用本地假模型服务做完整连通/断开/超时/取消/stream 测试；**「本机 mock PASS」与「真实 Provider PASS」严格分开**

## 9. 判定（全部待实施）

```
RIG_DEPENDENCY_CHECK     = PASS（已实测 1.97.1 可编译）
MSRV_UPGRADE_ADR         = 必需（未写）
RIG_MODEL_PROFILE        = NOT_IMPLEMENTED
RIG_READONLY_ACTIONS     = NOT_IMPLEMENTED
AI_SECRET_ISOLATION      = NOT_IMPLEMENTED
```

**不需要**重新验证 `agent-harness-lab` 已完成的 59 项离线测试与 MCP 验证。新问题只有一个：它能否与 Terminal 主工程的 1.96 基线兼容 —— 这个已在上面回答。
