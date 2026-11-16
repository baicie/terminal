# Terminal Next — Vault UX × Terminal Workspace × Extension Platform × Rust Rig

> 设计包 v1.0 · 2026-11-11 · 目标仓库 `baicie/terminal` · 仅设计与实施规划，尚未实施  
> 基线：2026-11-11 核实 `main` 约为 `13e9d96`（PR #33 功能合并 `e234091`）。执行前必须以仓库真实 HEAD 重新检查。  
> 产品定位：**Tabby 级别的终端效率 + VS Code 风格的轻量工作区 + macOS 低摩擦凭据体验 + 可选 Rust AI 助手**。

## 0. 决策摘要

| 决策 | 选择 | 不选择 |
|---|---|---|
| Vault | 系统凭据库作为日常默认保存路径；自带加密 Vault 保留为可选模式 | 强制首次建 Vault；明文落 SQLite / localStorage |
| 连接密码 | 连接时按需输入；认证成功后经用户选择保存 | 在创建主机前要求完成所有安全设置；连接失败也保存 |
| 布局 | Terminal Canvas 始终是主区域；可折叠 Connection Explorer；按会话打开 SFTP/AI 工具面板 | 管理后台式模块导航、独立页面截断终端流程 |
| 插件 | TypeScript 版本化 SDK + Rust capability gateway；先受信任内置插件，再隔离第三方 | 直接 `import` / `eval` 任意社区 JS 到 Tauri 高权限 WebView |
| AI | Rust Rig **库**，从 Model Profiles、连接测试、解释选中内容、错误解释开始 | 现在接入完整编码 Agent Loop、自动执行 Shell、自治编程 |
| 运行方式 | AI 小能力在 Rust/Tauri 层异步执行；定义可分离 driver | 默认捆绑 Node / DSH Runtime / 任意 npm 插件管理器 |
| 研发 | 每阶段独立 Draft PR、证据与真实 GUI 验收 | 一个超大 PR 同时迁移凭据、UI、插件、AI |

### 明确非目标

不复制 Tabby 的旧密码学实现；不复制 Tabby Angular 组件；不修改 `russh`、PTY/XTerm 核心工作方式；不让 AI 进程持有 SSH 凭据；不在 V1 实现插件商店、远程代码安装、MCP 全服务端、自动执行命令、多 Agent、向量记忆、索引整个磁盘。旧路由和旧数据暂保留，逐步降为“高级管理入口”，不直接删除。

## 1. 仓库实际基线与风险

核查到的真实代码：

- `src-tauri/Cargo.toml`：Rust edition 2021，声明 `rust-version = "1.96"`，Tauri 2、Tokio、russh、AES-GCM、Argon2、reqwest；目前未声明 Rig。
- `packages/frontend/src/service/credential-boundary.ts`：`CredentialRef.provider: 'vault'`，采用版本化 secret 引用，主机元数据与秘密隔离；旧引用 `LEGACY_VERSION=0`。这是需要保护的兼容边界。
- `packages/frontend/src/service/vault-secret-provider.ts`：当前唯一 SecretProvider，Vault 状态区分 `uninitialized/locked/unusable`。
- `packages/frontend/src/layout/main-layout-content.tsx`：TerminalByUrl 常驻层与 Outlet 分离，避免路由切换重建 PTY；必须保留该不变量。
- `packages/frontend/src/components/app-sidebar/index.tsx` 与 `router/nav-config.tsx`：按 Hosts、SFTP、Vaults、Teams、Logs 等“应用模块”导航，偏后台形态。
- `packages/frontend/src/components/top-toolbar/index.tsx`：顶栏承担工作区、标签、SFTP、通知、搜索等多种功能，视觉竞争较明显。
- `packages/frontend/src/view/hosts/index.tsx`：默认 Grid/Card 视图并有邀请提示、ViewHeader，更适合作为管理页而非主连接入口。
- `baicie/agent-harness-lab`：**已完成的独立评估**，Rig `0.46.0` + Rust `1.97.1`，59 项离线测试，真实 Tauri/macOS 集成、流式、多轮工具、MCP、审批、取消和恢复验证；结论 `CONDITIONAL GO`，Windows/Linux 尚未实证。应复用其审计与 `harness-contracts` 设计，不重做相同 POC，也不直接把完整 `harness-rig` 并入 Terminal。
- 截至 Phase 10.4.1，真实 Vault、SSH、Jump、SFTP、IME 和 7 天日用数据仍有 NOT_RUN，不可将设计改造自动视作验收通过。

### 与 Tabby 的可借鉴点

Tabby `PasswordStorageService` 在未启用自身 Vault 时走 `keytar`（macOS Keychain / 平台系统安全存储），启用 Vault 后切换到加密 Vault；SSH 连接尝试已保存密码，缺少时弹出密码输入并可勾选 Remember；解锁 Vault 支持 1/5/15/60/1440/10080 分钟记忆。借鉴**流程和策略**，不照搬其加密算法或把主密码塞入配置。

