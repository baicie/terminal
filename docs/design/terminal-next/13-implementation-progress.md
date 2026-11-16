---
status: progress-matrix
updated: 2026-11-16
scope: "Terminal Next UX-1 → UX-4 实际完成状态、证据、PR 与剩余风险"
---

# Terminal Next 实施进度矩阵

> 本文记录**真实**完成状态。`PASS` 只表示指定 SHA、指定环境与指定证据均通过。
> `NOT_RUN`、`PARTIAL`、`BLOCKED` 不是 `PASS` 的同义词，不得向上折算。
>
> 基线：`main@ff01f60`（PR #90～#94 已合并，main Ruleset 生效）。
> 当前工作分支：`feat/tn-ux1-04-session-sftp-lifecycle`（Draft PR #95）。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| `PASS` | 有生产实现 + 自动化/真实证据，在本文记录的 SHA 与环境上通过 |
| `IMPLEMENTED` | 有生产实现与单元/集成测试，但缺真实环境证据 |
| `PARTIAL` | 实现存在，但有明确链路、平台或行为缺口 |
| `NOT_RUN` | 代码或测试可能就绪，本轮未在真实环境执行 |
| `BLOCKED_EXTERNAL` | 缺设备、证书、权限等外部前置 |

---

## UX-1 · Terminal Workspace

| 能力 | 状态 | 位置 | 说明 |
| --- | --- | --- | --- |
| Activity Rail / StatusBar / TitleBar | `PASS`（既有） | `components/activity-rail`、`status-bar` | PR #36 已合入，本轮未改动 |
| Connection Explorer（搜索/收藏/分组/最近） | `PASS`（既有） | `features/connection-explorer` | PR #37 已合入 |
| SFTP Context Dock / pin / deferred release | `PASS`（既有） | `right-panel`、`sftp-binding` | PR #39 已合入 |
| **Session 四种移除路径统一通知** | **`IMPLEMENTED`** | `session/manager.rs` | 本轮修复；3 条新测试（自然完成、恰好一次、shutdown 后不重复）。真实远端断开 E2E `NOT_RUN` |
| **SFTP 重复连接契约（幂等 / 替换死条目）** | **`IMPLEMENTED`** | `sftp.rs` | 本轮修复；3 条契约测试 + 真实 sshd 5/5（既有用例，覆盖上传/下载/并发路径，**不覆盖**重复 connect 场景） |
| **Layout hysteresis 双向恢复** | **`PASS`** | `layout/layout-hysteresis.ts` | 本轮修复真实缺陷：回升分支永不成立。3 条新测试在旧实现上全部变红 |
| 双 Pane / 分屏 | `PASS`（既有） | `terminal-split-sash` | PR #44 起 |
| 三平台 Native GUI E2E | `NOT_RUN` | `e2e/gui` | 本轮未重跑；Windows 曾有 19/19 首次通过记录（PR #94） |
| 物理键盘 / IME / Vim / tmux / DPI | `BLOCKED_EXTERNAL` | — | 需真实输入设备与交互环境 |
| **Context Dock 单占位者公共契约** | **`PASS`** | `store/right-panel-state.ts` | 本轮实现：union 命名 `none/sftp/snippets/inspector/ai`，`IMPLEMENTED_RIGHT_PANEL_OCCUPANTS` 区分「已声明」与「已实现」，`resolveRightPanelMode` 对未实现占位者回落 `none`。源码级守卫测试禁止重新引入第二个布尔量，已用变异验证（加 `sftpOpen` 即变红） |

### UX-1 本轮修复的三个真实缺陷

1. **自然完成不通知** —— `spawn_completion_cleanup` 清理三张表但从不调用 `notify_removed`，导致自然结束的 session 在 `sftp_sessions` 留下悬挂 `Arc<SftpSession>`，直到进程退出。
2. **移除竞态重复通知** —— `remove_session` 无条件通知，同一 id 两次关闭触发两次 listener。
3. **Hysteresis 单向锁死** —— 回升分支要求列布局比抽屉多出超过 band 的列数，而列布局必然更少，条件恒假。面板一旦降级就永远不恢复。

---

## UX-2a · 连接时凭据体验

