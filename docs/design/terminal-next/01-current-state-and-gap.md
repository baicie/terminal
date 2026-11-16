# 01 · 当前源码事实与差距

> 取证日期：2026-11-16
> 事实基线：`main=5f248631e6fff10e824de34cd73b2291fc8ab416`
> 远端：`https://github.com/baicie/terminal.git`

## 1. 取证边界

本文件只把当前源码、测试、Git 提交、CI 运行和已归档证据当作事实。v2.0 合订版是设计输入，基线 `1a24eed` 已过时；用户提供的 10 张桌面图是视觉输入，不是实现证据。当前工作树有一个独立的 `fix/terminal-next-ux1i-runtime-acceptance` worktree，设计分支不得覆盖它。

最新状态核对结果：

- 当前分支起点为 `main`，工作树初始干净；本设计工作在 `design/terminal-next-unified-spec` 分支完成。
- 最近主线合并包含 CI 归因/发布门禁、Vault IPC 审计、SFTP GUI/命令级 E2E、SFTP 生命周期和 Release Qualification。
- 当前主线 CI run `43814394847` 成功，Upgrade E2E run `43814394934` 成功。
- `43814394934` 已执行 macOS 当前版本升级/恢复、Vault app-level、磁盘满、历史升级、Linux DEB、AppImage 替换和 Windows fail-closed 预检；Windows 完整升级与 AppImage stock 启动仍按报告边界处理。
- 最近一次 Native GUI E2E 成功运行的 HEAD 是 `71542f564b0f1e8f25ee0859f7507449809e925d`，不能当作当前 `main` `5f24863` 的 GUI 证据。
- 当前 Cargo crate 是 Rust `1.96`，`rig-core 0.46.0` 的 crates.io 元数据标为 `rust-version=1.97.1`；未将 Rig 加入项目 Cargo.lock。

## 2. 能力总表

| 领域 | 当前事实 | 状态 | 设计处理 |
| --- | --- | --- | --- |
| 技术栈 | Tauri 2、Rust、React 19、TypeScript、Vite、Zustand、shadcn/ui、xterm | `IMPLEMENTED` | 保留，不做框架迁移 |
| Terminal Plane | `MainLayoutContent` 以兄弟节点挂载 `TerminalByUrl`；`data-terminal-workbench` 与 OUTPUT ACK 约束保留 | `IMPLEMENTED` | 继续以生命周期服务拥有 Session |
| UX-1a Shell | Activity Rail、StatusBar、精简 TitleBar、默认终端层已合入 | `IMPLEMENTED` | 只做统一视觉和原生验收 |
| UX-1b Explorer | 搜索、收藏、分组、Recent、单左面板和唯一连接 Hook 已合入 | `IMPLEMENTED` | 继续改善管理态和 GUI 证据 |
| UX-1c Dock | `RightPanelMode` 当前为 `none\|sftp`，SFTP Pin/Follow 和关闭延迟释放已合入 | `IMPLEMENTED/PARTIAL` | Snippet/Inspector/AI 以后以 occupant 扩展，不另建布尔量 |
| Layout budget | `usePanelLayout({ explorerWidth })` 使用真实 Shell/Explorer/Dock/cellWidth，带 hysteresis | `IMPLEMENTED` | 继续用实际 cols/rows 做原生验收 |
| Tab/Split/Workspace | Zustand/AppStore、SplitTree、tab URL、恢复和 SessionManager 已有 | `IMPLEMENTED/UNVERIFIED` | 不能重新从零规划；补 4-pane、IME、跨平台 GUI |
| SFTP | Full/Dock、Queue、staged upload/download、Session claim/allowlist、Rust registry lifecycle、GUI/命令 E2E 已有 | `IMPLEMENTED/UNVERIFIED` | 以真实 UI→IPC→Rust→sshd 和关闭 Dock 证据为准 |
| SSH | password/key/agent/cert/Jump/known-hosts、timeouts、writer、ACK、自动重连已有 | `IMPLEMENTED/UNVERIFIED` | 真机平台矩阵和人工输入继续独立验收 |
| Host/Import | Host CRUD、OpenSSH Import、IdentityFile、ProxyJump、HostKey、Recent/Groups 已有 | `IMPLEMENTED/PARTIAL` | 编辑/导入失败状态和跨平台路径继续补齐 |
| Credentials | Vault AES-GCM/Argon2、版本化 ref、host/key 命名空间、结构化 Vault 状态、迁移/清除 UI 已有 | `IMPLEMENTED/PARTIAL` | UX-2a 交互与 Provider Registry 尚未完成 |
| Provider | `SecretProvider` 只有 Vault；`CredentialRef.provider` 是 `'vault'`；没有系统 Keychain/Credential Manager provider | `DESIGN_ONLY` | 先实现抽象和稳定性 Spike，默认不切换 |
| Vault IPC | `vault_get/set/list/delete` 是通用 KV 命令；最新 B01 记录了可信主 WebView 当前边界和长期收敛方向 | `PARTIAL` | Extension/AI 之前加入窄 Gateway，禁止复制任意 KV 权限 |
| Extension | 当前无生产 Extension Registry/SDK/Manifest/Lifecycle | `DESIGN_ONLY` | 只做可信内置 v0，主 WebView 动态 JS 不称为沙箱 |
| AI | 无生产 LLM Runtime；`src-tauri/src/agent.rs` 是 SSH Agent 协议，不是 AI Agent | `DESIGN_ONLY` | 先 ModelDriver 与安全边界，再 UI；Rig 是可选 adapter |
| Inspector | 没有生产 Server Inspector runtime | `DESIGN_ONLY` | 按需只读 probe，不做监控平台 |
| Logs | App Logs/Connection Logs/Transfer 记录存在；统一 Logs & Output Explorer 仍不完整 | `PARTIAL` | 来源、时间、脱敏和大列表独立规格 |
| Port Forward | Local/Remote/Dynamic 后端与管理页已有 | `IMPLEMENTED/UNVERIFIED` | 真实 -L/-R/-D 和端口冲突纳入 Level 2 |
| Release | 三平台构建、证据、升级、Updater 临时 key 验收基础已有；正式签名/公证/身份迁移仍是发布决策 | `PARTIAL/BLOCKED` | 视觉/功能 PR 不混入 Identifier 和签名改动 |