### 与 DSH 的可借鉴点

DSH/Cordis 的核心是服务注册、依赖注入、能力事件、可撤销的插件副作用、Profile/Bundle 组合；不是“下载 npm 包”本身。我们的插件机制要先有稳定能力边界和 lifecycle，再考虑生态分发。

---

## 2. Vault / Authentication — 交互与数据契约

### 2.1 用户路径（必须可在真实 GUI 中执行）

**首次连接密码主机**：`⌘K` 搜索主机（或 `⌘N` 新增）→ 输入 hostname/user/port → 连接 → 只有确实需要密码时展示当前会话内的认证 Modal → 用户输入 → 可选复选框“在本机安全记住” → SSH 成功认证 → 后端安全保存 → 下次连接无需再次填写。若取消/认证失败，不保存或更新任何长期秘密。

**系统默认保存**：macOS Keychain / Windows Credential Manager / Linux Secret Service（若环境不可用则明确提示）存密码；没有系统安全存储能力时，提供“本次输入”或“创建加密 Vault”，**禁止静默明文 fallback**。OS 级访问授权对话框由系统决定。

**加密 Vault 用户**：设置 > Security > Credential Storage 允许主动选择 Vault。需要解锁时在**当前连接窗口**弹出一次解锁框，选择此次/15 分钟/1 小时/退出前记住；成功后恢复原连接，不跳转页面、不丢密码与连接上下文。应用重启后不默认保持解锁。

**SSH Agent**：自动检测可用 Agent（读取元数据不代表允许使用任意密钥）；用户可选择 Agent，无须创建 Vault。私钥路径是明确可见的独立选项，读取文件需沿用已有权限边界，不能利用导入流程自动读取任意路径。

**已有 Vault 用户升级**：旧 `provider='vault'` 引用照旧工作。新增系统凭据库后**不自动迁移**；提供每个主机显式“迁移到系统凭据库”，先写目标 provider → 验证可读取 → 原子切换 host ref → 最后尝试清理旧 provider。迁移失败 ref 保持旧值，失败清理留下安全的可回收孤儿键，不丢失旧秘密。

**共享主机**：默认只共享 metadata；勾选携带密码必须显式授权、生成独立加密 payload，严禁把系统 Keychain 密钥引用当作可跨机访问的凭据；没有可读取 secret 就拒绝并提示，不得 toast success。

### 2.2 CredentialRef V2（建议契约，非现有代码）

```ts
// 设计草案。迁移细节必须以当前 parseCredentialRef 和旧数据为准。
type CredentialRefV2 =
  | { provider: 'vault'; kinds: CredentialKind[]; version?: number }
  | { provider: 'system-keychain'; kinds: CredentialKind[]; version: number; keyId: string }

interface AuthContext {
  hostId: string
  authType: 'agent' | 'password' | 'key' | 'cert'
  credentialRef?: CredentialRefV2 | null
  secretPolicy: 'ask-every-time' | 'save-system' | 'save-vault'
}

type CredentialState =
  | 'NO_SECRET'
  | 'NEEDS_INPUT'
  | 'OS_AUTH_REQUIRED'
  | 'VAULT_NOT_CREATED'
  | 'VAULT_LOCKED'
  | 'UNAVAILABLE'
  | 'UNREADABLE_REFERENCE'
  | 'READY'
```

注：`secretPolicy` 是用户偏好，不是可靠授权；真正写入需当次 GUI 明确选择/用户设置。OS 侧推荐 keyId 使用应用标识、主机 ID、版本与类型形成稳定命名；Keychain item 的敏感内容不能进 SQLite。须审查同机多个应用标识、升级、备份恢复、系统钥匙串权限变更。

### 2.3 Provider 统一边界

```ts
interface SecretProvider {
  providerId: 'vault' | 'system-keychain'
  availability(): Promise<Availability>
  read(ref: CredentialRefV2, kind: CredentialKind): Promise<SecretResult>
  writeVersion(resource: CredentialResource, version: number, secrets: SecretSet): Promise<WriteReceipt>
  removeVersion(receipt: WriteReceipt): Promise<CleanupResult>
}
```

**注意**：这个 TS 仅展示业务契约。正式写入、读取、敏感字节保管应收敛到 Rust Gateway；不要新增一个前端可任意读写全部 Keychain 内容的通用 Tauri command。所有写操作由明确的 user action / 授权流程触发，hostId、版本、kind、资源作用域要绑定；不要把裸 keyId 或凭据放入日志、URL、localStorage、Zustand 持久化或插件事件。

### 2.4 状态机与恢复