| 能力 | 状态 | 位置 | 说明 |
| --- | --- | --- | --- |
| **连接时一次性密码 / 私钥，不保存** | **`IMPLEMENTED`** | `one-time-credential.ts`、`connect-credential-dialog.tsx`、`use-host-connect-actions.ts` | 16 条新测试。秘密只进进程内 profile，不进 tab/store/DB/vault/localStorage。真实 sshd 端到端 `NOT_RUN` |
| **认证失败不持久化** | **`PASS`** | 同上 | 结构上无写入可失败：唯一持久副作用是进程内 profile，取消或 tab 打开失败即丢弃，有测试钉住 |
| **Host 损坏/未知引用可清除** | **`PASS`** | `host-stored-credential.tsx`、`host-clear-credential.test.tsx` | 三态规则；malformed / unknown-provider / unsupported-version 均显示清除入口。3 条在旧 gate 上红 |
| **SSH Key 损坏引用可清除** | **`PASS`** | `ssh-keys.ts::clearSSHKeyCredential`、`clear-key-credential-action.tsx` | 此前完全无入口。先失去引用再删密文；无法解析时仍执行 UPDATE |
| Vault 三态（uninitialized / locked / unusable）内联恢复 | `PASS`（既有） | `vault-recovery.tsx` | Phase 10.2 A2 已合入 |
| 成功后显式保存 | `NOT_RUN` | — | 设计要求独立的确认步骤；本轮只做"仅本次使用" |
| `authType` 切换丢弃旧方式 kind | `PASS`（既有） | `hosts.ts` | Phase 10.3 已修 |
| **CredentialRef V2 / Provider Registry / 按 provider 分派** | `NOT_RUN` | — | `TN-UX2A-02` 未开始 |
| 系统 Keychain / Credential Manager / Secret Service | `BLOCKED_EXTERNAL` | — | 需跨平台真实签名与隔离 profile 证据 |
| Replace 导入的 `secretPolicy` | `PARTIAL` | `db_import` | 当前 `COALESCE` 是安全兼容行为；显式策略需状态机语义先行 |

---

## UX-2b · 凭据存储抽象

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| Vault 写入安全（秘密列字面 NULL、版本化、命名空间拆分） | `PASS`（既有） | Phase 10.1～10.4 已合入 |
| **`CredentialRef V2`（按 `provider` 分派）** | **`PASS`（链路级）** | `credential-resolver.ts::providerFor`。真实生产路径 `session-credentials.ts` 已构造带 registry 的 resolver。变异验证：把 resolver 回退到 HEAD 版本，`refuses a foreign provider instead of reading the vault` 立即变红。另实现 `ProviderDispatchingResolver` 提供五种独立状态的完整语义 |
| **`SecretProvider` Registry** | **`PASS`** | `credential-provider-registry.ts`：`vault` 已注册，三个系统 provider 报告为 `unsupported` 而非省略；重复注册抛错；`registerBuiltInProviders` 幂等 |
| 跨 Provider 写入/读回/切换/补偿 | `NOT_RUN` | — |
| 凭据批量迁移 | `NOT_RUN`（未授权） | 需显式批准；按规则不得自行执行 |

---

## UX-3 · 内置扩展平台

| 能力 | 状态 |
| --- | --- |
| **Typed Capability Gateway** | **`IMPLEMENTED`** | `features/extensions/capability-gateway.ts` + `approval-book.ts`。25 条对抗性测试。无 Registry / Manifest 加载器 |
| Extension Manifest / Registry / SDK | `NOT_RUN` | Gateway 是前置，本轮先建边界 |
| Snippet Dock 扩展 | `NOT_RUN` | — |
| 扩展异常隔离与资源回收 | `PARTIAL` | `Disposable` 幂等与 generation 失效已实现并有测试；完整 activate/deactivate 状态机未实现 |
| Rust 侧 `ExtensionIntent` Gateway | `NOT_RUN` | 本版本不允许扩展跨进程边界，暂不需要 |

整阶段未开始。依赖 UX-1 的 Dock 单占位者契约（当前 `PARTIAL`）。

---

## UX-4 · AI Assistant 与 Server Inspector

| 能力 | 状态 |
| --- | --- |
| ModelDriver / OpenAI-compatible Adapter | `NOT_RUN` |
| Model Profiles / API Key 安全存储 | `NOT_RUN`（依赖 Provider Registry） |
| 四项能力（Explain Selection / Error / Summarize / Draft Command） | `NOT_RUN` |
| Server Inspector | `NOT_RUN` |
| Rig MSRV / 体积 / Audit 评估 | `NOT_RUN` |