## 3. 当前真实调用链

### 3.1 Terminal

`MainLayout` → `MainLayoutContent` → `TerminalByUrl` → `TerminalContainer` → `useTerminal`/`TerminalSessionManager` → Tauri `session_create_*` / `session_write` / `session_resize` / `session_close` → Rust `SessionManager` → Local PTY 或 SSH Channel → output event/ACK → xterm。

`MainLayoutContent` 的 `LeftPanel` 和 `RightPanel` 与 Terminal Canvas 同级，打开或关闭面板不应触碰 `TerminalByUrl`。`usePanelLayout` 由 Shell 宽度、真实 Explorer 宽度、RightPanel occupant、实际 cell width 和 chrome width 共同决定布局；不得恢复旧的固定 `52px` 或只看 `window.innerWidth` 的算法。

### 3.2 Connection Explorer

Activity Rail 的 Connections 只切换 `leftPanel` 并保留 `/terminal`，Explorer 的连接动作走 `useConnectToHost`。Recent 来源是 `connection_logs`，不能用 `hosts.updated_at` 冒充最近连接。完整 `/hosts` 管理页和深链保留。

### 3.3 SFTP

前端 `RightPanel` 只显示 SFTP 视图；SFTP Host 由显式 binding/pin 决定。Transfer Queue 持有 transfer 状态，Rust `sftp_sessions` 通过 SessionManager removal listener 清理。Dock unmount 只影响视图；queued/running/finishing 任务通过 Lease/延迟释放保持资源，最终状态落地后再释放。

### 3.4 Credential

Host/SSH key 行只保存 `credential_ref` 和公开元数据；SecretProvider 在连接时读取。当前 `SessionCredentialResolver` 接收一个固定的 `VaultSecretProvider`，没有按 `ref.provider` 选择 provider。损坏/未知引用通过 `credentialRefProblem` fail-closed；Vault 未初始化、锁定、不可用和读取失败已经有结构化字段。Jump Host 的目标和跳板机分别解析凭据。

### 3.5 Release/Recovery

Rust 数据恢复、单实例锁、迁移标记、备份和升级 E2E 已在多个阶段实现。Release 工作流能运行临时签名 Updater probe，但这不等于正式签名、公证、Authenticode 或正式 updater key 已配置。产品 Identifier 仍是 `com.baicie.termius`，产品名仍是 `Termius`，任何修改必须独立做跨版本数据迁移。