| 故障 | UI 操作 | 是否自动网络重试 | 数据处理 |
|---|---|---|---|
| 无密钥/密码 | 输入密码 / Agent | 否 | 原记录不变 |
| OS Keychain 请求授权 | 系统授权对话框 | 否 | 取消则不保存/不连接 |
| Vault 未创建 | 内联创建（仅选择 Vault 时） | 否 | 保留当次表单 |
| Vault 锁定 | 内联解锁 | 否 | 解锁后继续原尝试 |
| Secret 读取失败 | 检查存储 / 重新输入 | 否 | 不自动清除已存凭据 |
| 引用损坏 | 编辑认证方式 / 修复绑定 | 否 | 禁止降级成无密码连接 |
| TCP 超时/网络断开 | 现有网络重试策略 | 是 | 不触碰 SecretProvider |
| SSH 密码被拒 | 重新输入 / 修改保存项 | 否 | 不覆盖有效密钥，直到认证成功 |

**必须证明**：连接/Jump/SFTP 三条入口统一使用 Credential Gateway；跳板机和目标机分别解析凭据，不混用；`clearCredential` 对不同 provider 的引用原子退役；OS Keychain 不可用与 Vault 锁定是不同结构化错误，不用英文文案 `includes` 推断。

### 2.5 凭据验收

- 新装系统使用密码主机，**无需创建 Vault**；勾选记住后 OS 凭据库存储成功。
- 拒绝系统安全存储后可“仅此次使用”，不能悄悄持久化。
- 密码错误不进入保存成功；密码错误后修改再连接成功只保存正确版本。
- 锁 Vault 后内联解锁，成功自动恢复原操作；取消不丢主机信息。
- 旧 v0/v1 Vault 引用升级后 100% 可读（fixture 真实解密，不是只做 parse）。
- 完整覆盖失败注入：系统 API 报错、空凭据、进程强杀、主机 metadata 保存失败、目标写成功但引用更新失败、旧版本清理失败。
- Keychain / Vault 中 secret **不流入 AI Prompt、插件输出、调试日志和 telemetry**。

---

## 3. Terminal-first Workspace — 布局、行为与视觉规范

### 3.1 结构（桌面 1360×820 设计基准；数值可微调）

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│ macOS traffic lights  |  Local  |  prod-01 ●  |  +      ⌘K     ─  □  ⋯       │ 40
├──┬─────────────────┬────────────────────────────────────┬─────────────────────┤
│  │ Connections     │ prod-01 · deploy@host        ⤢ 📁 │ SFTP (可关闭)        │
│  │ Search...       ├────────────────────────────────────┤ /home/deploy        │
│  │ ★ Favorites     │ $ git status                       │ files...            │
│  │   prod-01       │ On branch main                     │                     │
│  │   staging       │ $ █                                │                     │
│  │ Recent          │                                    │                     │
│  │ Local zsh       │                                    │                     │
│  │ Groups          │                                    │                     │
│  │   Production    │                                    │                     │
│  │   Personal      │                                    │                     │
│  │                 │                                    │                     │
├──┴─────────────────┴────────────────────────────────────┴─────────────────────┤
│ SSH connected   •   UTF-8 / zsh                         transfer 0   ⚙         │ 22
└────────────────────────────────────────────────────────────────────────────────┘
      46px rail        220px explorer (optional)              300px tool (optional)