整阶段未开始。

---

## 本轮 PR

| PR | 分支 | Head SHA | CI | 状态 | 风险 / 回滚 |
| --- | --- | --- | --- | --- | --- |
| [#95](https://github.com/baicie/terminal/pull/95) | `feat/tn-ux1-04-session-sftp-lifecycle` | `785ec1f` | 见 PR（17+ 通过 / 0 失败） | Draft | 三次提交可独立回滚；无 schema / IPC / Identifier 变更 |

### 提交明细

| SHA | 内容 | 关键证据 |
| --- | --- | --- |
| `8bcaa84` | Session 通知 + SFTP 契约 + hysteresis | Rust 440/0；变异验证 3 红；真实 sshd 5/5 |
| `f6fec4b` | Host/Key 损坏引用可清除 | 前端 2360/0；3 条在旧 gate 上红 |
| `785ec1f` | 一次性凭据连接 | 前端 2388/0；16 条新测试 |
| `e2c4500` | Context Dock 单占位者契约 | 前端 2400/0；9 条契约 + 3 条源码守卫（变异验证 1 红） |
| `b41a66c` | Provider Registry + 按 provider 分派 | 11 条新测试；**变异验证 2 条在旧 resolver 上红**；生产路径 `session-credentials.ts` 已接线；顺带修复 cert 认证无证书时的空证书握手 |

---

## 距离各里程碑还缺什么

### Core Daily Driver

- 真实 macOS GUI 全流程验收（Focus / Explorer / Dock / 分屏 / 错误态 / 窗口控件）`NOT_RUN`
- 7 天真实使用 Scorecard `NOT_RUN`
- 三平台原生运行矩阵 `NOT_RUN`／`BLOCKED_EXTERNAL`

### Credential Ready

- `CredentialRef V2` + Provider Registry + 按 provider 分派（UX-2b 主体）
- 系统 Keychain / Credential Manager / Secret Service 的真实稳定访问门禁
- 成功后显式保存
- 凭据批量迁移需显式授权

### Extension Ready

- UX-3 全部
- Dock 单占位者公共契约（UX-1 遗留 `PARTIAL`）

### AI MVP Ready

- UX-4 全部
- 前置依赖：安全 SecretProvider（存 API Key）+ Capability Gateway

### Signed Release Ready

- Apple notarization、Windows Authenticode、Tauri updater pubkey 均 `BLOCKED_EXTERNAL`
- 产品 Identifier 迁移未执行（需批准）

---

## 需要人工决策 / 外部依赖

| 项 | 类型 | 说明 |
| --- | --- | --- |
| 系统 Keychain 作为默认 Provider | 人工决策 | 需先有跨构建/升级/回退的稳定读取证据 |
| 凭据批量迁移执行 | 人工授权 | 会写 Vault 并清理明文列 |
| 产品 Identifier 变更 | 人工批准 | 涉及五处路径派生，`vault.json` 不在其中 |
| Apple / Windows 签名证书 | `BLOCKED_EXTERNAL` | 公开分发前置 |
| 物理键盘、IME、串口、Pageant 硬件 | `BLOCKED_EXTERNAL` | 需真实设备 |
| AI 自动执行任何命令 | **明确禁止** | 模型输出只作为草稿 |

---

## 下一项最优先工程任务

**Extension Registry + Manifest（`TN-UX3-02`），然后接 Snippet Dock 作为首个内置扩展。**

理由：Gateway 本轮已建好，它定义了"扩展能做什么"。没有 Registry，就没有东西能拿到 Gateway 授予的 context —— 边界存在但无人使用，这是"代码存在、链路不通"的失败模式。Registry 是让 Gateway 真正被使用的最小下一步，且它不依赖任何外部设备或证书。

Snippet Dock 紧随其后，因为它是设计指定的第一个内置扩展，且只依赖已有的 Snippet service 与 `terminal.read-selected`，不需要 AI、网络或新的 Rust 权限 —— 它是验证整条扩展链路（注册 → 激活 → 命令/菜单/Dock 注册 → 停用清理）的最短路径。