## 4. UX-1 已完成内容与真实缺口

### 已合入，不能重复施工

- UX-1a Activity Rail、StatusBar、TitleBar 和默认终端壳。
- UX-1b Explorer、Recent/Favorites/Groups、单面板规则、`terminal-route.ts` 可见性裁决和唯一连接路径。
- UX-1c Right Dock、SFTP pinned host、关闭 Dock 不截断传输。
- F0 真实布局宽度、Compact Dock 单栏、SFTP Session Registry 生命周期、拖放/入队/完成刷新、GUI harness、SFTP command E2E 和 Release Qualification 的已合入部分。
- 16 条 UX-1 不变量以及后续 SFTP/GUI 证据完整性门禁。

### 仍需补齐或重新测量

- 当前 `RightPanelMode` 只有 SFTP；Snippet、Inspector、AI 必须沿用 occupant 模型，不得各加布尔开关。
- Native GUI 最新成功 SHA 尚未跟随当前 `main` 重采；窗口控件、DPI、中文 IME、真实物理键盘、Vim/tmux、跨平台焦点仍分层记录。
- UX-1 的代码实现不能写成 `TABBY_REPLACEMENT_READY=YES`；7 天日用数据仍是独立门禁。
- `ActivityRail` 仍保留部分管理路由入口；新设计不要求删除 `/hosts`、`/sftp`、`/vaults`、`/teams` 等深链。

## 5. UX-2 当前安全边界

当前代码已具备较强的 Vault 版本化写入和失败补偿，但仍是单 Provider 世界：

- `CredentialRef.provider` 只接受 `vault`。
- `SessionCredentialResolver` 的 provider 在构造时固定，未知 provider 只会被标记为不可读，不存在系统存储分派。
- Vault key 使用 `host:` 与 `ssh-key:` 独立命名空间，版本写入顺序是写入→读回→更新行→清理旧版本。
- SQLite 的旧明文兼容读取和迁移代码仍存在；迁移必须保持用户显式授权和回滚，不能在设计 PR 中自动执行。
- `vault_get` 的通用 KV 权限目前依赖可信单一 WebView 的边界；未来 Extension/AI 不得继承此命令。

因此 UX-2 不能被简化成“加一个 Keychain 库”。它需要 Provider Registry、按 ref 分派、跨 Provider 迁移、旧版本安全拒绝、导入导出保留未知引用和平台稳定访问证据。

## 6. UX-3/UX-4 当前状态

全仓当前没有可供复用的 Extension Registry、Manifest、Disposable 组合或 Capability Gateway。命令面板、Activity Rail、Right Dock 和事件服务是可接入的现有表面，但不能把它们的现有组件直接称为插件系统。

全仓当前没有 Rig、ModelDriver、AI Profile、AI Request、Context Review 或 Tool Approval 的生产实现。`agent.rs`、`authenticate_with_agent` 等命名属于 SSH Agent 语义。第一版 AI 应放在 feature-gated 的 ModelDriver 后面，不应把现有 Harness、MCP 或 SSH Agent 当作 AI 运行时。

## 7. 差距优先级

| 优先级 | 差距 | 为什么先处理 |
| --- | --- | --- |
| P0 | 设计入口、文档事实和旧基线治理 | 编码 Agent 会读到过时 SHA、旧技术栈和已合并 UX-1 任务 |
| P0 | SFTP/Terminal/Provider 的生命周期契约持续守护 | 视觉或扩展改动最容易重新引入 Session、传输和凭据竞态 |
| P0 | UX-2a 连接时保存/错误/清除语义 | 这是日用阻断，也是 Provider 改造的前置 |
| P1 | Tauri IPC/SQL/FS/Vault 的窄 Gateway | Extension 和 AI 之前必须收缩信任边界 |
| P1 | Native GUI 当前 HEAD 重采、Windows 真实交互和 IME | CI/浏览器测试不能证明桌面产品可用 |
| P1 | Extension v0 | 需要先验证生命周期和权限，不与第三方插件市场绑定 |
| P2 | 系统 Keychain/Windows Credential Manager | 需要签名、升级、回退和平台存储证据，不能提前作为默认 |
| P2 | Inspector 与 AI MVP | 核心终端、凭据和 Gateway 稳定后再开启 |
| P0 发布 | Identifier、正式签名、公证、Updater | 影响数据目录、Keychain、安装升级和正式分发，必须独立 PR |