```

真实默认状态：**只展示图标轨 + 标签栏 + 终端**，不强制打开 Explorer 和右侧面板。开发者在终端敲命令是主工作；列表和辅助工具按需打开。

### 3.2 各区域功能契约

1. **Title/Tab Bar（高约 40px）**：macOS traffic lights 安全区；会话标签（本地/SSH/分屏 Workspace），会话图标、名称、连接小圆点；新增标签 `+`；全局命令 `⌘K`；多余功能移到 `⋯`。不塞专门的 Teams、Vault、Logs、通知和 SFTP 主导航按钮。
2. **Activity Rail（约 44–48px）**：Terminal/Connections、Files、Snippets、AI（开启时）、Settings；图标工具提示和键盘可达。它是工具切换，不是后台页面导航。
3. **Connection Explorer（展开约 220–260px）**：顶部搜索；收藏、最近使用、分组树、本地 Shell；单击打开/切换标签，双击/回车行为一致；右键菜单含编辑、复制、删除、认证方式、SFTP。可折叠和拖宽；按 workspace 记住宽度与可见性。
4. **Terminal Canvas（主区域）**：使用现有 `TerminalByUrl`、Tab、PTY、SessionManager；分屏保持原生布局树；不增加大卡片、大标题或空白内边距；错误提示贴近对应 pane，不覆盖整个窗口。
5. **Context Dock（默认关闭，约 280–360px）**：SFTP 绑定 `sessionId` / host，而非独立应用页；Snippets、AI 也复用同一 Dock；允许固定/关闭，切换标签时显示其对应上下文或明确空态。
6. **Status Bar（高约 22–24px）**：左侧连接状态、目标与 protocol；右侧字体编码、传输、选中会话状态。不可输出主机秘密、完整原始命令或模型 key。
7. **Settings / Vault 管理**：保留深链接和高级管理页，但从主导航退居“设置”；日常连接不主动跳页面。

### 3.3 命令与快捷键

| 命令（建议） | macOS | Windows/Linux | 作用 |
|---|---|---|---|
| Command Palette | ⌘K | Ctrl+K | 搜索所有命令和插件注册命令 |
| Quick Connect | ⌘P | Ctrl+P | 搜索主机/最近/分组（避免冲突时可改） |
| New Local Terminal | ⌘T | Ctrl+T | 新建本地 tab |
| Toggle Explorer | ⌘B | Ctrl+B | 折叠连接树 |
| Split Pane | ⌘\\ | Ctrl+\\ | 当前工作区分屏 |
| Toggle SFTP | 自定义可修改 | 自定义可修改 | 当前 SSH Session 上打开文件面板 |
| Explain Selection | 通过菜单/可自定义 | 同左 | 仅在选中内容且 AI 已配置时可用 |

必须首先审查当前快捷键冲突（macOS Shell 默认、Tab、Vim/tmux、输入法、全局快捷键）。以上只是**设计目标**，发现冲突要调和，不能覆盖系统层或终端流本应接收的按键。

### 3.4 视觉规范

- 字体：终端使用现有终端字体设置；UI 用系统字体；所有图标尺寸与视觉对齐固定；不为了“现代感”强制玻璃拟态。
- 颜色：保留 shadcn/Tailwind 语义 token 与 Dark/Light/System；控制层级最多两层表面；主 canvas 不采用卡片容器。
- 分隔：1px 边线和一致的淡色强调；SSH 连接状态用小点+文本，非整块绿色背景。
- 密度：Explorer 行约 30–34px，Tab 约 40px；状态栏 22–24px；更多菜单代替多排大按钮。
- 可访问：焦点可见、键盘顺序可控、清晰 ARIA label、中文/英文文案、缩放、reduced motion。
- 狭窄窗口：<900px 默认折叠 Explorer；<720px 工具面板使用覆盖抽屉，不能挤压终端到不可用宽度。宽度阈值视真实 GUI 调整。

### 3.5 交互规则

- 点击 Explorer 主机：若已有对应可重用会话则聚焦，否则创建 tab；默认不替换当前活跃会话。
- 打开 SFTP/AI：不创建新 SSH/PTY，不卸载当前终端；切换 Tab 时取消订阅旧会话并安全换上下文。
- 关闭 Dock：仅移除视图，不关闭后台 SFTP 任务（若任务允许后台执行）；需要明确状态展示。
- 主机编辑：对话框，不重建无关 tab；编辑的是下一次连接配置，正在进行的 SSH 会话不被无提示打断。
- Vault prompt：在当前上下文弹出，恢复原请求，不改变 Router 路由。
- 插件面板：视为可被卸载的 UI contribution，不拥有 PTY lifecycle。

### 3.6 UI 验收硬门禁

`TERM_LAYER_SINGLE_MOUNT`、`NO_EXTRA_PTY_ON_NAV`、`IME_COMPOSITION_PASS`、`VIM_TMUX_KEYS_PASS`、`TABS_SPLIT_RESIZE_PASS`、`WORKSPACE_RESTORE_PASS`、`SFTP_PANEL_SESSION_BINDING_PASS`、`FOCUS_AFTER_DIALOG_PASS`、`NARROW_LAYOUT_REACHABLE_PASS`。未完成真机交互的项目只能写 NOT_RUN。保存 **改前/改后相同窗口尺寸截图** 及 3–5 个关键交互录屏；不能只交单元测试。

---

## 4. Extension Platform — 从 DSH 借鉴能力组合，不直接引入 Cordis

### 4.1 三层结构

```text
Tauri Host / Rust Capability Gateway
   ├─ Stable Terminal Core (PTY / SSH / SFTP / Vault / DB)
   ├─ Extension Registry (manifest, lifecycle, permissions)
   │    ├─ Trusted built-in extensions (TS, compiled with app)
   │    └─ Community extensions (later: isolated process / WASM / protocol)
   └─ Optional AI extension (UI contribution backed by Rust Rig)
```

**原则**：终端在插件系统损坏时也能打开本地 Shell；禁用插件不重启或杀死 PTY；第三方 JS 不能直接继承 Tauri 的 command、SQL 或文件系统权限。Tauri WebView 中的脚本没有安全意义上的独立模块隔离；社区插件不能直接 `import()` 或 `eval()` 运行在主 UI 环境。

### 4.2 SDK 最小接口（设计示例）

```ts
interface Disposable { dispose(): void }
interface TerminalExtensionContext {
  pluginId: string
  subscriptions: Disposable[]
  commands: {
    register(def: { id: string; title: string; run(): Promise<void> }): Disposable
  }
  menus: {
    register(def: { location: 'terminal.context'|'connections.context'; commandId: string }): Disposable
  }
  views: {
    register(def: { id: string; title: string; slot: 'right-dock'; component: TrustedBuiltInComponent }): Disposable
  }
  terminal: {
    selectedText(): Promise<string | null> // context + consent guards
    requestSendText(sessionId: string, text: string): Promise<UserApprovalResult>
    // 不向插件暴露底层 PTY raw handle / SSH credential
  }
  events: {
    on(event: 'session.connected'|'session.disconnected'|'workspace.changed', cb: (e: SafeEvent) => void): Disposable
  }
}
```

`TrustedBuiltInComponent` 只能在**内置受信任插件**中使用。第三方面板使用严格的 declarative UI schema / isolated webview（禁用 Tauri 权限）/ 外部进程输出，不能注入 React component 函数到主渲染器。

### 4.3 Manifest（示例）

```json
{
  "id": "org.example.command-helper",
  "name": "Command Helper",
  "version": "0.1.0",
  "apiVersion": 1,
  "entry": "built-in:command-helper",
  "capabilities": [
    "commands.register",
    "terminal.read-selected-output",
    "ui.right-dock"
  ],
  "platforms": ["macos", "windows", "linux"]
}
```

实现 `activate() → Disposable[] → deactivate()/dispose()`，保证启用、禁用、异常时每项注册都能撤销；事件回调可取消；插件异常不得中断主 UI 渲染。权限按插件 ID、会话 ID 和用户操作绑定；危险能力默认拒绝。

### 4.4 插件生态交付顺序

- **Extension API v0**：Command Palette、Context Menu、Right Dock、状态只读事件；只装内置、受信任插件。验收：启用/停用/重新启用都不残留命令、监听器或菜单项。
- **Extension API v1**：版本化 manifest、插件配置、权限显示、兼容性检查、生命周期事件、插件诊断。
- **Community Runtime（独立里程碑）**：支持第三方 package，并设计隔离执行（独立进程或 WASM）、速率/资源限制、崩溃隔离、无默认文件和网络权限；确认 sandbox 真实隔离前不宣称沙箱。
- **Plugin Manager**：精确版本安装、校验和、签名/来源、安装计划展示、暂存目录、完整性验证、原子启用、自动回滚、卸载、可选 registry。初期避免直接对生产用户配置目录 `npm install`。
- **MCP Bridge**：作为可选插件 adapter，对外只开放有限命令（会话列表、获授权选择输出、需确认的发送文本）；不能绕过 Rust capability gateway。

### 4.5 需要最先实现的内置扩展

`quick-connect`、`terminal-search`、`sftp-context-panel`、`command-explainer`（Rig）；先迁移其中最简单的一个验证 Extension SDK，不急着重写所有现有功能。

---

## 5. Rust Rig — 小功能 MVP，不造完整 Agent Harness

### 5.1 技术决策

Rig 在 2026-10-31 发布了 0.46.0；区分 **Rust 库 `rig`/`rig-core`** 与 **Rig 自带的编码 Agent CLI / `rig-harness`**。本项目要用前者，不需要后者。**现有 `baicie/agent-harness-lab` 已在 Rust `1.97.1` 上完成 0.46.0 的独立评估（59 项离线测试、macOS Tauri POC、CONDITIONAL GO）**，不需要重新验证它能否运行；新问题是**它能否与 Terminal 主工程兼容**。Terminal `rust-version=1.96`，存在明确的工具链差距，先在单独 worktree/target 试合 `rig-core` 精确版本，检查 `cargo check --locked`、MSRV、重复 reqwest、lockfile、binary/CI impact。若需要将 Terminal MSRV 提升至 1.97.1，必须形成独立 ADR 和跨平台 CI 证据；不能默默升级。0.46 API 有破坏性变化，示例必须以编译结果为准。`agent-harness-lab` 的 `harness-rig` 包含远超本次所需的持久化、工具、审批和 MCP，**MVP 不整体移植**。

首次集成方式：`src-tauri` Rust 内部一个隔离 `ai/` 模块或单独 workspace crate `terminal-ai`，复用 Tokio 任务、取消令牌与现有网络设施；不开 AI 时不建立模型连接、不启动常驻 Agent；V1 只做对话式 completion，**不注册 shell/tool 供模型自动调用**。若依赖体积/MSRV/reqwest 版本冲突太大，则保留 `ModelDriver` 接口，让 Rig POC 在独立 crate 先达标，再考虑主程序合入。

### 5.2 模型配置 UX

Settings > AI（仅当功能开启）提供多模型 Profile：

- Profile 名称，例如 `Work / DeepSeek`、`Personal / OpenAI-compatible`；
- Provider 类型：OpenAI Compatible、OpenAI、Anthropic（先支持前两个；其他等验证成功再加）；
- Endpoint / Base URL：官方预设默认，用户可覆盖；自定义 Endpoint 的路径与版本规则在预览里明确显示；
- Model ID：可自由输入，不能强制来自固定模型列表；
- API Key：仅安全存储系统凭据库或当前会话内存，不存 SQLite / localStorage / repo；
- Default / Temperature / Max Output Tokens / Timeout / Streaming 开关；
- Test Connection：返回真实模型、响应时间、协议/HTTP 错误类别；不发送用户终端上下文；
- Provider 状态：Configured / Requires Key / Testing / Reachable / Unauthorized / Rate Limited / Unsupported / Offline。

公共 metadata 可入 SQLite：`id,name,provider,endpoint,modelId,parameters,isDefault,secretRef,createdAt,updatedAt`。`secretRef` 本身不能直接读取秘密。Keychain 删除/替换须原子安全；不能将 AI key 复用 SSH password provider 的 `host:<id>` 命名空间。

**Endpoint 安全**：默认 HTTPS；本地 `localhost/127.0.0.1` HTTP 可显式允许；对其他明文 HTTP 警告并要求确认或拒绝；对远程自定义 endpoint 显示数据发送目标；不自动复制模型 key 给不相干主机。严禁将 SSRF 授权误判为用户输入验证；本地桌面场景虽允许用户设置 endpoint，也需安全地限制插件可配置范围。

### 5.3 AI MVP 功能（严格控制）

| 功能 | 输入 | 输出 | 是否能执行命令 |
|---|---|---|---|
| Explain Selection | 用户主动选中的终端文本（长度限制） | 一次性说明，含可能风险 | 否 |
| Explain Last Error | 用户选中的错误片段或最后一条**确认的**非 0 exit（如果 Shell Integration 可证实） | 原因、建议命令、注意事项 | 否 |
| Draft Command | 用户自然语言目标+明确操作系统/当前工作目录（可选） | **只生成命令草稿**、风险提示、可复制 | 否 |
| Summarize Output | 用户明确选择的终端输出区间 | 脱敏摘要 | 否 |
| Save as Snippet | 用户审阅后的草稿 | 现有 Snippet 数据结构 | 需点击确认，不自动运行 |

不能把「最后输出」等同于真实 exit code，Shell Integration 不可用时隐藏相关证据声明。禁止隐式读取整个 Scrollback、Clipboard、私钥、环境变量、SSH 认证参数、团队 token。用户明确预览并确认发送的范围后，才执行请求。

### 5.4 Rust 边界契约（伪代码）

```rust
// 设计契约，具体 Rig 0.46 API 以独立 POC 编译结果为准。
struct ModelProfilePublic {
    id: String,
    provider: String,
    endpoint: String,
    model_id: String,
    max_output_tokens: u32,
}

enum AiAction { ExplainSelection, ExplainError, DraftCommand, SummarizeOutput }

struct AiRequest {
    request_id: String,
    model_profile_id: String,
    action: AiAction,
    user_approved_text: String,
    // 无 API key / SSH credential / raw PTY handle
}

trait ModelDriver {
    async fn complete(&self, request: AiRequest, cancel: CancellationToken)
        -> Result<AiResponse, AiFailure>;
}
```

正式 IPC：`ai_profiles_list`, `ai_profile_upsert`, `ai_profile_delete`, `ai_test_connection`, `ai_generate`, `ai_cancel`。涉及 secret 的 profile upsert 要经过后端专属安全写入接口，并对输入大小、类型、URL、requestId、timeout、并发数、错误脱敏做校验；不要暴露 `read_secret(id)` 通用 IPC 给 WebView 或插件。

输出格式：`requestId / modelId / content / finishReason / latencyMs / usage（可用时） / warning / error`；流式令牌可通过可取消事件发送，关闭面板或切换 profile 后取消并确保不会泄漏到下一次请求。不要把客户端提供的 token 用作认证依据，权限仍由 Tauri command 与用户确认界面落实。

### 5.5 AI 与插件关系

`terminal-ai` 是一个**官方内置插件**：注册命令 `ai.explainSelection`, `ai.explainError`, `ai.draftCommand`，注册 AI Dock，背后调用 Rust `ModelDriver::complete()`。如果 Extension Runtime 尚未达标，可以先通过内部 adapter 接同一 `AiService`，禁止把 Rig 的实现绑死进 React Layout；未来可以替换其他 driver，也可完全关闭 AI 模块。

### 5.6 AI 安全门禁

- 所有模型结果都是不可信文本；不可将模型建议直接执行、复制进 Shell 输入队列或自动保存 Snippet。
- Shell 命令需要用户在终端主动粘贴/执行；未来若实现执行工具必须新增单独审批协议。
- 显示“将发送到模型”的预览，脱敏可编辑、可取消；默认只发用户选中内容，最大长度需有上限。
- 缺 API Key、HTTP 401/403、429、网络失败、超时、用户取消、流中断都要可恢复，且不会吞掉已有终端焦点或销毁 Session。
- API Key 不在前端 devtools、日志、SQLite、持久化状态、错误对象、崩溃报告；集成测试实际扫描。
- 用本地假模型服务做完整连通/断开/超时/取消/stream tests；“本机 mock PASS”和“真实 Provider PASS”严格分开。
- V1 不自动创建/修改文件，不扫描仓库，不运行命令，不访问远程 SSH 私密数据。

---

## 6. 分阶段实施计划（建议 5 个 Draft PR，不强制所有阶段同时启动）

### UX-0 — 冻结设计与基线审计（只读/文档）

输出：`docs/design/terminal-next/{00-adr,01-credential,02-workspace,03-extension,04-rig,05-test-matrix}.md`；旧路由/组件、旧 CredentialRef/数据库迁移、现有 keychain 表与 SSH key passphrase、权限、GUI 可用性和真实缺口清单；带固定窗口宽度的前后 UI 设计对照；**复用 `agent-harness-lab/docs/{GO-NO-GO,FINAL-EVALUATION,integration-architecture,benchmarks}.md` 的现有 POC 结论，仅补 Terminal 1.96 → Rig 1.97.1 的兼容性与依赖报告**；明确风险和非目标。设计未通过不进入改代码。

### UX-1 — Terminal-first Workspace

最先改变用户感知。改 Layout / Explorer / Toolbar / Dock，保留现有 TerminalByUrl 常驻实例和真实 PTY；SFTP Dock 可先作为 MVP，复杂现有 SFTP 独立页保留为兼容入口；工作区/聚焦/输入法/分屏真机验证。验收：不因 UI 切换导致会话断开或重建。

### UX-2 — 凭据低摩擦与系统 Keychain

新增 provider ID、安全 OS Keychain 访问后端、从连接时输入到认证成功再保存的闭环、Vault 内联解锁、旧数据兼容、跨 provider 转移、失败恢复与安全负向测试。验收：不创建 Vault 即可保存并连接普通 SSH；旧 Vault 用户功能无回归；Jump/SFTP 使用相同解析语义。

### UX-3 — Extension API v0（Built-ins Only）

注册可撤销的命令、菜单、右侧面板、事件，manifest、生命周期与基本权限模型；迁移一个小扩展（例如命令解释入口），测试卸载/禁用不重建 PTY、不泄漏 handler。第三方动态代码加载仍禁止。

### UX-4 — Rust Rig AI MVP

复用 `agent-harness-lab` 中已验证的模型/桥接测试模式，再做 Terminal 依赖集成 `cargo check` 与 HTTPS/mock Provider；通过后按 feature/模块纳入 Rust；Settings AI Model Profiles、Secure API Key、Test Connection、Explain Selection、Explain Error、Draft Command、Summarize Selection、AI Dock；真实模型人工验收。**不引入 Agent Loop、MCP、长期记忆、命令执行**。

### UX-5（以后再说）— Community Plugins/MCP

仅当内置 SDK 被实际使用并证明需要时启动，另开 ADR；确定插件包形式和真实隔离运行时。不要在前四阶段偷偷实现 npm registry 解析/动态代码执行。

各阶段都必须提交独立 Draft PR、真实新证据（如果修改受 fingerprint 保护的路径）、明确 PASS/PARTIAL/NOT_RUN，不自动合并、发布或重新开启 Phase 10.x 名称。

---

## 7. 完整测试矩阵

| 范围 | 必测正路径 | 必测负路径 | 真机要求 |
|---|---|---|---|
| Credential | Keychain save/read/clear; 旧 Vault; 认证成功保存 | OS 拒绝、错误密码、版本中断、孤儿键、引用损坏 | macOS Keychain + Windows/Linux 平台标记 |
| SSH | password/key/agent/cert + Jump | 错误凭据、Vault 锁、网络断开、重连预算 | 实际 SSH sshd（非 CLI 代替 Tauri） |
| Layout | tabs/splits/SFTP dock/Explorer/search | 快捷键冲突、隐藏 pane、会话丢失、窗口窄 | 真实 GUI IME/Vim/tmux/resize |
| Plugin | activate/register/deactivate/reload | throw、重复注册、卸载中异步回调、权限拒绝 | 主会话保活 |
| Rig | Model profile CRUD、测试连接、真实 prompt、取消 | 401/429/timeout/bad JSON、秘钥泄露、超限输出 | mock + 可选真实 provider |
| Security | 不输出 secrets；所有敏感动作显式授权 | 注入、路径穿越、跨 host 引用、跨插件越权 | 结构审查 + 负向测试 |
| Delivery | source-size、ESLint、typecheck、全量前端、Rust、bundle | 非法源指纹/过期证据、Errors 单独一行 | CI + 正确 HEAD 证据 |

**替换 Tabby 的正式门槛保留不变**：`docs/phase10/16-phase10-3-daily-driver-package.md` 的 7 天表真实填写，P0/P1 无阻断、密码/密钥/Agent/Jump/IME/SFTP/Workspace 实际走通。UI 或 AI 代码绿不能代替真机验收。

---

## 8. DSH 开发主提示词（可直接复制）

你现在是 `baicie/terminal` 的实施 Agent。任务是根据 `Terminal Next` 设计包对四个问题进行完整技术设计与受控实现：Vault 低摩擦、终端界面重组、可扩展插件基础、Rust Rig 小型 AI。目标是改善 Tabby 替代体验，不是重新写终端或构建大型 Coding Agent。

**第一阶段：先审查和设计，不要直接改代码。**

1. `git fetch` 后记录 main 最新 HEAD、现有 PR、工作区状态；创建独立 design 分支，遵守 AGENTS.md。不要假设说明中的 SHA 最新。
2. 按当前真实调用链分别审查：`CredentialRef`/SecretProvider/SQL 兼容；`TerminalByUrl`/tabs/panes/lifecycle；导航/路由；Tauri capabilities/plugin-sql；Vault、SSH、Jump 和 SFTP；Rust toolchain 与 Rig 0.46 依赖。
3. 写 6 篇 ADR/设计文档、UI 线框、状态机、Provider/Plugin/ModelDriver typed contracts、迁移与回滚方案、测试矩阵，明确“不改变”的安全不变量。
4. 首先读取 `baicie/agent-harness-lab` 的 README、GO-NO-GO、FINAL-EVALUATION、integration-architecture、benchmarks，**不重新做它已证明的 59 项/多轮/MCP 测试**。仅做 Terminal 专属的 Rig `0.46.0` `cargo check` / `cargo tree`（独立 worktree/target，避免污染生产 Cargo.lock），核查 Rust 1.96 vs 1.97.1 差异、重复 reqwest、bundle/compile impact；如需 MSRV 提升先提交 ADR 与兼容性门禁，不兼容就保留 `ModelDriver` 接口停止依赖合入。
5. 用至少一次独立审查推翻“函数存在即生产可达”的假设：对每个功能必须从真实 UI 点击到 Rust 终点走通，并留事实证据。不得称不具备 GUI 权限的测试为 GUI PASS。
6. **UX-0 只提交设计 Draft PR，报告冲突与待确认决策，不自动合并。**

**得到设计基线后逐阶段实施：** UX-1 先把 Terminal Canvas / Connection Explorer 做正确，UX-2 实现安全 Keychain 与按需认证，UX-3 做内置 Extension SDK，UX-4 用 Rig 只实现模型配置、连接测试、解释选中内容、错误解释和命令草稿。每阶段独立 Draft PR；先红后绿；不引入自动命令执行与第三方动态插件。

**不要违反：**

- 不将任意 JS 插件运行在 Tauri 高权限 WebView；不为快速实现而开启宽泛的 shell/sql/fs 权限。
- 不将 SSH secret/API Key 写入 DB/localStorage/log/telemetry；不自动迁移旧 Vault；不将 Keychain secret 暴露给 AI。
- 不把 xterm/PTY/SSH 创建绑定路由或 Dock 组件挂载；切换设置不得销毁已有连接。
- 不大规模更改 `russh`、Vault 密码学、安全审计与升级流程；此任务不扩展成 SDK 替换或权限系统重写。
- 不自动合并、Tag 或 Release；不编造真机测试或 7 天评分。
- 不长时间循环查询 CI；优先事件驱动或 `WAITING_EXTERNAL_CI`。

**每阶段输出：** 修改文件、功能真实调用链、状态图、测试用例（正/负/真实）、前后视觉证据、源码/证据 SHA、CI URL、残余 P0/P1、各项 PASS/PARTIAL/NOT_RUN、是否建议合入。遇到无法通过的安全/迁移阻断，在当前阶段停止扩展，不以降级门禁规避。

**最终使用目标：** 新用户无需先创建 Vault 就能连接并安全记住 SSH 密码；打开应用立刻是可输入的终端，连接树和 SFTP 只在需要时出现；内置命令与面板可插件化；用户能配置一个 OpenAI-compatible 模型，并以**只读、用户确认发送**的方式解释终端输出和生成命令草稿。不以这些功能完成宣称 Tabby 已可替换，必须继续真机与 7 日验收。

---

## 9. 一句话界定完成

`UX_DESIGN_APPROVED=PASS`、`KEYCHAIN_DEFAULT_PATH=PASS`、`LEGACY_VAULT_COMPAT=PASS`、`TERMINAL_CANVAS_DEFAULT=PASS`、`SINGLE_PTY_LIFECYCLE=PASS`、`BUILTIN_PLUGIN_LIFECYCLE=PASS`、`RIG_MODEL_PROFILE=PASS`、`RIG_READONLY_ACTIONS=PASS`，且无泄密/错误执行。但 `TABBY_REPLACEMENT_READY` 仍只能在实机和 7 天验证通过后转为 YES。
