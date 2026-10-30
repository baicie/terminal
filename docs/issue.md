# Terminal 项目 Issues 追踪

> 基于 2026-03-19 代码审查生成
> 对应文档：`docs/design.md` 和 `docs/todo.md`

---

## 一、关键问题 (Critical)

### Issue #0: 本地终端连接慢 + 屏幕空白 + 无法输入 ✅ 已修复

**严重程度**: 🔴 Critical
**状态**: ✅ 已修复
**影响功能**: 本地终端 (PowerShell / cmd / bash)
**修复时间**: 2026-05-02

**症状**:

1. 本地终端连接慢
2. 状态栏显示 `Connected` 但屏幕完全空白，看不到 prompt
3. 终端区域无法输入任何字符

**根因分析（按定位顺序）**:

| #   | Bug                                                                                                                                                                                                                                                                              | 影响                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | `useTerminal` 先 `invoke('session_create_local')` 才 `listen('local-data')`，存在竞态：shell 启动后立即输出的初始 prompt 在前端注册监听器之前就 emit 完毕，事件丢失                                                                                                              | 屏幕看不到 prompt                                          |
| 2   | `term.onData(...)` 在 `init()` 异步流程末尾才注册，Strict Mode 双重 mount 或依赖项变化导致 effect 中途 cleanup 时永远绑不上                                                                                                                                                      | 用户输入完全没反应                                         |
| 3   | `useTerminal` effect 依赖项过宽（包含多个 `useCallback`，间接依赖 `hosts` 数组），每次 store 更新都触发 effect cleanup → `disconnect()` → 重启会话                                                                                                                               | 连接慢、偶发断连                                           |
| 4   | `TerminalContainer` 的 init effect 依赖 `[tabId, tab]`，`tab` 引用每次 store 更新都变，导致 xterm 实例频繁销毁重建（顺带关闭后端 session）                                                                                                                                       | 体感卡顿、内容丢失                                         |
| 5   | **致命**: `Layout` 同时存在两份终端渲染入口：始终挂载的 `<TerminalByUrl />` 和路由 `Outlet` 内的 `<TerminalRoute />`。在 `/terminal?tab=xxx` 路由下两个 `TerminalContainer` 实例并存，各自创建 PTY session、注册 listener，互相收到对方的 sid 后 mismatch 过滤，谁都写不进 xterm | 屏幕全空                                                   |
| 6   | `fitAddon.fit()` 50ms 后调用，触发的 `onResize` 因 sid 还未 ready 被 `if(!sid) return` 丢弃，后端 PTY 永远停留在 80x24                                                                                                                                                           | 显示尺寸不对                                               |
| 7   | Windows 上 PowerShell 在 PTY 中启动会同步等待版权 banner 渲染完成才进入 REPL，加上 .NET 框架首次加载，prompt 卡很久才出现                                                                                                                                                        | 即使所有上面修完，仍只收到 4 字节 escape sequence 后无下文 |

**修复内容**:

- **`packages/frontend/src/hooks/use-terminal.ts`**: 完全重写
  - `term.onData` / `term.onResize` 立即同步注册（不等任何 await）
  - `listen('*-data')` 在 `invoke('session_create_*')` 之前注册
  - 增加 `pendingData` buffer，缓存 sid 确定前到达的数据，sid ready 后 flush
  - 依赖项收紧为 `[term, tabType, host?.id, serialSessionId]`，`host` 通过 `hostRef` 透传
  - sid 就绪后立即用 `term.cols/rows` 给后端补一次 `session_resize`

- **`packages/frontend/src/features/terminal/components/terminal-container/container.tsx`**:
  - `useTerminal` 入参从 `termRef.current` 改为 `termInstance` state（让 React 正确追踪）
  - init effect 依赖从 `[tabId, tab]` 收紧为 `[tabId]`

- **`packages/frontend/src/router/index.tsx`**:
  - `TerminalRoute` 改为返回 `null`，由始终挂载的 `<TerminalByUrl />` 独占渲染，避免双重实例

- **`src-tauri/src/session/local.rs`**:
  - PowerShell / pwsh 启动时自动追加 `-NoLogo` 参数，抑制版权 banner 让 prompt 立即出现
  - 支持环境变量 `TERMINAL_DEFAULT_SHELL` 覆盖默认 shell（调试/排障用）
  - 修复 PTY 读取循环中 buffer 跨 await 的潜在借用问题

---

### Issue #1: SFTP 后端完全未实现 ✅ 已实现

**严重程度**: 高
**状态**: ✅ 已实现
**影响功能**: SFTP 文件传输
**更新时间**: 2026-03-19

**实现内容**:
`src-tauri/src/terminal.rs` 中所有 SFTP 函数已使用 `russh-sftp` 库实现：

```rust
// 新增 sftp_connect 命令 - 初始化 SFTP 会话
#[tauri::command]
pub async fn sftp_connect(state, session_id) -> Result<(), String>

// sftp_list - 列出目录内容
#[tauri::command]
pub async fn sftp_list(state, session_id, path) -> Result<Vec<SftpFileItem>, String>

// sftp_upload - 上传文件
#[tauri::command]
pub async fn sftp_upload(state, session_id, local_path, remote_path) -> Result<(), String>

// sftp_download - 下载文件
#[tauri::command]
pub async fn sftp_download(state, session_id, remote_path, local_path) -> Result<(), String>

// sftp_mkdir - 创建目录
#[tauri::command]
pub async fn sftp_mkdir(state, session_id, path) -> Result<(), String>

// sftp_delete - 删除文件或目录
#[tauri::command]
pub async fn sftp_delete(state, session_id, path, is_directory) -> Result<(), String>

// sftp_rename - 重命名文件
#[tauri::command]
pub async fn sftp_rename(state, session_id, old_path, new_path) -> Result<(), String>
```

**前端适配**:

- `src/service/ssh.ts` 添加了 `sftpConnect()` 方法
- `src/view/sftp/sftp-container.tsx` 在加载文件前调用 `sftpConnect()` 初始化连接

**使用方式**:

1. 先调用 `ssh_connect` 或 `ssh_connect_key` 建立 SSH 会话
2. 调用 `sftp_connect` 初始化 SFTP 子系统
3. 使用 `sftp_list`, `sftp_upload`, `sftp_download` 等命令操作文件

---

### Issue #2: SSH 密钥认证后端未实现 ✅ 已实现

**严重程度**: 高
**状态**: ✅ 已实现
**影响功能**: SSH 密钥认证
**更新时间**: 2026-03-19

**问题描述**:
`create_and_authenticate` 函数接收了 `private_key` 参数但完全未使用。

**实现方案**:
使用 `russh::keys::decode_openssh` 解析私钥，使用 `PrivateKeyWithHashAlg` 进行认证：

```rust
// 解析私钥
let key = russh::keys::decode_openssh(key_content.as_bytes(), password)?;
// 创建带 hash 的密钥
let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), rsa_hash);
// 认证
handle.authenticate_publickey(username, key_with_hash).await?;
```

**前端适配**:

- `ssh_connect_key` 命令现在正确使用密钥认证
- 支持带密码的加密私钥

---

### Issue #3: 端口转发后端未实现 ✅ 已实现基础框架

**严重程度**: 高
**状态**: ⚠️ 基础实现
**影响功能**: 端口转发
**更新时间**: 2026-03-19

**实现内容**:

- 添加了 `port_forward_start` 命令启动端口转发
- 添加了 `port_forward_stop` 命令停止端口转发
- 添加了 `port_forward_list` 命令列出活动转发
- TCP 监听器框架已实现

**待完善**:

- 完整的 SSH channel 转发逻辑需要进一步集成
- 远程端口转发 (-R) 需要服务端配合
- SOCKS 代理协议解析需要完整实现

---

## 二、重要问题 (Important)

### Issue #4: russh API 编译警告 ✅ 已修复

**严重程度**: 中
**状态**: ✅ 已修复
**影响**: 代码质量和可维护性
**更新时间**: 2026-03-19

**修复内容**:

- 添加了 `#[allow(dead_code)]` 消除导出但未直接调用的函数警告
- 移除了不必要的 `mut` 关键字
- 清理了未使用的 import

---

### Issue #5: SSH Agent **作为登录认证** ✅ 已实现

**严重程度**: 中
**状态**: ✅ 已实现
**影响功能**: SSH Agent 认证
**更新时间**: 2026-05-03

**实现内容**:

- `src-tauri/src/commands.rs`：`session_create_ssh_agent` Tauri 命令
- `src-tauri/src/session/ssh.rs`：`SshSession::new_with_agent` → `create(use_agent=true)` → `authenticate_with_agent`
- `packages/frontend/src/features/terminal/services/session.ts`：新增 `SessionService.createSshAgent` 方法（含连接日志）
- `packages/frontend/src/features/terminal/types/session.ts`：新增 `SshAgentOptions` 接口
- `packages/frontend/src/hooks/use-terminal.ts`：`authType === 'agent'` 时调用 `session_create_ssh_agent`
- `packages/frontend/src/features/terminal/utils/readable-error.ts`：14 种错误分发，中英法三语

**跨平台支持**：

- Unix：连接 `$SSH_AUTH_SOCK`，`russh::keys::agent::client::AgentClient`
- Windows：优先 OpenSSH named pipe，失败后使用 `AgentClient::connect_pageant()` 原生 Pageant transport

**Jump Host 目标认证**：通过 `jump_host.target_auth_type === 'agent'` 传参，后端 `connect_via_jump` 正确路由到 `authenticate_with_agent`

**回归测试**：见 Issue #21 回归测试检查清单

---

### Issue #6: 主机链 (Jump Host) ✅ 已实现

**严重程度**: 中
**状态**: ✅ 已实现
**影响功能**: SSH 跳板机连接
**更新时间**: 2026-08-19（certificate 双端接线与输入校验）

**实现**:

- Tauri 命令 `session_create_ssh_jump`（`src-tauri/src/commands.rs`）
- `SshSession::new_with_jump` / `connect_via_jump`（`src-tauri/src/session/ssh.rs`）：跳板认证 + `channel_open_direct_tcpip` 再打目标会话
- 主终端入口会解析 `jumpHostId`，从 SQLite 恢复 Jump Host 配置并调用 `session_create_ssh_jump`
- password/key/agent/cert 的目标端与跳板端认证均已接线；certificate 分别使用各自的证书、私钥与 passphrase，缺失凭据时在网络连接前拒绝

**设计文档**: `docs/design.md` Section 3.3（产品文案可对齐）

---

## 三、一般问题 (Minor)

### Issue #7: 命令快速补全 ✅ 已实现

**严重程度**: 低
**状态**: ✅ 已实现
**影响功能**: 终端命令补全
**实现时间**: 2026-05-02

**实现内容**:

- `use-terminal.ts` 中新增命令历史导航拦截层
- 在 `onData` 层拦截 `ArrowUp` / `ArrowDown` 键
- 维护本地缓存的命令历史（`historyCacheRef`），首次按 ↑ 时从 SQLite DB 加载
- 使用 VT 序列 `\x1b[H`（回到行首）清行并回填历史命令
- Enter 时自动将命令存入 SQLite（通过 `addCommandHistory`）
- Backspace 时同步追踪当前行 buffer（支持在历史命令中间退格）
- 按任意非方向键重置导航状态

**修改文件**:

- `packages/frontend/src/hooks/use-terminal.ts` — 命令历史导航拦截

**待完善**:

- 重复命令去重（同一 session 内 Enter 连续按两次同一命令）
- 跨 session 累积历史（目前按 hostId 隔离）

---

### Issue #8: Vault 加密存储 ✅ 已实现

**严重程度**: 低
**状态**: ✅ 已实现
**影响功能**: 敏感信息加密
**实现时间**: 2026-03-19

**实现内容**:

- `vault.rs` 完整 AES-GCM + Argon2 加密实现
- `vault_create/vault_unlock/vault_lock/vault_set/vault_get/vault_delete/vault_list` Tauri 命令
- AES-256-GCM 对称加密，Argon2 密钥派生
- 前端 vaults-view 已连接后端服务

---

### Issue #9: 命令面板功能 ✅ 已实现

**严重程度**: 低
**状态**: ✅ 已实现
**影响功能**: 快速操作
**更新时间**: 2026-03-19

**实现内容**:

- ✅ 快捷键 Ctrl+J 打开命令面板
- ✅ 搜索主机并快速连接
- ✅ 快速执行 Snippet（含变量替换）
- ✅ 命令历史搜索和执行
- ✅ 键盘导航（↑↓ / Enter / Esc / Tab）
- ✅ `terminalEmitter.writeCommand` 发送到活动终端
- ✅ 快捷键统一到 `shortcutsService` + CustomEvent 派发

**文件**：`packages/frontend/src/components/command-palette/index.tsx`

---

### Issue #10: 终端 resize（原 ssh_resize 占位）✅ 已修复

**严重程度**: 低
**状态**: ✅ 已修复
**影响**: 终端窗口大小调整
**更新时间**: 2026-08-09（RFC 4254 resize 修复）

**说明**: 旧版 `src-tauri/src/terminal.rs` 中 `ssh_resize` 空实现已废弃；当前统一为 **`session_resize`**（`src-tauri/src/commands.rs`）：

- **本地**：`LocalSession::resize` → `portable_pty` PTY `resize`
- **SSH**：`SshSession::resize` → 调用 channel 的 RFC 4254 `window-change(cols, rows, 0, 0)`（`session/ssh.rs`），不再把终端控制序列写进 shell stdin

前端在 `sid` 就绪后及 xterm `onResize` 中调用 `session_resize` 即可。

---

## 四、TODO 清单状态

### Phase 1 - MVP ✅ 大部分完成

| 功能     | 状态      | 说明          |
| -------- | --------- | ------------- |
| SSH 连接 | ✅ 已实现 | 基础功能完成  |
| 密码认证 | ✅ 已实现 | 正常工作      |
| 终端模拟 | ✅ 已实现 | xterm.js 集成 |
| 多标签页 | ✅ 已实现 | AppStore 管理 |
| 主机保存 | ✅ 已实现 | SQLite 存储   |
| 组管理   | ✅ 已实现 | 支持嵌套组    |
| 收藏夹   | ✅ 已实现 | 侧边栏展示    |

### Phase 2 - 核心功能

| 功能          | 状态        | 问题               |
| ------------- | ----------- | ------------------ |
| SSH 密钥认证  | ✅ 已实现 | 完整实现 (russh-keys) |
| SFTP 文件传输 | ✅ 已实现 | 完整实现 (russh-sftp) |
| 端口转发      | ✅ 已实现 | 完整实现 (port_forward.rs) |
| 命令历史      | ✅ 已实现   | 完整实现           |
| Snippet       | ✅ 已实现   | 完整实现           |
| 分屏模式      | ✅ 已实现   | 完整实现           |

### Phase 3/4 - 高级与企业功能

| 功能         | 状态                   |
| ------------ | ---------------------- |
| Agent 登录认证 | ✅ 已实现；Windows/Pageant 待实机 |
| Agent forwarding | ⚠️ handler/桥接完成，缺显式客户端入口 |
| 主机链       | ⚠️ password/key/agent 主入口完成；certificate 未实现；Windows/Linux 待实机 |
| Vault 加密   | ✅ 已实现 (2026-03-19) |
| 命令面板     | ✅ 已实现 (2026-03-19) |
| 多工作区     | ✅ 已实现 (2026-03-19) |
| 跨设备同步   | ✅ 已实现 (2026-03-19) |
| 串口连接     | ✅ 已实现 (2026-03-20) |
| 团队协作     | ✅ 已实现               |
| SSH 证书直连 | ✅ 已实现               |
| 高级脚本     | ✅ 已实现               |

---

## 五、修复优先级

### P0 - 必须修复 (影响核心功能)

- [x] **Issue #1**: 实现 SFTP 后端功能 ✅
- [x] **Issue #2**: 实现 SSH 密钥认证后端 ✅

### P1 - 应该修复 (影响用户体验)

- [x] **Issue #3**: 实现端口转发后端 ✅
- [x] **Issue #4**: 清理 Rust 编译警告 ✅

### P2 - 建议修复 (增强功能)

- [x] **Issue #5**: 实现 Agent 认证 ✅ (2026-05-03)
- [x] **Issue #6**: 实现主机链功能 ✅
- [x] **Issue #7**: 命令快速补全 ✅ (终端内 ↑↓ 导航已实现，2026-05-02)
- [x] **Issue #8**: Vault 加密存储 ✅

### P3 - 未来考虑

- [x] **Issue #9**: 命令面板完善 ✅
- [x] **Issue #10**: ssh_resize 完善 ✅

### P4 - 已修复

- [x] **Issue #11**: Select 组件可访问性问题 ✅ (2026-03-19)

---

## 六、技术问题修复 (2026-03-19)

### Issue #11: Select 组件与 Dialog 可访问性问题 ✅ 已修复

**严重程度**: 中
**状态**: ✅ 已修复
**更新时间**: 2026-03-19

**问题描述**:

1. `<select>` 内嵌套了 `<button>` - HTML hydration 错误
2. `DialogContent` 缺少 `DialogTitle` - 可访问性问题

**修复方案**:

1. 重写 `src/components/ui/select.tsx` - 使用 Radix UI Select 组件替代原生 HTML select
2. 确保 DialogHeader 包含 DialogTitle 组件

**修改文件**:

- `src/components/ui/select.tsx` - 使用 `@radix-ui/react-select` 完整实现

---

## _文档创建时间: 2026-03-19_

## 十六、Phase 6.6 — TODO清理 + 端口转发持久化 + SSH Agent完善 + 测试覆盖 + 文档对齐 (2026-05-03)

### Issue #34: 前端 3 处 TODO 占位符清理 ✅ 已修复

**严重程度**: Low
**状态**: ✅ 已修复
**修复时间**: 2026-05-03

**修复内容**:

| 文件 | 修复 |
| --- | --- |
| `service/ssh.ts:saveCommandHistory` | 改为调用 `addCommandHistory`（数据库已实现） |
| `workspace-switcher/index.tsx` | 切换工作区时调用 `saveLayout` + `loadLayout` |
| `view/port-forward/index.tsx` | 新增 `port_forward_rules` 表 + CRUD，接入数据库持久化 |

**新增文件**:

- `service/database/port-forward-rules.ts` + `port-forward-rules.test.ts`：独立端口转发规则 CRUD
- `store/workspace.test.ts`：工作区 store 测试

**验证**: `grep -r "TODO" packages/frontend/src/ src-tauri/src/` → 0 结果

---

### Issue #35: 端口转发数据库持久化 ✅ 已实现

**严重程度**: Medium
**状态**: ✅ 已实现
**修复时间**: 2026-05-03

**实现内容**:

1. **`port_forward_rules` 表**：独立表存储转发规则，与主机解耦
2. **CRUD 操作**：`createPortForwardRule` / `getPortForwardRules` / `updatePortForwardRule` / `deletePortForwardRule`
3. **前端集成**：`PortForwardView` 的 `loadForwards` 从 DB 读取，`handleStartForward` 写入 DB，`handleDeleteForward` 从 DB 删除

---

### Issue #36: 工作区布局保存/加载 ✅ 已实现

**严重程度**: Low
**状态**: ✅ 已实现
**修复时间**: 2026-05-03

**修复内容**:
`workspace-switcher/index.tsx` 的 `handleSelectWorkspace`：

1. 切换前调用 `workspaceStore.saveLayout` 持久化当前布局
2. 切换后调用 `workspaceStore.loadLayout` 恢复新工作区布局
3. 通过 `AppStore.getState()` 直接操作 tabs，无需额外状态同步

---

## 十、视图集成修复 (2026-03-24)

### Issue #16: Terminal 容器未连接 SSH 服务 ✅ 已修复

**严重程度**: Critical
**状态**: ✅ 已修复
**影响功能**: 所有 SSH/本地/串口终端会话
**修复时间**: 2026-03-24

**问题描述**:
`terminal-container.tsx` 仅初始化了 xterm.js，但从未连接任何后端服务。用户点击主机后终端显示空白。

**修复方案**:

1. 完整的 SSH 连接流程：`sshService.connect` → `startShell`
2. 完整的本地终端流程：`sshService.startLocalShell`
3. 完整的串口连接流程：`serialService.connect`
4. 数据监听：`sshService.onData` / `serialService.onData` 事件
5. 命令历史导航（↑↓）
6. ResizeObserver + fitAddon 响应容器大小变化
7. 状态栏显示（连接/连接中/断开）

**修改文件**:

- `src/view/terminal/terminal-container.tsx` - 完全重写
- `src/service/terminal-emitter.ts` - 新增（命令面板写入终端）

---

### Issue #17: SFTP 容器为纯占位符 ✅ 已修复

**严重程度**: High
**状态**: ✅ 已修复
**影响功能**: SFTP 文件传输
**修复时间**: 2026-03-24

**问题描述**:
`sftp-container.tsx` 仅包含空状态 UI，无实际 SFTP 功能。

**修复方案**:

1. 完整的双栏文件浏览器（本地 + 远程）
2. 通过 SSH 连接自动初始化 SFTP：`sshService.sftpConnect`
3. 目录列表/导航/面包屑
4. 上传/下载/删除/重命名/新建文件夹
5. 文件图标区分（文件夹/图片/代码/文本）
6. 排序功能（名称/大小/修改时间）

**修改文件**:

- `src/view/sftp/sftp-container.tsx` - 完全重写

---

### Issue #18: Vaults 容器未连接后端 ✅ 已修复

**严重程度**: Medium
**状态**: ✅ 已修复
**影响功能**: 敏感信息加密存储
**修复时间**: 2026-03-24

**修复方案**:

1. 创建/解锁/锁定金库流程
2. 加密存储：`vaultService.set/get/list/delete`
3. 主密码修改功能
4. 主机凭证自动填充
5. 复制到剪贴板

**修改文件**:

- `src/view/vaults/vaults-container.tsx` - 完全重写

---

### Issue #19: 端口转发视图为占位符 ✅ 已修复

**严重程度**: Medium
**状态**: ✅ 已修复
**影响功能**: 端口转发管理
**修复时间**: 2026-03-24

**修复方案**:

1. 连接端口转发后端：`portForwardStart/Stop`
2. 三种转发类型（本地/远程/动态）
3. 卡片式 UI 显示和管理规则
4. 启动/停止/删除操作

**修改文件**:

- `src/view/port-forward/index.tsx` - 完全重写

---

### Issue #20: 命令面板 snippet/history 执行未实现 ✅ 已修复

**严重程度**: Medium
**状态**: ✅ 已修复
**影响功能**: 命令面板快捷执行
**修复时间**: 2026-03-24

**修复方案**:

1. 新增 `terminalEmitter` 服务（EventEmitter）
2. TerminalContainer 监听 `terminalEmitter.write` 事件
3. 命令面板 snippet 执行：解析变量 → 调用 `terminalEmitter.writeCommand`
4. 命令历史执行：调用 `terminalEmitter.writeCommand`

**修改文件**:

- `src/service/terminal-emitter.ts` - 新增
- `src/view/terminal/terminal-container.tsx` - 添加 emitter 监听
- `src/components/command-palette/index.tsx` - 实现执行逻辑

---

## 八、Bug 修复记录 (2026-03-20)

### Issue #13: terminal-container.tsx 使用 require() 导致浏览器报错 ✅ 已修复

**严重程度**: 高
**状态**: ✅ 已修复
**影响功能**: 终端视图无法正常加载
**错误信息**: `ReferenceError: Can't find variable: require`
**修复时间**: 2026-03-20

**问题描述**:
`src/view/terminal/terminal-container.tsx` 第 198 行在 `useEffect` 中使用了 `require()` 动态导入 xterm.js 插件，这在 Vite 构建的浏览器环境中无法工作。

**修复方案**:
将 `require()` 替换为 ES6 的静态 `import` 语句：

```typescript
// 修复前 (错误)
const { Terminal } = require('@baicie/xterm')
const { FitAddon } = require('@xterm/addon-fit')
const { SearchAddon } = require('@xterm/addon-search')
const { WebLinksAddon } = require('@xterm/addon-web-links')

// 修复后 (正确)
import { Terminal } from '@baicie/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
```

**修改文件**:

- `src/view/terminal/terminal-container.tsx`

---

### Issue #14: i18n 命名空间配置错误导致翻译不显示 ✅ 已修复

**严重程度**: 高
**状态**: ✅ 已修复
**影响功能**: 页面显示翻译键名而非翻译文本
**修复时间**: 2026-03-20

**问题描述**:
组件使用 `useTranslation("demo")` 访问 `demo` 命名空间的翻译，但 i18n 配置将资源注册为 `translation` 命名空间，导致翻译无法找到。

**修复方案**:
修改 `src/locales/index.ts` 的 i18n 配置，将资源直接注册到正确的命名空间：

```typescript
// 修复前
resources: {
  en: { translation: en },  // ❌ 错误
  cn: { translation: cn },
  fr: { translation: fr },
},

// 修复后
resources: {
  en: en,  // ✅ 正确 - 包含 demo 和 layout 命名空间
  cn: cn,
  fr: fr,
},
defaultNS: 'demo',
```

**修改文件**:

- `src/locales/index.ts`
- `src/view/hosts/index.tsx` - 添加 `hosts.count` 翻译键

---

## 九、终端组件重构 (2026-03-22)

### Issue #15: 移除 react-xtermjs，使用原生 xterm.js 重构终端组件 ✅ 已修复

**严重程度**: 高
**状态**: ✅ 已修复
**影响功能**: 终端输入回显错乱、快速输入失败
**修复时间**: 2026-03-22

**问题描述**:
原实现使用 `react-xtermjs` 库存在以下问题：

1. 快速输入字符时数据丢失或失败
2. 终端回显文案错乱
3. `useXTerm` hook 提供的抽象层反而增加了复杂性
4. 状态管理混乱，多个 useEffect 依赖导致潜在的竞态条件

**修复方案**:
完全移除 `react-xtermjs` 依赖，直接使用原生 `@baicie/xterm`：

1. **移除 react-xtermjs 依赖**

   ```bash
   pnpm remove react-xtermjs
   ```

2. **重构 terminal-container.tsx**
   - 直接创建和管理 `Terminal` 实例
   - 使用 `useRef` 存储终端 DOM 元素
   - 使用 `useState` 控制初始化状态 (isReady)
   - 使用 `useCallback` 缓存连接函数
   - 统一的事件监听器管理模式

3. **核心改进**:
   - `isReady` 状态确保只在终端完全初始化后才设置事件监听
   - `connectionTypeRef` 统一管理连接类型 (ssh/local/serial)
   - `sessionIdRef` 管理当前会话 ID
   - 所有事件监听器使用统一的 cleanup 机制
   - 移除了之前混乱的 `listenersSetupRef` 模式

4. **输入处理优化**:
   - Enter 键：获取当前行内容，发送到后端
   - Backspace：直接发送到后端
   - Ctrl+C：直接发送到后端
   - Arrow Up/Down：命令历史导航
   - 普通字符：直接发送到后端（SSH/Local 由服务端处理回显，Serial 也由服务端处理回显）

**修改文件**:

- `src/view/terminal/terminal-container.tsx` - 完全重写
- `src/view/terminal/terminal-view.tsx` - 已删除（不再需要）
- `package.json` - 移除 `react-xtermjs` 依赖

**删除文件**:

- `src/view/terminal/terminal-view.tsx`

**新增文件**:

- `src/view/app-logs/index.tsx` - 日志视图占位符

---

## 十一、功能增强 (2026-03-26)

### 端口转发后端完善 ✅

**严重程度**: Critical
**状态**: ✅ 已完善
**影响功能**: 端口转发 (Local/Remote/Dynamic)
**更新时间**: 2026-03-26

**实现内容**:

1. **本地端口转发 (-L)**:
   - 完整的 SSH channel 转发逻辑
   - TCP 监听器绑定
   - 双向数据流转发

2. **远程端口转发 (-R)**:
   - 使用 `tcpip_forward` 请求服务端绑定端口
   - 连接本地端口并通过 SSH 转发

3. **动态端口转发 (SOCKS5)**:
   - 完整的 SOCKS5 协议实现
   - 支持 IPv4、域名、IPv6 地址
   - NO_AUTH 认证方式

4. **新增文件**:
   - `src-tauri/src/port_forward.rs` - 完整的端口转发实现
   - SSH Handle 使用 `Arc<>` 包装以支持多任务共享

---

### Agent 认证后端 ✅

**严重程度**: High
**状态**: ✅ 已实现
**影响功能**: SSH Agent 认证
**更新时间**: 2026-03-26

**实现内容**:

1. **新增 SSH Agent 协议模块**:
   - `src-tauri/src/agent.rs` - 完整的 SSH Agent 协议实现
   - 支持 `request_identities` 获取可用密钥
   - 支持 `sign_request` 使用 agent 签名数据

2. **改进 `ssh_connect_agent`**:
   - 连接到 SSH agent socket
   - 获取并显示可用密钥列表
   - 尝试使用 agent 中的密钥进行认证

---

### SSH 证书认证支持 ✅

**严重程度**: Medium
**状态**: ✅ 已实现
**影响功能**: SSH 证书认证
**更新时间**: 2026-03-26

**实现内容**:

1. **新增命令 `ssh_connect_cert`**:
   - 接受私钥和证书参数
   - 解析 OpenSSH 格式证书
   - 记录证书信息 (serial number)

2. **待完善**:
   - 完整的 SSH Agent 签名流程需要实现 `Signer` trait
   - 当前版本记录证书信息，可作为未来完整实现的占位符

---

### 数据存储服务后端 ✅（命令已接线）

**严重程度**: Medium
**状态**: ✅ 已实现（trait + 多后端 + Tauri 命令走真实 `StorageManager`）
**影响功能**: 跨设备同步
**更新时间**: 2026-03-26（模块）；2026-05-02（`lib.rs` 注入 `Arc<StorageManager>`，`storage_*` 使用默认名 `default`）

**实现内容**:

1. **存储服务模块** `src-tauri/src/storage.rs`:
   - 统一的 `StorageService` trait
   - WebDAV / S3 / REST API 实现
   - `StorageManager` 管理后端实例

2. **Tauri 命令**（与 `packages/frontend/src/service/storage.ts` 对齐）:
   - `storage_init` — 按 `webdav` / `s3` / `custom` 注册 `default` 后端（S3 需 `bucket`）
   - `storage_health_check` / `storage_upload` / `storage_download` / `storage_list` / `storage_delete` — 委托当前 `default` 后端

3. **依赖**: `reqwest`、`async-trait`、`chrono`

---

### Rust 编译警告清理 ✅

**严重程度**: Low
**状态**: ✅ 已清理
**更新时间**: 2026-03-26

**清理内容**:

- 移除所有 unused import
- 添加必要的 `#[allow(dead_code)]` 属性
- 修复变量所有权问题
- 清理 unused variable 警告

---

## 十二、跨平台兼容性追踪

> ⚠️ 本项目需要同时支持 macOS、Windows 和 Linux。以下是已知的跨平台问题和待处理项。

### Issue #21: SSH Agent Windows 支持 ⚠️ 代码已实现，待实机验证

**严重程度**: Medium
**状态**: ⚠️ OpenSSH Agent 已接入（Unix + Windows）；Pageant 使用 `russh` 原生传输，待实机矩阵验证
**影响功能**: SSH Agent 认证
**平台**: Windows

**当前实现（2026-08-09）**:

1. **前端链路已打通**：
   - `packages/frontend/src/hooks/use-terminal.ts` 在 `host.authType === 'agent'` 时调用 `session_create_ssh_agent`
2. **后端命令已实现**：
   - `src-tauri/src/commands.rs` 新增 `session_create_ssh_agent`
   - `src-tauri/src/session/ssh.rs::SshSession::new_with_agent`
3. **跨平台认证分支**（`session/ssh.rs::authenticate`）：
   - `#[cfg(unix)]`：`AgentClient::connect_env()` + `request_identities()` + `authenticate_publickey_with(...)`
   - `#[cfg(windows)]`：优先通过 named pipe `\\.\pipe\openssh-ssh-agent`（可被 `SSH_AUTH_SOCK` 覆盖）连接 OpenSSH Agent，失败后调用 `AgentClient::connect_pageant()` 使用 `russh` 原生 Pageant 传输

**仍待完善**:

- [ ] Windows 上多 key / 证书 key 的实机回归（OpenSSH 与 Pageant 各版本）
- [x] Agent forwarding 已于 2026-08-19 增加显式 `channel.agent_forward(...)`、独立 Host 设置、handler 授权与连接池隔离（Issue #46）

**已完善（2026-05-03）**:

- Agent 认证失败时 UI 细化：前端 `readable-error.ts` 按错误类型分发 14 种人类可读文案，中英法三语
- 后端错误语义细化：`NotFound` 时区分 OpenSSH 未安装 / Pageant 未运行 / 自定义路径无效；新增 `AccessDenied` / `AddrNotAvailable` 两种错误码

**回归测试检查清单（实机验证）**:

| # | 场景 | 平台 | 预期结果 |
|---|------|------|---------|
| 1 | OpenSSH Agent 有 1 个 key，认证成功 | Windows | 连接建立，终端正常 |
| 2 | OpenSSH Agent 有多个 key，认证成功 | Windows | 遍历 keys，选用第一个被接受的 |
| 3 | OpenSSH Agent 无 key | Windows | 报错 "SSH agent has no available identities" |
| 4 | OpenSSH Agent 服务未启动 | Windows | 报错 "Windows OpenSSH Authentication Agent service is not running" |
| 5 | Pageant 运行中有 key，认证成功 | Windows | 成功（日志有 `using Pageant transport`） |
| 6 | Pageant 未运行 | Windows | 报错 "Pageant does not appear to be running" |
| 7 | `SSH_AUTH_SOCK` 指向无效路径 | Windows | 报错 "SSH_AUTH_SOCK points to '...' but the named pipe was not found" |
| 8 | `SSH_AUTH_SOCK` 指向无权限管道 | Windows | 报错 "Permission denied when opening SSH agent pipe" |
| 9 | Unix: `ssh-agent` 有 key，认证成功 | macOS / Linux | 连接建立，终端正常 |
| 10 | Unix: `$SSH_AUTH_SOCK` 不存在 | macOS / Linux | 报错 "Failed to connect SSH agent" + "SSH_AUTH_SOCK socket not found" |
| 11 | Unix: `ssh-agent` 无 key | macOS / Linux | 报错 "SSH agent has no available identities" |
| 12 | 证书 key 认证 | Windows / macOS / Linux | 待验证 russh 是否支持 SSH 证书 |

**Issue #21 更新日志（2026-05-03）**:

- `src-tauri/src/session/ssh.rs`：`NotFound` 细分 OpenSSH 未安装 / Pageant 未运行 / 自定义路径；新增 `AccessDenied` / `AddrNotAvailable`
- `packages/frontend/src/features/terminal/utils/readable-error.ts`：14 种错误分发，覆盖全部 Agent 错误码
- `packages/frontend/src/locales/{en,cn,fr}/app.ts`：三语补全新增 11 个 key

**Issue #21 更新日志（2026-08-09）**:

- `src-tauri/src/session/ssh.rs`：Pageant 回退改用 `russh::keys::agent::client::AgentClient::connect_pageant()`，不再假设 Pageant 暴露 `\\.\pipe\pageant`
- `src-tauri/src/state.rs`：Agent forwarding 专用 channel 使用 `copy_bidirectional` 桥接本地 Agent；删除把普通 SSH channel 数据误写入 Agent socket 的路径
- 静态核对 `russh 0.60.2` API 完成；本机已安装 Windows Rust targets，但 macOS 缺少 Windows SDK headers，交叉检查无法替代 Windows runner，仍需 Windows OpenSSH Agent / Pageant 实机证明

---

### Issue #22: 串口设备 Windows 支持 ⚠️ 代码完成，硬件待实机

**严重程度**: Low
**状态**: ⚠️ `serialport` 跨平台代码已实现；真实设备枚举、流控、写入和拔线仍待实机
**影响功能**: 串口连接
**平台**: Windows / macOS / Linux

**当前实现（2026-05-03）**:

使用 `serialport` crate，已支持跨平台。`serial_list` 命令按平台枚举设备并返回 `SerialPortInfo`：

| 平台 | 设备路径示例 | 端口类型 |
|------|------------|---------|
| Windows | `COM3`, `\\\\.\\COM10` | USB（显示厂商+产品）/ Bluetooth / Serial Port / Unknown |
| macOS | `/dev/cu.usbserial-XXX` | 同上 |
| Linux | `/dev/ttyUSB0`, `/dev/ttyS0` | 同上 |

**已完善（2026-05-03）**：

- `src-tauri/src/serial.rs::serial_list`：`port_type` 从原始 `{:?}` Debug 输出改为用户友好文案：
  - USB 设备显示厂商名、产品名、VID:PID（如 `USB (Silicon Labs CP210x USB to UART, 10C4:EA60)`）
  - Bluetooth 设备显示 `Bluetooth`
  - 未知设备：Windows 上为 `Serial Port`，其他为 `Unknown`

**回归测试检查清单（实机验证）**:

| # | 场景 | 平台 | 预期结果 |
|---|------|------|---------|
| 1 | USB 转串口设备枚举 | Windows | 列出 COM 端口，类型显示厂商名和产品名 |
| 2 | USB 转串口设备枚举 | macOS | 列出 `/dev/cu.*`，类型显示厂商+产品 |
| 3 | USB 转串口设备枚举 | Linux | 列出 `/dev/ttyUSB*`，类型显示厂商+产品 |
| 4 | 内置串口（COM1）枚举 | Windows | 显示 `Serial Port` 类型 |
| 5 | 拔出 USB 串口设备 | Windows | 重新枚举后设备消失 |
| 6 | 插入新 USB 串口设备 | Windows | 重新枚举后出现新 COM 端口 |
| 7 | 波特率 115200 连接 | Windows | 成功建立连接，终端正常 |
| 8 | 波特率 9600 连接 | macOS | 成功建立连接，终端正常 |
| 9 | DTR/DSR 硬件流控 | Windows | ⚠️ 待手动验证 |
| 10 | XON/XOFF 软件流控 | Linux | ⚠️ 待手动验证 |
| 11 | 断开连接（拔线） | Windows | 窗口显示 disconnected 事件 |
| 12 | 蓝牙串口（RFCOMM）| Windows | 设备枚举，类型显示 `Bluetooth` |

**Issue #22 更新日志（2026-05-03）**：

- `src-tauri/src/serial.rs`：`serial_list` 改为用户友好的端口类型文案（USB 厂商/产品/Bluetooth/Serial Port）

**Issue #22 更新日志（2026-08-09）**：

- 打开、枚举、读取和写入移至 blocking pool，避免阻塞 Tokio worker
- 写入统一使用 `write_all` 并保持调用方字节序列，不再自动追加 `\r`
- 主动断开通过原子停止标志终止 reader；拔线、EOF 或读取错误后删除共享 session 并发送 `serial-close`
- 单测覆盖短写场景；串口硬件写入和拔插仍需实机验证

**Issue #22 更新日志（2026-10-16）**：

- 修复未知端口类型的跨平台分类：只有 Windows 才把 `COM*` / `\\\\.\\COM*` 识别为 `Serial Port`，macOS/Linux 上同名路径保持 `Unknown`；新增纯逻辑回归测试。该修复不替代串口硬件枚举、流控、写入和拔线实机矩阵。

---

### Issue #23: 本地终端 Windows PTY ⚠️ 代码完成，Windows/Linux 待实机

**严重程度**: Medium
**状态**: ⚠️ 使用 `portable-pty` crate，跨平台代码已实现；Windows/Linux 待实机验证
**影响功能**: 本地终端
**平台**: Windows

**当前实现** (`src-tauri/src/session/local.rs`):

- macOS、Windows 和 Linux 均从用户主目录启动交互式 shell
- PowerShell 使用 `-NoLogo`；交互式 `cmd.exe` 不传 `/C`，避免执行后立即退出
- PTY EOF、关闭或读取错误后会把会话标记为不存活，后续写入和 resize 返回关闭错误
- Unix 回显配置使用条件编译，Windows 继续走 `portable-pty` 的 ConPTY 实现

---

### Issue #24: 快捷键 macOS/Windows 差异 ✅ 冲突已修复

**严重程度**: Low
**状态**: ✅ 平台主修饰键与系统快捷键冲突已处理；非美式键盘布局待实机抽查
**影响功能**: 快捷键
**平台**: macOS / Windows

**当前已知差异**:

| 功能     | macOS | Windows |
| -------- | ----- | ------- |
| 新标签   | ⌘T    | Ctrl+T  |
| 关闭标签 | ⌘W    | Ctrl+W  |
| 偏好设置 | ⌘,    | Ctrl+,  |
| 复制     | ⌘C    | Ctrl+C  |

**当前已处理**:

- `packages/frontend/src/components/top-toolbar/index.tsx` 已处理 macOS traffic lights 偏移
- 顶栏安全区现在在首次渲染同步计算，只在 macOS Tauri 窗口应用 80px 左留白，浏览器预览不预留原生控件空间；native traffic lights 配置为 `x: 16, y: 16`，与 44px toolbar 基线对齐。
- 顶栏 header 使用 `data-tauri-drag-region="deep"`，内部空白区域可拖动；菜单、工作区、标签和工具按钮保持 `data-tauri-drag-region="false"`，不会误触发窗口拖动。
- macOS 检测复用 `@tauri-apps/api/core` 的 `isTauri()`，移动版窄屏顶栏同样预留安全区；浏览器预览不会误加空白。
- 2026-10-24 增加首帧安全区、窄屏安全区、普通浏览器预览和拖拽子树命中区回归；TopToolbar 相关测试 6/6、typecheck、ESLint、Prettier 通过。锁屏下未做目视确认，解锁后仍需检查原生按钮垂直位置与拖拽区域。
- 移除系统级 `CommandOrControl+H/M/W/,` 注册，避免覆盖操作系统和其他应用快捷键
- 垂直分屏从 `Ctrl+Shift+V` 调整为 `Ctrl+Shift+\`，释放 Windows/Linux 终端粘贴
- 将浏览器对 `Shift+\` 上报的 `|` 规范化为 `\`，真实键盘事件已由单测覆盖
- 结构化 Tauri IPC 错误通过 `formatIpcError` 提取 message/kind，不再显示 `[object Object]`

**待处理**:

- [ ] Windows/Linux 与非美式键盘布局实机抽查
- [ ] 后续如新增原生菜单快捷键，统一复用平台检测与 `shortcutsService`

---

### 跨平台开发规范

详见 `AGENTS.md` 中的「跨平台兼容性规范」章节。

---

## 十三、Prisma 7.x 升级修复 (2026-03-26)

### Issue #25: team-server Prisma 7.x 构建失败 ✅ 已修复

**严重程度**: High
**状态**: ✅ 已修复
**影响功能**: packages/team-server NestJS 服务端无法构建
**修复时间**: 2026-03-26

**问题描述**:

Prisma 7.x 版本不再支持在 `schema.prisma` 中使用 `url` 属性。需要使用新的配置方式。

**错误信息**:

```
error: The datasource property `url` is no longer supported in schema files.
Move connection URLs for Migrate to `prisma.config.ts`...
```

**修复方案**:

1. 创建 `prisma.config.ts` 配置文件：

```typescript
import path from 'node:path'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  migrate: {
    async development() {
      const { PrismaPostgres } = await import('@prisma/adapter-pg')
      const { Pool } = await import('pg')
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
      })
      const adapter = new PrismaPostgres(pool)
      return { adapter }
    },
  },
})
```

2. 更新 `schema.prisma`，移除 `url` 配置：

```prisma
datasource db {
  provider = "postgresql"
}
```

3. 更新 `prisma.service.ts`，使用新的适配器：

```typescript
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

constructor() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  })
  const adapter = new PrismaPg(pool)
  super({ adapter })
  this.pool = pool
}
```

4. 安装必要的依赖：`@prisma/adapter-pg` 和 `pg`

5. 添加 `rootDir` 到 `tsconfig.json` 解决编译错误

6. 运行 `prisma generate` 重新生成 Prisma Client

**修改文件**:

- `packages/team-server/prisma.config.ts` - 新增
- `packages/team-server/prisma/schema.prisma` - 移除 url 配置
- `packages/team-server/src/prisma.service.ts` - 使用新适配器
- `packages/team-server/tsconfig.json` - 添加 rootDir
- `packages/team-server/package.json` - 添加依赖

---

---

## 十四、Apple WebKit (Safari) 键盘事件问题 (2026-03-29)

### Issue #26: macOS WKWebView 重叠按键输入回归 🟡 bounded FIFO 已修复，物理回归待完成

**严重程度**: High
**状态**: 🟡 `@baicie/xterm@0.1.7` 使用 bounded FIFO 去重延迟 WebKit input；真实 WKWebView 物理重叠按键、dead key 与 IME 仍需验收
**影响功能**: 终端输入（local / SSH / serial 共用 `useTerminal`）
**浏览器**: Safari、macOS Tauri 内置 WKWebView（纯 WebKit，不含 Chrome/Chromium 内核）
**修复时间**: 2026-05-02（历史 fallback）；2026-08-20（修复版 core 恢复并锁定）；2026-10-17（延迟 input 重叠回归）

**问题描述**:

在 Safari 中同时按下两个键（如 `c+d`）时，xterm.js 的 `onData` 事件只触发一次，导致只收到第一个字符。

**事件时序对比**:

| 浏览器              | 时序                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------- |
| **Chrome (Blink)**  | `keydown(c)` → `keydown(d)` → `onData(c)` → `onData(d)` ✅                             |
| **Safari (WebKit)** | `keydown(c)` → `onData(c)` → `input(c)` → **`keydown(d)` (无 onData)** → `input(d)` ❌ |

**根本原因**:

这是上游 xterm 6 键盘事件策略与 Apple WebKit 原生 textarea 事件时序的交互缺陷。官方 `@xterm/xterm@6.0.0` 在 `_keyDown` 后阻止默认事件，且 `_inputEvent` 受 `_keyDownSeen` / `_keyPressHandled` 限制；近同时按键时，后续字符可能没有进入 xterm `onData`。应用层只透明监听 `onData` 无法补回 core 从未发出的字符。

1. Safari 在同一个宏任务中处理多个 `keydown` 事件
2. xterm.js 取消第一个 `keydown` 后，Safari 不会为第二个键触发 `keypress`
3. 即使触发 `input` 事件，WebKit 的实现也可能不完整

**相关 Issues**:

- [xtermjs/xterm.js #5374](https://github.com/xtermjs/xterm.js/issues/5374) - Cannot type shifted characters or overlapping keys in Safari
- [xtermjs/xterm.js #5721](https://github.com/xtermjs/xterm.js/issues/5721) - ctrl-c sends keyCode 13 on iOS Safari

**解决方案（历史生产实现；当前路径见下方说明）**:

早期版本在 `packages/frontend/src/hooks/use-terminal.ts` 中实现 `setupWebKitInputCompensation(term, send)`，由 `useTerminal` 在挂载终端后注册：

1. **仅纯 WebKit**：`/AppleWebKit/i` 且排除 `Chrome|Chromium|Edg`，避免误伤 Blink
2. **滚动尾部 buffer**：通过 `term.onData` 记录最近发送的尾部字符串（默认 32 字符），与实验页 `Set` 方案相比更利于与 IME / 多字节输入共存
3. **textarea `input` 回退**：`requestAnimationFrame` 后若 `recentSent` 未以本次 `inputData` 结尾，则调用 **`send(inputData)`**（与正常 `onData` 同路径 → `session_write` / 本地 PTY），**不**使用 `term.write()`，避免把用户输入写回屏幕而非后端
4. **卸载时清理**：移除 `input` 监听并 dispose `onData` 订阅

早期在 `packages/frontend/src/experiments/xterm-test.tsx` 中的验证逻辑已升级为上述生产实现。

**历史 fallback 验证建议**:

- Safari / WKWebView：快速交替两键、Shift+字母
- Ctrl+C、方向键、IME 输入（中文）不误补发

**修改文件**:

- `packages/frontend/src/hooks/use-terminal.ts` — `setupWebKitInputCompensation` + `useTerminal` 内注册与 cleanup
- （可选参考）`packages/frontend/src/experiments/xterm-test.tsx` — 历史验证页面

_本节最后更新: 2026-08-20_

**Phase 6.17 当前实现**：上述应用层 DOM `input` fallback 已移除，避免与 core 内部 input handler 争用或双发。运行时和 CSS 统一使用精确固定的 `@baicie/xterm@0.1.7`：该兼容分支在 xterm 内部 `_keyDown`、`_keyUp`、`_inputEvent` 路径检测 `AppleWebKit`，允许 WKWebView 继续产生原生 `input`，并将 `insertText` 送入 `triggerDataEvent`。文本 `onData` 与原始 `onBinary` 随后透明进入同一会话 FIFO。

**2026-10-17 重叠 input 回归修复**：发现单值 keydown marker 在 `keydown(a) → keydown(s) → input(a) → input(s)` 时被覆盖，导致输入再次发送 `a,s`。marker 现改为最多保留 32 项、基于 `performance.now()` 的 1 秒 FIFO，按 payload 逐项消费；IME composition 开始、paste handler 与非 `insertText` input 会清理旧 marker，避免组合输入、粘贴或长时间未配对 keydown 后的文本被残留 marker 误吞。新回归覆盖不同/相同字符重叠、FIFO 上限与过期、`insertFromComposition`、真实 paste handler 和 `insertFromPaste`。自动化与干净包重放通过，但不能替代真实 WKWebView 的物理键盘验收。

**溯源与契约**：`0.1.7` 运行时/CSS/typings 与带源码的 `0.1.6` 发布物逐字节一致；可审计的上游基线是 xterm.js commit `34e017935581b6e0081b0e2bebe53e3193b85be7`（6.0.0 发布后的开发主线），不是 npm 官方 6.0.0 源码。`package.json` 精确固定 `0.1.7`，lockfile 记录不可变 SHA-512 integrity；`xterm-package-contract.test.ts` 禁止直接依赖官方 core，并验证 Vite 将修复版 core 与官方 addons 分开打包；错误声明上游模块名的 fork typings 通过 `src/types/xterm.d.ts` 桥接。

**自动验证边界**：依赖契约、输入 FIFO 不改写/不重复、前端 79 个测试文件/675 项、typecheck 与 production build 可自动验证，但 jsdom、合成 `KeyboardEvent`、`term.input()` 或普通自动键入都不能复现 WKWebView 的真实原生事件时序。发布前必须在 macOS Tauri WKWebView 中多轮近同时按下物理 `a/s/d`，精确确认 PTY 收到 `asd` 且不丢不重，并覆盖快速连续输入、key rollover、CapsLock、Option/dead key、中文 IME 与 Ctrl+C。

**剩余维护风险**：当前 lockfile 绑定的 patched `0.1.7` 安装产物已移除 WebKit 输入路径中的敏感 `console.debug`，patch hash 为 `63e246a9944c8f4c202660ee4be6c3d6d60e2e38e112d8deb5f134691ff2abdb`；npm `repository` 仍是占位地址且发布物没有源码/source map。后续应从可追溯仓库基于上述上游 commit 发布正式去日志版本，并保留真实 WebKit 回归；在此之前不得用官方 core 替换。

---

## 十五、桌面化体验 + SFTP 队列 + Rust 可观测性 (2026-05-02)

> Phase 6.2，对应 t1–t4 四个子任务。详见 `docs/project.md` → "Phase 6.2"。

### Issue #27 (t1): Tauri 桌面 UX —— 托盘 / 焦点感知 / 原生通知 ✅ 已实现

**严重程度**: Medium
**状态**: ✅ 已实现
**影响功能**: 桌面集成体验
**实现时间**: 2026-05-02

**目标**:

让应用在三大桌面平台上"像桌面 app"——窗口失焦时能给出系统级通知，能最小化到托盘，托盘菜单可以快速 new local / new SSH / 打开命令面板。

**实现要点**:

1. **托盘 (`src-tauri/src/tray.rs`, 新增)**：
   - `TrayIconBuilder` 注入主窗口图标 + Show Window / New Local Terminal / New SSH Connection / Command Palette / Quit 菜单项
   - `on_menu_event` 把动作 emit 为 `tray://new-local` / `tray://new-ssh` / `tray://command-palette` 自定义事件，前端 `useTrayEvents()` 把它们再 dispatch 成现有的 `shortcut:*` CustomEvent，复用既有快捷键链路
   - 托盘左键点击 → 切换主窗口可见 / 聚焦
2. **窗口最小化到托盘 (`src-tauri/src/window_cmd.rs`, 新增)**：
   - `set_close_to_tray` / `get_close_to_tray` Tauri 命令，背后是 `AtomicBool`
   - `lib.rs::on_window_event` 拦截 `WindowEvent::CloseRequested`，若 `close_to_tray_enabled()` 则 `api.prevent_close()` + `window.hide()`
3. **原生通知 (`packages/frontend/src/service/notifications.ts`, 新增)**：
   - 统一 `notify({title, body, type})`：优先 Tauri `tauri-plugin-notification`，回退浏览器 Notification API，再回退 in-app toast
   - 用户偏好 `nativeNotifications` / `notifyOnlyWhenUnfocused` 由 `applyNotificationPrefs()` 缓存
   - `ensureNativePermission()` 仅在首次需要时请求权限
4. **窗口焦点感知 (`packages/frontend/src/hooks/use-window-focus.ts`, 新增)**：
   - Tauri 环境监听 `tauri://focus` / `tauri://blur` webview event；浏览器环境降级到 `window.addEventListener('focus'/'blur')`
   - 终端 `session-status-bar` 在失焦时半透明 + tooltip 提示
   - 终端断连/出错时只在窗口失焦时弹原生通知，否则仅 toast，避免干扰
5. **设置面板**：`general-settings.tsx` 新增 _Desktop UX_ section，三个开关 + 文案 + i18n 三语
6. **能力清单 (`src-tauri/capabilities/default.json`)**：补齐 `core:window:allow-{show,hide,set-focus,unminimize,is-focused,is-visible}` + `core:event:allow-{listen,unlisten}` + `notification:default`

**新增 / 修改文件**:

- 新增：`src-tauri/src/tray.rs`、`src-tauri/src/window_cmd.rs`、`packages/frontend/src/service/notifications.ts`、`packages/frontend/src/service/window-ux.ts`、`packages/frontend/src/hooks/use-window-focus.ts`、`packages/frontend/src/hooks/use-tray-events.ts`
- 修改：`src-tauri/Cargo.toml`、`src-tauri/src/lib.rs`、`src-tauri/capabilities/default.json`、`packages/frontend/src/App.tsx`、`packages/frontend/src/layout/index.tsx`、`packages/frontend/src/components/settings-dialog/{index,general-settings}.tsx`、`packages/frontend/src/features/terminal/components/terminal-container/{container,session-status-bar}.tsx`、`packages/frontend/src/locales/{cn,en,fr}/app.ts`

---

### Issue #28 (t2): SFTP 体验 —— 拖拽 + 队列 + 分块进度 ✅ 已实现

**严重程度**: Medium
**状态**: ✅ 已实现
**影响功能**: SFTP 文件传输
**实现时间**: 2026-05-02

**痛点**:

旧版 SFTP `sftp_upload` / `sftp_download` 是一次 `fs::read` + 一次 `file.write_all`，对大文件无任何反馈；选文件只能走 dialog；同时 `sftp_sessions: Mutex<HashMap<String, SftpSession>>` 持锁时间过长，列出和上传相互阻塞。

**实现要点**:

1. **后端分片传输 (`src-tauri/src/sftp.rs`)**：
   - `CHUNK_SIZE = 64 * 1024` + `PROGRESS_INTERVAL_MS = 100`：用 `russh_sftp::client::File` + `tokio::fs::File` 流式读写，每超过 100ms 或完成时 emit 一次 `sftp-progress` event（`{kind, transfer_id, bytes_done, bytes_total, error?}`）
   - `SharedState.sftp_sessions` 存 `Arc<SftpSession>`，`get_sftp` 帮助函数从 map 里 `Arc::clone` 后立刻释放全局锁，列表与上传可在同一 SSH session 内并发
   - `sftp_upload` / `sftp_download` 接受新参数 `transfer_id: String`，并在关键节点写带 `session_id` / `local_path` / `remote_path` / `total_bytes` 的 `tracing::info!`
2. **前端拖拽 (`packages/frontend/src/view/sftp/use-sftp-drop.ts`, 新增)**：
   - 监听 Tauri `drag-enter` / `drag-over` / `drag-leave` / `drag-drop` webview event，拿到原生本地路径
   - drop 时调用 `uploadPaths(paths, remoteDir)` → 自动入队 + 上传，无需中转 `File` 对象
3. **传输队列 (`packages/frontend/src/store/transfer-queue.ts`, 新增)**：
   - Zustand store，记录每条 `TransferRecord`（`status: 'queued' | 'running' | 'done' | 'error'`、`bytesDone` / `bytesTotal` / `speed` / `etaMs`）
   - `enqueue` 自动展开浮层；`updateProgress` 使用最近 1.5s 的滑动窗口算速率；`finish` 决定终态；`clearFinished` 清理
4. **传输服务 (`packages/frontend/src/service/sftp-transfer.ts`, 新增)**：
   - `ensureListener()` 全局只挂一次 `sftp-progress` 监听，把事件路由到 `useTransferQueue`
   - `uploadFile` / `downloadFile` / `uploadPaths`：入队 → invoke 后端 → 失败时 `notify` + `finish('error')`
5. **浮层 UI (`packages/frontend/src/view/sftp/transfer-panel.tsx`, 新增)**：
   - 右下角悬浮、可折叠、按 active / done / error 分组；每行带 `Progress` + 速率 + ETA + 状态图标 + 单条移除
6. **Tauri 配置**：`tauri.conf.json` 给 main window 打开 `dragDropEnabled: true`

**已知限制**:

- 上传/下载本身仍按队列里的顺序串行（同一时刻一个 SFTP 操作），后续如需并发可在 store 层引入并发上限；当前对单连接稳定性更友好。
- `features/terminal/services/sftp.ts` 仍是 legacy 单文件接口，但已内部生成 `transferId` 兼容新后端，未接队列。

**新增 / 修改文件**:

- 新增：`src-tauri/src/sftp.rs` 内的分片实现段、`packages/frontend/src/store/transfer-queue.ts`、`packages/frontend/src/service/sftp-transfer.ts`、`packages/frontend/src/view/sftp/{transfer-panel,use-sftp-drop}.tsx|.ts`
- 修改：`src-tauri/src/state.rs`（`Arc<SftpSession>`）、`src-tauri/tauri.conf.json`、`packages/frontend/src/view/sftp/sftp-container.tsx`、`packages/frontend/src/features/terminal/services/sftp.ts`、`packages/frontend/src/locales/{cn,en,fr}/app.ts`

---

### Issue #29 (t3): 测试覆盖 —— shortcutsService / transfer-queue / use-window-focus ✅ 已实现

**严重程度**: Low
**状态**: ✅ 已实现
**实现时间**: 2026-05-02

**新增测试**:

| 文件                                                   | 关注点                                                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `packages/frontend/src/service/shortcuts.test.ts`      | `parseKeyboardEvent` 修饰键 / `matchShortcut` 默认绑定 + 禁用 / `handleKeyboardEvent` 触发 + 阻止默认 + editable 白名单门禁 |
| `packages/frontend/src/store/transfer-queue.test.ts`   | `enqueue` 入队并展开浮层、`updateProgress` 速率计算、`finish` 终态切换、`clearFinished`、`togglePanel`                      |
| `packages/frontend/src/hooks/use-window-focus.test.ts` | 初始化值与 `document.hasFocus()` 一致、`focus`/`blur` 事件后状态切换、unmount 清理监听                                      |

**踩过的坑**:

- jsdom 下 `document.hasFocus()` 默认返回 `false`，hook 的"初始为 true"断言改为 `expect(...).toBe(document.hasFocus())`，并相应调整测试中事件分发顺序
- PowerShell 下 `pnpm typecheck | Select-Object -Last 80` 会缓冲死，改为 `Tee-Object -FilePath ...` 旁路文件读

---

### Issue #30 (t4): Rust 后端 —— dead_code 清理 + tracing 结构化日志 ✅ 已实现

**严重程度**: Low
**状态**: ✅ 已实现
**实现时间**: 2026-05-02

**结果**:

- `cargo check` 警告：**14 → 0**
- 全部 `eprintln!` / `println!` / `log::info!` 已被 `tracing::*` 取代，并补结构化字段
- 移除 `state.rs` / `storage.rs` 顶部的 blanket `#![allow(dead_code)]`

**实现要点**:

1. **统一日志 (`src-tauri/Cargo.toml` + `lib.rs`)**：
   - 引入 `tracing = "0.1"`、`tracing-subscriber = { version = "0.3", features = ["env-filter", "json", "fmt"] }`、`tracing-log = "0.2"`
   - 新 `init_tracing()`：`EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))` + `fmt::layer().compact()` + `LogTracer::init()` 桥接 russh / tauri / sqlx 等仍走 `log` crate 的依赖
2. **结构化字段**：`session/channel.rs` (`session_id`, `event`, `error`)、`storage.rs` (`backend`, `endpoint`, `path`)、`sftp.rs` (`transfer_id`, `total_bytes`)、`window_cmd.rs` (`enabled`, `label`)
3. **dead_code 精细化**（按字段而非整文件）：
   - `state.rs::SharedState`：`local_sessions` / `shell_channels` / `agent_channels` 加 _字段级_ `#[allow(dead_code)]` + 注释说明它们是 ownership-only 或未来命令的预留点
   - `state.rs::LocalPtySession.{pty_pair, child, writer}`：同上，强调是 _ownership-only_，drop 时统一释放
   - `state.rs::ClientHandler.agent_socket`：`#[cfg_attr(not(unix), allow(dead_code))]`，因为 Windows 上没有 Unix socket 路径会被读
   - `state.rs::ClientHandler.session_id`：`#[allow(dead_code)] // reserved for tracing span correlation`
   - `state.rs::AgentChannel.socket_path`、`state.rs::SerialConfig`、`state.rs::AgentForwardState`：保留为 IPC payload / 生命周期占位，加注释 + `#[allow(dead_code)]`
   - `storage.rs`：从全文件 allow 改为单条带 docstring 的模块级 allow，明确"整个模块是 stub，待对应 Tauri 命令落地后即可移除"

**新增 / 修改文件**:

- 修改：`src-tauri/Cargo.toml`、`src-tauri/src/{lib,state,storage,window_cmd,sftp}.rs`、`src-tauri/src/session/channel.rs`

**验证**:

```text
$ cargo check
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 6.32s
# zero warnings
```

---

## 十七、代码质量 — 大文件拆分 (2026-05-03)

### Issue #31: 多个视图/组件文件超出行数限制 ✅ 已修复

**严重程度**: Important
**状态**: ✅ 已修复
**修复时间**: 2026-05-03

**问题描述**:
`AGENTS.md` 规定视图最大 300 行、组件最大 400 行、工具文件最大 300 行。多个文件超出限制：

| 文件 | 原行数 | 限制 | 超出 |
| --- | --- | --- | --- |
| `view/teams/index.tsx` | 350 | 300 | 50 |
| `host-list/host-dialog.tsx` | 422 | 400 | 22 |
| `view/keychain/index.tsx` | 303 | 300 | 3 |

**修复方案**:

按职责拆分 5 个文件：

1. `view/teams/index.tsx` → `team-list-sidebar.tsx` (侧边栏) + `disabled-teams-view.tsx` (团队禁用视图)
2. `host-list/host-dialog.tsx` → `host-form-basic.tsx` (基础表单) + `host-form-actions.tsx` (底部操作栏)
3. `view/keychain/index.tsx` → `use-key-form.ts` (表单状态 hook)
4. `view/hosts/index.tsx` → `render-list-body.tsx` (列表渲染组件)
5. `view/snippets/index.tsx` → `use-script-form.ts` (脚本表单 hook)

**新增文件**:

- `view/teams/components/team-list-sidebar.tsx`
- `view/teams/components/disabled-teams-view.tsx`
- `components/host-list/host-form-basic.tsx`
- `components/host-list/host-form-actions.tsx`
- `view/keychain/use-key-form.ts`
- `view/hosts/components/render-list-body.tsx`
- `view/snippets/use-script-form.ts`

**验证**: 所有主文件行数降至 300 行以下。

---

## 十八、命令补全 — Tab 键拦截 + 前缀匹配浮层 (2026-05-03)

### Issue #32: 终端无 IDE 风格命令补全 ✅ 已实现

**严重程度**: P2
**状态**: ✅ 已实现
**实现时间**: 2026-05-03

**功能描述**:
在 xterm `onData` 层拦截 Tab 键，提取当前输入词，前缀匹配 SQLite 命令历史，显示浮动补全浮层，支持 Tab/↑↓/Enter/Esc 导航。

**新增文件**:

- `hooks/use-command-completion.ts`：工具函数（`extractCurrentWord` / `findMatches` / `getCursorScreenPosition`）
- `components/terminal-completion/terminal-completion-overlay.tsx`：VS Code 风格浮层组件

**修改文件**:

- `hooks/use-terminal.ts`：新增 `onTabPress` 回调选项，Tab 键拦截逻辑
- `terminal-container/container.tsx`：补全状态管理 + 浮层渲染
- `hooks/use-command-completion.ts`（2026-05-03 增强）：
  - `findPathMatches()` — 通过 `plugin:fs|read_dir` 补全绝对/相对/家目录路径
  - `findSubcommandMatches()` — 覆盖 20+ shell 命令的子命令和参数（git, npm, docker, systemctl, ssh, cargo 等）
  - `classifyWord()` — 根据词形判断补全类型（路径 / 子命令 / 历史）
  - `findAllMatches()` — 统一入口，按需并发获取路径并去重
- `components/terminal-completion/terminal-completion-overlay.tsx`：
  - `onSelect` 改为传递 `CompletionItem` 而非 `string`
  - 每条候选项显示类型图标 + 类型标签（clock / terminal / folder）

**已支持**: 历史前缀匹配 / 路径补全 / shell 子命令补全。

---

## 十九、跨设备同步 — 导出/导入/同步流程完善 (2026-05-03)

### Issue #33: `importDataFromFile()` 为占位符，存储同步未接线 ✅ 已修复

**严重程度**: Important
**状态**: ✅ 已修复
**修复时间**: 2026-05-03

**问题描述**:

1. `sync.ts::importDataFromFile()` 是占位符，导入功能完全不可用
2. `syncToServer()` 未实现
3. `downloadFromServer()` 未实现
4. 存储设置对话框中按钮未接线

**修复方案**:

1. **`importDataFromFile()` 完整实现**: 按依赖顺序导入 groups → hosts → snippets → ssh_keys → known_hosts → workspaces；支持 merge/replace 两种模式
2. **新增 `syncToServer()`**: 上传 `terminal-sync-{timestamp}.json` + `terminal-latest.json`；保存 `lastSyncTime` 到 localStorage
3. **新增 `downloadFromServer()`**: 下载 + `importDataFromFile()` 写入本地 DB；返回导入统计
4. **新增 `getLastSyncTime()` / `formatLastSyncTime()`**: 读取并格式化上次同步时间
5. **存储设置对话框增强**: Sync Now 按钮 + Restore from Server 按钮 + 上次同步时间指示器 + restore mode 选择
6. **i18n 补键**: 中英法三语

**存储路径约定**:

- `terminal-latest.json`：始终最新备份（覆盖写入）
- `terminal-sync-{iso-timestamp}.json`：带时间戳的历史备份

---

### Issue #37: SSH Agent 认证接入统一 API ✅ 已实现

**严重程度**: Medium
**状态**: ✅ 已实现
**实现时间**: 2026-05-03

**问题**: `SessionService` 缺少 Agent 方法；Jump Host 目标主机无法使用 Agent 认证。

**修复内容**:

1. **`SshAgentOptions` 类型**：`packages/frontend/src/features/terminal/types/session.ts`
2. **`SessionService.createSshAgent`**：调用 `session_create_ssh_agent`，含连接日志
3. **Jump Host 目标 Agent**：`connect_via_jump` 接收 `use_target_agent` 参数；从 `jump_host.target_auth_type === 'agent'` 判断是否对目标主机使用 SSH agent
4. **`SshSession::create` 签名**：新增 `use_target_agent: bool` 参数，区分跳板机自身认证与目标主机认证

**修改文件**:

- `src-tauri/src/session/ssh.rs`：`new_with_jump` 读取 `target_auth_type`；`create` 接收 `use_target_agent` 参数；所有 `Self::create` 调用补齐参数
- `packages/frontend/src/features/terminal/{types/session.ts,services/session.ts}`

**回归测试**: 见 Issue #21 回归测试检查清单

---

### Issue #38: 单元测试覆盖增强 ✅ 已完成

**严重程度**: Low
**状态**: ✅ 已完成
**实现时间**: 2026-05-03

**新增测试**:

| 文件 | 覆盖 |
| --- | --- |
| `service/database/command-history.test.ts` | `addCommandHistory` / `getCommandHistory` / `searchCommandHistory` / `clearCommandHistory` |
| `service/database/port-forward-rules.test.ts` | 全套 CRUD，含字段映射和 host_id=null 边界 |
| `store/workspace.test.ts` | `loadWorkspaces` / `setActiveWorkspace` / `deleteWorkspace` / `loadLayout` / `saveLayout` |

**结果**: 14 测试文件，333 测试，全部通过

---

### Issue #39: SSH、串口、本地终端与快捷键跨平台可靠性 ✅ 代码已修复

**严重程度**: High
**状态**: ✅ 可自动验证的缺陷已修复；Windows/Linux、Jump Host 和串口硬件场景待实机回归
**修复时间**: 2026-08-09

**修复内容**:

1. SSH 主机密钥按 host/port 严格校验系统 `known_hosts`；未知主机和密钥变化不再静默接受
2. Jump Host 在 `direct-tcpip` 流内建立并认证第二个 SSH 会话；连接池 key 包含跳板机身份，并保持 transport 到最后一个引用释放
3. Windows Agent 认证使用 OpenSSH named pipe 与 `russh` 原生 Pageant 传输
4. 串口完整 I/O 移至 blocking pool，写入处理短写且不篡改字节，断开/拔线会清理 session
5. 本地 PTY 创建、shell 启动及读写、resize、关闭控制 I/O 移至 blocking pool；统一从用户主目录启动，EOF 后正确标记会话关闭
6. 移除冲突的系统级快捷键，释放 `Ctrl+Shift+V`，并修复结构化 IPC 错误显示
7. SSH shell 读写 half 分离；EOF/Close/断流会关闭会话并释放连接池引用；同一连接 key 的首次创建由异步锁串行化
8. SSH resize 改为 RFC 4254 `window-change`；主终端入口持久化并路由 Jump Host password/key/agent/cert

**自动验证**:

- Rust：44 项测试、`cargo check --locked --all-targets --all-features`、Clippy `-D warnings`、`cargo fmt --check`
- 前端：31 个测试文件共 408 项测试、typecheck、production build；快捷键额外覆盖真实 `Shift+\` 的 `|` 事件
- 仓库：`git diff --check`

**行为说明**:

- 首次连接未知 SSH 主机现在会被拒绝，用户需先通过可信渠道把主机密钥写入 `~/.ssh/known_hosts`
- Agent 登录认证与 Agent forwarding 保持独立；forwarding 只有在 Host 显式 opt-in 后才请求并授权 handler
- Jump Host certificate 已完成代码与自动化验证；真实 CA/服务端组合仍需实机验收

**实机回归**:

- [ ] Windows OpenSSH Agent 与 Pageant
- [ ] Windows/Linux Jump Host（密码、密钥、Agent 目标认证）
- [ ] Windows/Linux 本地 PTY 启动、EOF 与关闭
- [ ] 串口硬件写入、主动断开和运行中拔线

**2026-10-14 runner 边界修复**：Node smoke、shell、raw-input 和 input-probe runner 统一按平台解析 `pnpm.cmd` 与 Tauri `terminal.exe`，并加入名称解析回归；这只消除 Windows 启动器的静态路径阻塞，不能替代 Windows ConPTY、Agent/Pageant 或串口实机矩阵。

同日修复 `runMatrixCases()` 的超时清理计时器：此前 `unref()` 让永不结束的 case 在没有其他活动句柄时直接结束 Node 事件循环，矩阵既不输出失败行也不进入后续 case；现在保留有界清理计时器，超时回归 36/36 通过。

同日按新源码重跑四个证据场景并刷新证据文件：（历史构建 `23c7af6b…` / 指纹 `bc577a5d…`）上 SSH 矩阵 12/12、本地 shell 14/14、真实 SSH shell 7/7 全绿，冷启动 5167/5671/5089ms、远程 prompt marker 3330ms 均低于 10 秒。

---

### Issue #40: 发布门禁与 Team Server 安全缺口 ✅ 本机自动验证已修复

**严重程度**: High
**状态**: ✅ 当前环境可验证问题与容器运行已修复；跨平台和硬件项保持待验证
**修复时间**: 2026-08-09

**问题**:

1. 仓库缺少统一、可重复的前端/服务端/Rust/源码规模发布门禁
2. Team Server 生产 CORS、Token 存储、路由授权、注册冲突、限流、Swagger 与安全头不满足公开部署基线
3. 多个写入接口没有运行时 DTO，路径、查询、同步批次和审计分页缺少边界
4. 跨团队成员/共享/同步/邀请操作可造成越权或资源信息泄露
5. 数据库故障被错误映射为 401 或健康探针 200，原始 Prisma 错误可进入响应、队列或日志
6. 删除与同步 tombstone 分步写入，任一步失败会造成同步数据不一致
7. 生产依赖包含已公开的高危传递依赖

**修复**:

- 新增 `pnpm verify`、生产源码行数脚本与 CI 工作流；447 个生产文件全部满足限制
- Token 改存 `sha256:<digest>`，旧明文/旧摘要在成功认证时迁移；数据库摘要不能直接作为 Bearer Token
- Token 管理路由接入 `ApiKeyGuard`；重复 `userId` 注册返回 409；注册和邀请领取为 5 次/分钟，全局为 120 次/分钟
- 生产 CORS 缺失或通配符时拒绝启动；接入 Helmet；Swagger 生产默认关闭；JSON/urlencoded body 固定限制 1MB
- 为 auth、invite、team、member、share、sync、audit 与路径参数接入 DTO/pipe；同步批次与审计分页上限均为 500
- 修复成员、邀请、共享、同步、冲突和离线队列的团队/成员/创建者校验；敏感共享更新不再降级为明文
- `/health` 与 `/health/ready` 在数据库不可用时返回 503；Compose 改查 readiness；启用 shutdown hooks
- API Key 数据库故障继续作为 5xx；同步响应、队列 `lastError` 与服务日志只使用稳定错误码/事件
- 分享删除与审计 tombstone 使用同一 Prisma 事务
- 覆盖 `fast-uri`、`js-yaml`、`qs` 和 `body-parser` 到修补版本；生产依赖审计为 0 个已知漏洞

**验证**:

- `pnpm install --frozen-lockfile` ✅
- `pnpm audit --registry=https://registry.npmjs.org --prod --audit-level high` ✅ 0 漏洞
- 前端：31 个测试文件、408 项测试，lint/typecheck/build/bundle budget ✅
- Team Server：25 个测试文件、95 项测试，Prisma validate/lint/typecheck/build ✅
- Rust：44 项测试，fmt/check/Clippy `-D warnings` ✅
- Bundle：初始 gzip 227.36 KB / 240 KB，总 gzip 510.09 KB / 550 KB，最大 JS chunk raw 390.87 KB / 500 KB ✅
- 源码规模：447 个生产源码文件，0 个超限 ✅
- `git diff --check` ✅

**后续验证 / 产品决策**:

- [x] Docker Desktop + PostgreSQL 16.15 容器启动、2 个迁移、真实 health/readiness、注册准入、SIGTERM 与恢复均通过
- [ ] Windows/Linux/Pageant/Jump Host/本地 PTY/串口硬件按 Issue #39 矩阵执行
- [x] `POST /auth/register` 生产默认 closed，支持 token/open 显式准入策略；反向代理访问控制仍可作为纵深防御
- [x] Agent forwarding 增加独立设置、显式 `channel.agent_forward(...)`、handler 授权与连接池隔离

---

### Issue #41: 发布终审发现的凭据日志与核心 UI 回归 ✅ 已修复

**严重程度**: High
**状态**: ✅ 已修复
**修复时间**: 2026-08-09

**修复内容**:

- SQLite query/select 失败日志不再输出参数数组，避免 SSH 密码、私钥、证书、passphrase 或 Token 进入控制台；保留截断 SQL 与错误消息用于诊断。
- 新建主机时 Save 按钮不再因不存在旧 `host` 而永久禁用；按钮只在保存进行中禁用，必填字段继续由统一 `handleSubmit` 校验。
- 证书直连的 Tauri 参数统一使用 `privateKey`；当时 Jump Host certificate 先 fail-closed，后续已由 Issue #46 完成双端证书认证。

**回归测试**:

- `service/database/connection.test.ts`：读写失败日志均不包含秘密参数。
- `components/host-list/host-form-actions.test.tsx`：新建态 Save 可点击。
- `hooks/terminal-session-helpers.test.ts`：证书 camelCase 参数；Jump Host certificate 的完成回归见 Issue #46。
- Rust：`JumpHostConfig` camelCase serde 映射；双端 certificate 认证见 Issue #46。

---

### Issue #42: 发布终审的同步、存储、脚本与桌面配置缺口 ✅ 本机可验证问题已修复

**严重程度**: High
**状态**: ✅ 当前环境可自动验证的问题已修复；真实服务与跨平台硬件项保持待验证
**修复时间**: 2026-08-10

**修复内容**:

- Team Server 对 `encryptedData` 与 `isSensitive` 的矛盾组合 fail-closed；敏感记录降级必须提交明确明文。同步和 LOCAL 冲突不再静默保留或覆盖旧密文。
- 离线队列使用嵌套 DTO；敏感 payload 入库前移除明文，UPDATE 强制携带 `baseVersion`，处理器通过原子 `updateMany` claim 并写入 `processingToken` 租约，完成/失败更新校验 token，15 分钟陈旧 `PROCESSING` 任务自动恢复；成功后清空 payload，第三次失败进入终态 `FAILED` 且不会被自动处理器再次占用。
- S3 SigV4 修正 credential scope、canonical URI/query、四行 string-to-sign、列表 URL 与 UTF-8 RFC3986 编码。
- 高级脚本正确传递 timeout，启用最多 10 次 retry；interval/once/cron 非法配置 fail-closed，同一脚本防重入，异步异常被捕获，once 触发后自动禁用。
- Tauri 注册 dialog/fs 插件，capability 仅开放文件选择和文本文件读写；CSP 允许用户配置的 HTTP(S) Team endpoint。
- 备份导入恢复 settings 及 certificate/jump 字段；Known Hosts 界面明确为应用备份副本，SSH 信任仍以用户目录下 OpenSSH `known_hosts` 为准。

**回归验证**:

- Team Server 敏感共享、同步 DTO、同步服务、离线队列和控制器定向测试 43 项通过；Team Server 全量 95 项通过。
- Rust S3 固定向量 4 项、桌面配置 2 项通过；Rust 全量 44 项通过。
- 前端脚本执行与调度、备份导入、Host 映射和认证接线纳入全量 408 项测试。

**仍需外部验证**:

- [ ] 真实 AWS S3 或兼容服务的签名、UTF-8 key、分页列表、上传下载与删除。
- [ ] Windows/Linux OpenSSH Agent、Pageant、Jump Host、本地 PTY、快捷键和串口硬件矩阵。
- [ ] Docker/PostgreSQL 镜像、迁移与 readiness。
- [x] Jump Host certificate 双端认证与输入校验（Issue #46）。
- [x] Agent forwarding 显式入口、handler 授权与连接池隔离（Issue #46）。

---

### Issue #43: v0.0.1-dev.0 缺少多平台资产且 Windows Tauri 编译失败 ✅ 已修复

**严重程度**: High
**状态**: ✅ Windows/macOS/Linux 双架构安装包与校验清单已发布
**发现时间**: 2026-08-10
**修复时间**: 2026-08-11

**问题**:

1. GitHub Release `v0.0.1-dev.0` 的 `assets` 为空，现有 CI 只执行 `tauri build --no-bundle`，不会生成或上传安装包。
2. CI 仅覆盖三个默认 runner，没有区分 macOS、Windows、Linux 的 x64/ARM64。
3. Windows x64 Tauri job 在 SSH 创建和 Agent 认证上报 `implementation of Send is not general enough`；Future 先后暴露了 `&SshConnectionPool`、IPC `String`、`&PublicKey` 与 `&AgentIdentity` 的跨 `await` 借用。
4. 工作流权限为 `contents: read`，无法写入既有 Release，也没有资产命名、非空校验或 checksum 门禁。
5. 首次六目标打包已上传 8 个资产，但最终 job 在无 checkout 的 runner 中调用 `gh release download`，因无法推断仓库而未生成 checksum。

**修复**:

- `SshConnectionPool::creation_lock/get/insert/release` 改为按值接收 `Arc<Self>` 和拥有的 key，调用方显式克隆轻量 `Arc`；连接复用、引用计数与清理行为不变。
- `SshSession::new_with_*` 及五个 SSH Tauri command 改为拥有 `String`/`Option<String>` 参数，内部仅在局部连接逻辑中借用，避免 command Future 持有 IPC 参数引用。
- Agent public key 与 identity 在异步边界前克隆为拥有值；`OwnedIdentityAgentSigner` 在每次签名前拥有 identity，绕开 `russh 0.60.2` 签名 Future 对 `&AgentIdentity` 的借用。
- 新增编译期回归测试，要求连接池 Future 与五个 SSH command Future 满足 `Send + 'static`，防止 Windows Tauri 宏再次接受借用式 Future。
- 新增独立 Release 工作流，使用 macOS Apple Silicon/Intel、Windows ARM64/x64、Linux ARM64/x64 六个原生 runner。
- macOS 上传 DMG，Windows 上传 NSIS，Linux上传 AppImage 与 DEB；名称固定包含版本、系统和架构，逐项验证非空并发布 `SHA256SUMS.txt`。
- checksum job 的 `gh release download/upload` 显式传入 `--repo "$GITHUB_REPOSITORY"`，无需依赖本地 `.git` 目录。
- 不生成未配置签名的 updater JSON；开发版明确保留 Apple notarization 与 Windows Authenticode 未配置状态。

**当前验证**:

- [x] Rust SSH 定向 7 项测试通过，包含连接池锁行为与 `Send + 'static` 编译断言。
- [x] Rust 全量 45 项测试、fmt/check/Clippy `-D warnings` 通过，新增五个 SSH command Future 的 `Send + 'static` 编译回归。
- [x] `.github/workflows/ci.yml` 与 `release.yml` 均通过 YAML 解析和 `actionlint`。
- [x] 提交 `83cd4e8` 的 CI `31409070480` 全绿，macOS、Windows、Linux Tauri 原生编译及前端、Team Server、Rust、Docker、源码规模门禁全部通过。
- [x] Windows x64 与 ARM64 原生 runner 编译、打包并上传非空 NSIS。
- [x] macOS x64/ARM64 原生 runner 打包并上传非空 DMG。
- [x] Linux x64/ARM64 原生 runner 打包并上传非空 AppImage/DEB。
- [x] Release 工作流 `31431531040` 全绿，包含八个确定性命名安装资产与非空 `SHA256SUMS.txt`。
- [x] GitHub Release API 返回的 8 个安装包 digest 与 `SHA256SUMS.txt` 逐项一致。

**不在此自动化验收内**:

- Windows OpenSSH Agent/Pageant、Windows/Linux Jump Host、本地 PTY、快捷键及串口硬件仍按 Issue #39 实机执行。
- 未配置 Apple Developer ID/notarization 与 Windows Authenticode，不能将“包可构建”表述为“已签名”。

---

### Issue #44: 终端会话生命周期与 React 视图耦合 ✅ 已修复

**严重程度**: Important
**状态**: ✅ 已修复；浏览器预览与跨平台实机边界已记录
**发现时间**: 2026-08-12
**修复时间**: 2026-08-12

**问题**:

- 终端连接启动、Tauri 事件监听和 xterm 输入都由视图 hook 直接管理，路由切换会让 React 视图卸载并关闭仍可复用的会话。
- 多标签输出和命令面板写入缺少稳定的 `tabId` 路由边界，存在初始输出丢失或命令投递到错误终端的风险。

**修复**:

- 新增 `features/terminal/services/terminal-session-manager.ts`，以 `tabId` 管理会话记录、连接状态、输出缓冲、写入、resize、断开和重连。
- 新增 `terminal-session-events.ts` 与 `terminal-launcher.ts`，集中管理事件监听和 local/SSH/serial 启动分支。
- `TerminalByUrl` 常驻主布局，路由切换只改变终端工作台的可见性；已删除的标签通过 `prune()` 关闭对应后端会话。
- `terminalEmitter.writeCommand()` 解析当前活动标签，Snippet/History 等命令按目标标签投递。
- 后端 close/exit 事件会清理 session 映射并清空 sessionId，断连后不再接受写入。

**验证**:

- `terminal-session-manager.test.ts` 3 项通过，覆盖稳定 key、连接输出路由、断连后的写入保护。
- 前端 `typecheck`、`lint` 和源码规模门禁通过；已完成浏览器桌面/移动布局检查。
- 浏览器直开无法提供 Tauri IPC，连接错误属于预期；Windows/Linux、Pageant、Jump Host、本地 PTY 和串口仍需按 Issue #39 做实机回归。

---

## 二十、终端工作台交互重构 (2026-08-17)

### Issue #45: 终端工作台状态割裂、分屏失控与焦点丢失 ✅ 已修复

**严重程度**: Important
**状态**: ✅ 前端交互与状态模型已修复；真实连接和跨平台硬件仍按 Issue #39 验证
**发现时间**: 2026-08-16
**修复时间**: 2026-08-17

**问题**:

1. `TerminalWorkbench` 只展示分组中的前两个标签，但旧 `splitTab()` 可继续追加实例，产生没有 UI 入口的第三个会话。
2. 点击或聚焦分屏不会可靠同步 `activeTabId`，导致标签选中态、URL、键盘焦点及 Snippet/History/命令面板的投递目标不一致。
3. 全局标签、会话状态条和终端工具栏重复占用垂直空间；标签右键菜单为手写浮层，键盘与移动端语义不完整。
4. 分隔条只支持鼠标拖动，比例停留在组件局部状态；没有 20/80 约束、键盘操作、双击复位或可靠的工作区恢复。
5. 搜索、菜单和工具侧栏关闭后可能丢失 xterm 焦点；移动键盘的部分标准 Ctrl 控制码映射错误。
6. 工作区切换按“提交活动工作区后再加载布局”执行，目标布局加载失败时可能留下工作区与标签布局不一致的半完成状态。
7. `/terminal` 的空 Outlet 过渡层会透明覆盖工作台；移动端固定底栏会遮住终端键盘栏，全屏层也会被父级堆叠上下文压在底栏下方。

**修复**:

- 参考 `nyala-studio` 的实例/分组/活动面板逻辑，以 `activeTabId` 作为活动 pane、焦点、标签样式、URL `?tab=` 和命令目标的单一来源；`terminalEmitter` 严格按目标 `tabId` 单播。
- 无标签启动时按需延后终端入口；首个标签出现后终端层与 xterm surface 按稳定 `tab.id` 常驻，路由切换只控制可见性；活动标签改变时统一执行 `fit()` 与 `focus()`。
- 分屏收紧为每组最多两个 pane，串口标签禁用分屏；加载工作区时归一化旧的异常分组、比例及无效活动标签。
- 新增可访问分隔条：视觉宽度 4px、命中区 20px，支持 Pointer、方向键、Home/End、双击回到 50/50；比例限制为 20/80，写回 Zustand 并合并 xterm resize。
- 标签改用 shadcn `ContextMenu` / `DropdownMenu`，支持重排、关闭、水平/垂直分屏、退出分屏及键盘导航；原状态条和工具栏合并为紧凑 pane header。
- 搜索、菜单和工具侧栏关闭后把焦点归还当前 xterm；移动端保留长按 Sheet 菜单与键盘栏，并修复 `Ctrl+3…8`、`Ctrl+?`、`Ctrl+Space` 等标准控制码。
- 工作区切换改为共享事务：先保存当前布局并预载目标布局，确认成功后再提交活动工作区和标签；失败时回滚原状态。顶栏统一挂载 `WorkspaceSwitcher`。
- `/terminal` 路由把空 Outlet 层设为不可见且不可命中，pane 使用捕获阶段同步活动标签；移动工作台按底栏与安全区缩短，底栏活动态改由路由派生并在窄屏等分伸缩，全屏终端通过 portal 挂到 `document.body`。
- 全屏切换时把同一 xterm DOM 节点重新挂到 portal 容器，观察稳定的 xterm 元素完成 resize；非活动 pane 或离开终端路由会关闭全屏、搜索和移动菜单，Sheet/Dialog 层级保持高于全屏层。
- 移动终端路由新增 44px 会话栏，支持横向切换、关闭和新建；活动 pane 增加 `aria-current` 与 ring，不改变布局尺寸。

**自动验证**:

- Store 测试覆盖双分屏上限、串口禁用、关闭/移出分组、20/80 限制、布局归一化和标签重排。
- 组件与路由测试覆盖标签菜单、活动 pane、分隔条键盘行为、URL 双向同步、常驻 xterm、焦点恢复及命令严格单播。
- 移动端测试覆盖长按菜单、触控操作和完整键盘栏控制码；工作区测试覆盖保存、预载、提交与失败回滚。
- 布局回归测试覆盖空 Outlet 不再拦截终端、底部导航随路由更新活动态，以及全屏终端脱离工作台堆叠上下文。
- 生命周期回归覆盖无标签时不加载终端入口、首次创建后常驻、最后标签关闭后的会话清理及全屏往返节点连续性；完整前端测试为 59 个文件、547 项。
- production build 与包体门禁通过：首屏/总 gzip 为 237.66/524.17 KB，分别低于 240/550 KB 预算。

**浏览器验证**:

- 1440×900、1024×768、390×844 和 360×800 均无页面级溢出；639/640px 断点两侧分别正确保留和移除移动底栏避让。
- 390×844 下会话栏可切换/关闭多会话，工作台底边与底栏顶边一致，终端键盘按钮中心点可命中；360×800 下六个底栏入口各 60px 且无横向溢出；全屏层挂在 `body` 后可覆盖底栏，键盘帮助 Sheet 可覆盖全屏层。
- 已验证双 pane 的 20/80 边界、双击复位、pane 点击激活、URL/焦点同步、移动导航 Sheet 标题与工作区入口；浏览器中的数据库和本地 PTY 错误属于缺少 Tauri IPC 的预期边界。

**验证边界**:

- 本轮仅重构前端 UI 与状态模型，未修改 Rust、数据库 schema、SSH/SFTP/串口协议或 Tauri capability。
- 浏览器测试只能验证布局、交互、主题与前端状态，不能证明真实 SSH、本地 PTY、Windows/Linux、OpenSSH Agent、Pageant、Jump Host 或串口硬件已通过；这些项目继续保留在 Issue #39 的实机矩阵中。

---

## 二十一、SSH 高级认证与 Team Server 准入收口 (2026-08-19)

### Issue #46: Agent forwarding 越权边界、Jump certificate 缺口与公开注册 ✅ 本机代码与容器验收完成

**严重程度**: High
**状态**: ✅ 自动化、静态门禁与 Team Server 容器运行通过；真实 SSH 和跨平台场景待验证
**修复时间**: 2026-08-19

**问题**:

1. Agent forwarding 只有 shell 请求开关，`ClientHandler` 对服务端主动打开的 Agent channel 没有连接级授权检查；连接池也未区分 forwarding 权限。
2. Agent forwarding 缺少独立 Host 设置、SQLite/同步持久化和所有 SSH IPC 分支的统一传播；团队共享还可能替接收者静默开启高权限设置。
3. Jump Host 的跳板端和目标端 certificate 被前后端主动拒绝，IPC 也没有目标证书字段。
4. Team Server `/auth/register` 仅有限流，没有应用级准入；Compose 未配置绑定地址时默认暴露到 `0.0.0.0`。

**修复**:

- Host 新增默认关闭的 `agentForwarding`；SQLite 新库/旧库迁移、CRUD、备份同步、共享边界及 password/key/agent/cert/jump IPC 均已接线。
- opt-in shell channel 显式请求 `agent_forward(true)`；`ClientHandler` 保存不可变授权，未授权时关闭服务端主动 Agent channel，且绝不连接本地 Agent。
- 连接池 key 包含 forwarding 模式；Jump Host transport 固定禁用，最终目标 handler 才按 Host 设置授权。
- 团队共享不传播 forwarding 权限，团队导入始终关闭；个人备份只把严格的 `true`/`1` 解析为开启。
- `session_create_ssh_jump` 增加可选 `targetCertificate`；跳板端与目标端 certificate 都复用 OpenSSH certificate 认证，缺证书或私钥时 fail-closed。
- 交互终端、脚本/命令执行和 legacy SSH facade 均复用统一的 Jump Host certificate 类型与会话入口。
- Team Server 增加 `REGISTRATION_MODE=closed|token|open`：生产默认 closed；token 模式要求至少 32 字符，使用 SHA-256 固定长度摘要和常量时间比较；拒绝发生在 Prisma 访问前。
- 启动配置要求显式、精确的 `NODE_ENV` 并拒绝非法注册模式，避免校验值与 Helmet/CORS/Swagger 使用的运行环境分叉；Compose 默认绑定 `127.0.0.1`，注册模式默认 closed。

**自动验证**:

- `pnpm verify`：前端 63 个测试文件/561 项、Team Server 25 个文件/103 项、Rust 47 项单测 + 2 项集成测试全部通过。
- Prisma validate、lint、typecheck、Nest/Vite production build、bundle budget、Rust fmt/check/Clippy `-D warnings` 与 462 个生产源码文件规模门禁全部通过。
- Bundle 初始/总 gzip 为 237.68/524.42 KB，低于 240/550 KB 预算；最大 JS chunk raw 401.56 KB，低于 500 KB。
- `docker compose --env-file .env.example config --quiet` 与 `git diff --check` 通过。
- Docker Desktop + PostgreSQL 16.15 运行通过：2 个迁移无 pending，三类 health 均为 200；closed/错误 token 为 403 且不新增用户，正确 token/open 为 201；缺失/非法环境退出码 1；SIGTERM 退出码 0，重启后 readiness 恢复。

**仍需外部验证**:

- [ ] macOS/Linux OpenSSH Agent forwarding：开/关、服务端主动 channel、连接池模式切换与多标签。
- [ ] Windows OpenSSH named pipe 与 Pageant forwarding/login。
- [ ] Jump Host 跳板端/目标端 certificate 的真实 CA、加密私钥、拒绝和断开路径。

### Issue #47: Prisma 配置链传递依赖高危漏洞 ✅ 已修复

**严重程度**: High
**状态**: ✅ 修复版依赖、Prisma 门禁与生产依赖审计通过
**修复时间**: 2026-08-19

**问题**:

- `prisma@7.9.1` 通过 `@prisma/config@7.9.1` 固定引入 `deepmerge-ts@7.1.5`，命中 CVE-2026-40345 / GHSA-ggr8-5vv4-36mx；精心构造的循环对象图可触发同步栈耗尽。
- 截至修复时最新版 Prisma 仍固定易受影响版本，直接升级 Prisma 无法消除告警。

**修复与验证**:

- 在根 `pnpm.overrides` 将 `deepmerge-ts` 固定到修复版 `8.0.1`，锁文件中依赖树只保留该版本。
- `pnpm install --frozen-lockfile` 与 Prisma Client generate 通过。
- Prisma validate、Team Server lint/typecheck、25 个文件/103 项测试及 production build 通过。
- `pnpm audit --registry=https://registry.npmjs.org --prod --audit-level high` 返回 `No known vulnerabilities found`。

### Issue #48: 终端输入失真、输出失控与会话生命周期泄漏 🟡 核心缺陷已修复，外部实机矩阵待验收

**严重程度**: High
**状态**: macOS 本地 PTY/Tauri/xterm 核心链路已修复并通过真实 smoke，WKWebView 兼容 core 已恢复；xterm 输入协议事件级回归、三个真实 Tauri/PTY raw-input case 及 macOS SSH 矩阵已通过；人工物理键盘/IME、Windows/Linux 外部交互与硬件矩阵仍待验收
**发现/修复时间**: 2026-08-19 至 2026-08-21

**问题**:

1. 前端曾吞掉 Tab/方向键并用 `term.write()` 伪造历史，导致 readline、vim、nano 等程序状态失真；WebKit/IME 输入还可能重复或丢失。
2. local/SSH 输出按任意 IPC chunk 做 lossy UTF-8 解码，xterm 没有消费 ACK，高频输出会无限堆积或离屏静默截断。
3. PTY 固定以 `80x24` 创建，首次 fit/resize 可能丢失；设置键名与实际 `AppSettings` 不一致，隐藏标签长期占用 WebGL context。
4. 自然 EOF、connecting 取消和快速 reconnect 可能留下 session/meta/channel，旧 generation 输出也可能污染新会话。
5. SSH TCP 建连、认证和 Jump Host 隧道缺少阶段 deadline，网络异常时连接操作可能无限等待；可靠性重构一度把必要的 `@baicie/xterm` WebKit 兼容分支误判为异常来源并迁回官方 core，导致重叠按键修复回退。
6. 首版背压 watchdog 从首次到达 1 MiB 高水位后固定计时，即使前端持续完成 xterm write 并 ACK，也必须一次降到 128 KiB 才会取消 deadline；真实 8 MiB 输出因此在“缓慢但持续前进”时被误判为停滞。
7. 前端输出调度曾把 RAF 当作唯一启动条件；同 bundle id 窗口并存或 WebView 被遮挡时，RAF 可降至约 2Hz 甚至暂停，使标准 smoke 一次在 `ready` 阶段超时、一次耗时 123.989 秒。
8. 输出调度器修复后，smoke 自身的 `defaultNextFrame()` 仍只等待 RAF；RAF 永不回调时测试控制流无法继续并提交结果，最终由 Rust watchdog 报 `stage rust-watchdog: terminal smoke timed out`。
9. 首版 fallback 在每个 xterm callback 后通过 microtask 提交下一批，使 xterm 内部 WriteBuffer 短暂清空并重新依赖其 `setTimeout(0)`；WKWebView 节流该定时器后，ACK 间隔可超过 10 秒。队列清空后到达的不足 32 KiB 受流控事件也只竞速 RAF/timer，同样可能在进入 xterm 前超时。
10. fallback 排空后队列可能短暂为空；若随后到达的是没有后端字节计数的尾批次，调度器会退出 fallback 并重新等待同时被节流的 RAF/timer。

**修复**:

- 参考 MIT Nyaterm 固定提交 `70306b5c83e9f58c85a4f86a00440cd2be2cd57a` 的输出事件字节数、callback ACK 和高低水位协议，在本项目 `SessionManager`/Tauri event 架构内重新实现。
- 输入改为透明 `onData`/`onBinary` 进入单写者 FIFO；恢复 `@baicie/xterm@0.1.7` 内部 `AppleWebKit` 键盘路径，DOM `input` fallback 保持移除以避免与 core 双发；connecting 阶段允许排队输入，关闭后拒绝新数据。
- Rust 使用流式 UTF-8 decoder、有界输出泵和 16ms/32 KiB 批处理；前端单次 write 上限为 32 KiB，超大事件按 UTF-8/Unicode 边界拆分，单 `xterm.write` 在途且 callback 后才 ACK。ACK 控制面使用原子累计 + `Notify`，local/SSH 在 1 MiB/128 KiB 水位暂停/恢复；每次正向 ACK 都刷新“无进展”deadline，完全无 ACK 仍会在 10 秒后 fail-closed。
- 输出调度前台仍优先 RAF；所有受流控输出同时安排 microtask，避免不足 32 KiB 的尾批次同时受调度器 RAF/timer 节流。进入 fallback 后，首批由 microtask 提交给 xterm，后续批次直接在 xterm callback 内追加，让已经启动的 parse slice 继续有数据，避免每个 32 KiB 批次都重新等待 xterm 内部 timer；fallback 状态跨越短暂空队列，确保随后无字节计数的尾批次也能由 microtask 进入 xterm，只有 reset、dispose 或 generation 变化时复位。xterm 首次空队列写入和约 12ms slice 主动让出仍可能使用其内部 timer，未声称完全规避 WebView timer 节流。
- smoke 阶段切换改用 `waitForTerminalSmokeFrame()`，让 RAF 与 100ms timeout 竞速并取消未完成的一侧；回归覆盖 RAF 永不回调时仍可继续。
- 创建前同步有效尺寸，resize latest-wins；设置真实作用于当前 xterm core；只为可见活动终端启用 WebGL，context loss 回退默认 renderer。
- EOF/close/reconnect 使用 generation 和幂等清理；本地 child 在初始化失败、EOF 和 close 路径统一 kill/wait/reap；SSH 连接、认证、Jump 隧道、channel/PTY/shell/exec/write/resize 均增加 deadline，过期 writer 命令不会在调用方超时后继续执行，fatal writer completion 会主动结束 reader、上报错误并清理 session，自然 EOF 先关闭 writer 再释放 transport，交互 transport 启用 TCP_NODELAY。
- 运行时与 CSS 恢复并精确固定 `@baicie/xterm@0.1.7`，保留必要 typings shim 与官方 `@xterm/addon-*`；依赖契约测试禁止直接安装官方 core，并验证 Vite 的 `xterm-core` 分包规则命中兼容分支。

**自动验证**:

- 前端终端定向测试覆盖输入透明、依赖/分包契约、IME/WebKit 边界、输出 ACK/字节计数、UTF-8 安全分片、RAF/timer 节流 fallback、xterm WriteBuffer 连续续写、背压、尺寸、设置、renderer、生命周期、smoke 入口隔离和重连；2026-08-21 新增 fallback 空队列尾批次回归，当前前端全量为 93 个测试文件/801 项通过。
- 新增兼容版 xterm 输入协议事件级回归（3 项）：真实打开 xterm 并通过 DOM 事件验证 SGR mouse 的 `onData` 报告、DECSET 2004 的 bracketed paste 包装，以及高位 X10/default mouse 的 `onBinary` 字节经 `registerTerminalInput` 原样转发；该测试证明前端事件桥接，不声称真实 Tauri/PTY 流量或物理设备通过。此限定仅适用于该事件级测试，后续 Issue #60/Phase 6.27 已补充独立真实 Tauri/PTY 证据。
- macOS 真实 `portable-pty` 自动化 round-trip 使用隔离的 `/bin/sh -c` 测试 shell，覆盖 PTY 默认回显、`read` 精确接收中文/emoji、shell 内 `stty size` 读取 `31 97` 及正常退出等待；该测试直接驱动系统 PTY，不是 mock，也不加载用户 profile。
- Rust 112 个单测 + 2 个桌面配置集成测试通过，覆盖 ACK 进展刷新 watchdog、完全无 ACK 超时、over-ACK、SSH writer fatal completion/有界关闭、PTY 生命周期与 smoke 命令边界；`cargo fmt --check` 与 Clippy `-D warnings` 通过。
- 恢复兼容 core 后完整 `pnpm verify` 通过：前端 79 个文件/675 项、Team Server 25 个文件/103 项、Rust 112 个单测 + 2 个桌面配置集成测试，及 lint/typecheck/build/bundle/fmt/Clippy/478 文件规模门禁；首屏/总 gzip 为 108.16/545.92 KB。
- 修复后的标准 Tauri/xterm smoke 已通过：shell 命令精确生成 8,388,608 字节，xterm 中观察到 `LOAD_END`，随后命令 `AFTER_LOAD_OK` 仍可见；resize 后 shell 的 `stty size` 返回 `31 97`，xterm 为 97 列 × 31 行。恢复 `@baicie/xterm@0.1.7` 并重新构建 Tauri 调试二进制后的最新运行耗时 562 ms，三个可见性标记均为 true。该结果不等同于独立逐字节统计 parser 消费了全部 8 MiB，也不证明物理重叠按键。

**仍需外部验证**:

- [x] 前端 `onBinary` → `Uint8Array` → Tauri `Vec<u8>` 及文本/raw 共用 FIFO 的代码和服务边界回归。
- [x] 兼容版 xterm 事件级输入回归：SGR mouse、bracketed paste、高位 X10/default mouse raw bytes；测试文件为 `packages/frontend/src/features/terminal/components/terminal-container/terminal-input-protocol.test.ts`。
- [x] 真实 xterm/Tauri 端到端原始输入协议：SGR mouse、bracketed paste 和高位 X10/default mouse raw bytes 已在 2026-10-10 通过；证据见 [`2026-10-10-macos-raw-input.json`](verification/2026-10-10-macos-raw-input.json)。该探针不替代人工鼠标或系统粘贴验收。
- [x] macOS 系统 PTY 自动化 smoke：登录 shell、默认回显、`read` Unicode、`stty size` 与正常退出。
- [x] Tauri/xterm 中的 macOS 基础本地 PTY：登录 zsh、普通命令、Unicode、Ctrl+C 与 `stty size`。
- [x] 用修复后调试包复跑 8 MiB 高频输出，确认 `LOAD_END`、后续命令和 resize 往返仍可用。
- [ ] 在 macOS WKWebView 多轮近同时按物理 `a/s/d` 并确认 PTY 不丢不重；补快速连续输入、Option/dead key、中文 IME、vim/nano、连续 resize、SGR mouse、bracketed paste 与非 UTF-8 原始输入实测。
- [x] macOS 可用 SSH 服务的 password/key/agent/cert/Jump 初连与五种断线重连已通过；当前工作树最新证据见 [`2026-10-11-macos-ssh-matrix-current.json`](verification/2026-10-11-macos-ssh-matrix-current.json)。Windows/Linux 外部服务矩阵仍单独待验收。
- [ ] Windows/Linux PTY、OpenSSH/Pageant、串口硬件和签名/公证发布矩阵。

### Issue #49: Host Profile 已保存但未作用于交互会话 ✅

**严重程度**: Medium
**状态**: ✅ 已接通；跨平台 shell 与真实 Host 仍需实机验收
**修复时间**: 2026-08-22

**问题**:

- Hosts UI 和 SQLite 已保存 `startupCommand` / `environment`，但终端创建命令没有携带这些字段，一键打开主机无法复现保存的工作目录、环境和启动动作。

**修复**:

- 新增受校验的 `TerminalProfile` IPC 契约；local PTY 在 spawn 前注入 environment，SSH/Jump Host 在 shell request 前发送 environment request。
- startup command 在 shell/PTY 确认建立后发送，避免把用户命令拼进认证、PTY 或远程主机地址参数；reconnect 复用同一 Host profile。
- 增加 profile payload、输入校验和 SSH request 顺序回归测试。

**仍需外部验证**:

- [ ] macOS/Linux/Windows shell 对环境变量和 startup command 的真实行为。
- [ ] SSH 服务端禁用 env request、断线重连和 Jump Host 目标 shell 的行为。

### Issue #50: 标签栏缺少会话级连接状态投影 ✅ 已修复

**严重程度**: Medium
**状态**: ✅ 已修复；真实连接时序仍需实机确认
**发现/修复时间**: 2026-08-22

**问题**:

- 连接状态只存在于 pane 内的 `TerminalSessionManager` 绑定，标签栏无法在切换标签前判断哪个会话正在连接、已断开或可重连。

**修复**:

- `TerminalContainer` 将 session manager 状态投影到所属 `Tab.connectionStatus`；connecting 与 reconnecting 统一为连接中，error 与 disconnected 统一为断开，避免创建第二套生命周期状态机。
- `MenuTabs` 渲染连接状态点，保持标签的可访问名称、键盘导航和关闭动作不变。

**验证**:

- 容器与标签栏定向测试共 17 项通过，覆盖 connected、connecting、disconnected 状态及原标签名称保持不变。
- 浏览器自动化不能替代真实 PTY/SSH/serial；状态点在真实连接、断线和重连矩阵中仍需确认。

### Issue #51: 启动恢复串行加载拖慢首个终端 ✅ 已修复

**严重程度**: Medium
**状态**: ✅ 已修复；本地 Tauri/macOS AX readiness、严格进程 stopwatch 和 Node 24 下真实远程 prompt marker round-trip 均已测量，人工可视/键盘矩阵仍待补测
**发现/修复时间**: 2026-08-22

**问题**:

- `startWorkspaceRecovery()` 先等待工作区加载，再等待主机加载；两条独立的 SQLite 读取路径会叠加首屏恢复延迟，影响打开应用后快速进入终端。

**修复**:

- 工作区与主机加载现在并行启动；workspace id 确定后立即开始布局读取，并在 hosts 加载完成后统一过滤已删除主机，保持恢复数据一致性。

**验证**:

- 新增并行启动与布局提前读取回归，全量前端 96 个测试文件/816 项通过；lint、typecheck、build 和源码规模门禁通过。
- 2026-10-09 在 macOS 15.7.7 arm64 的正式 debug bundle 上，从无进程启动到 AX tree 同时出现 Local、已连接、Terminal input 和可见 zsh prompt 的三次观测为 5408ms、4477ms、5840ms，均低于 10 秒；逐次证据见 [`2026-10-09-macos-cold-start.json`](verification/2026-10-09-macos-cold-start.json)。
- 2026-10-10 新增 `smoke:cold-start` 进程级 stopwatch：从目标进程 `spawn` 事件计时，并要求 Local、Connected、Terminal input 三项 AX-visible readiness 同时成立；AX 中的 shell prompt 字段只作诊断，shell 交互由本地 PTY smoke 证明。11 项注入式 Node 回归已纳入 `pnpm verify scripts`。早先因 macOS 锁屏导致三项 AX readiness 均为 false 的复跑作为环境失败边界保留在 [`2026-10-10-macos-cold-start-blocked.json`](verification/2026-10-10-macos-cold-start-blocked.json)；随后 native ApplicationServices helper 在可用桌面环境中严格复跑成功，历史记录 `spawnToReadyMs=4963`，三项 readiness 全部成立。
- SSH host-key preflight 的 direct/jump 路径现在共享不超过 8 秒的绝对 deadline；网络连接与 `known_hosts` blocking 检查都受同一 deadline 约束，超时通过既有 gate error/retry 分支呈现，不改变未知/变更 key 的信任语义。Rust host-key 定向测试 15/15 通过。
- 启动恢复超过 2 秒时，`App` 会先创建标记为 `startupFallback` 的本地终端；数据库恢复完成后只允许替换该临时 tab，不会覆盖用户在恢复期间创建的 tab。相关 App/workspace-recovery 回归覆盖兜底、迟到恢复和用户 tab 保护。
- 修复首次启动无已保存布局时的持久化窗口：recovery 完成建立订阅后，若当前已有 fallback 或用户在恢复期间创建的 tab 且没有待恢复快照，会立即进入同一 journal/debounce 保存路径；`startupFallback` 在落盘时被清成普通 local tab，避免重启后再次作为临时兜底。
- 历史 4963ms/4885ms 记录是从进程 `spawn` 到 AX readiness 的严格 stopwatch；当前四次复测为 5648/4920/4647/4595ms，证据见 [`2026-10-11-macos-cold-start-current.json`](verification/2026-10-11-macos-cold-start-current.json)。2026-10-09 的三次记录仍属于包含 UI automation 开销的 request-to-AX 观测。上述结果均不覆盖真实远程 SSH 首个可输入 prompt；Windows/Linux、真人物理键盘和真实 IME 仍按实机矩阵验收。
- 2026-10-11 在隔离 SQLite workspace + localhost OpenSSH fixture 上新增 OSC 133 `prompt-start` round-trip：历史 bundle 记录为 3478ms/3286ms；当前 bash fixture 复测为 3330ms。prompt marker 只有在 `xterm.input(command + '\\r', false)` 经 Tauri IPC、SSH PTY 回送并被终端输出观察后才写入，见 [`2026-10-11-macos-remote-shell-prompt-rerun.json`](verification/2026-10-11-macos-remote-shell-prompt-rerun.json)。AX flags 仅作诊断，不把 WebKit canvas/input 可见性冒充为失败或通过。
- 2026-10-11 新增 recovery 回归：首次启动无 saved layout 时，延迟 fallback 会写入 journal 并在 debounce 后保存为普通 local layout；workspace recovery 与 App reject/fallback 定向测试、前端全量测试和 typecheck 通过。数据库本身不可用导致 `loadWorkspaces()` reject 时仍保持错误边界，不能声称持久化已通过。

### Issue #52: 多标签无法显示 shell 当前路径/窗口标题 ✅ 已修复

**严重程度**: Medium
**状态**: ✅ 已修复；真实 shell 程序标题矩阵仍需实机确认
**发现/修复时间**: 2026-08-22

**问题**:

- 多个终端标签始终显示创建时的 Host/Local 名称，无法区分 shell 当前目录、vim/tmux 窗口或远程程序标题。

**修复**:

- 订阅 xterm `onTitleChange`，接收 OSC 0/2 标题并规范化空白、移除空标题、限制为 160 字符。
- 将动态标题写入进程内 `Tab.title`，标签栏和 pane header优先显示它；持久 `Tab.label` 仍作为回退名称。
- 工作区恢复只保留 `label`/Host 配置，不把远端 shell 的动态标题写入 SQLite。

**验证**:

- xterm 订阅、标题规范化和标签展示回归已覆盖；全量前端 96 个测试文件/816 项通过，lint、typecheck、build 和源码规模门禁通过。
- 仍需在真实 zsh/bash、vim、tmux、SSH 和断线重连场景确认标题事件时序。

### Issue #54: Shell Integration 事件缺少统一前端协议 ✅ 已修复

**严重程度**: Medium
**状态**: ✅ xterm OSC 133/7 解析与当前目录投影已接入；常见 shell 的显式配置和真实程序矩阵待验证
**发现/修复时间**: 2026-08-22

**问题**:

- Termius/Tabby 风格的命令阶段、退出码和当前目录依赖 shell integration；此前终端只处理 OSC 0/2 标题，没有统一消费 OSC 133/7 的协议边界。

**修复**:

- 新增 `terminal-shell-integration.ts`，严格解析 OSC 133（prompt/command/output/exit）和 OSC 7（file URI cwd），限制路径长度、控制字符和退出码范围，非法数据安全忽略。
- xterm 实例通过公开 `term.parser.registerOscHandler` 注册监听器，卸载时释放；事件只更新当前目录/阶段状态，不拦截、重放或伪造用户输入。
- pane header 在 shell 报告 cwd 后显示当前目录；动态状态保持进程内，不写入 workspace layout。

**验证**:

- Shell Integration 协议、xterm 监听生命周期、pane 目录投影定向测试通过；前端 typecheck、lint 通过。
- 当前未把 shell 配置自动写入用户 profile；bash/zsh/fish 的显式配置、vim/tmux/SSH 时序和真实退出码仍需实机验收。

### Issue #53: 标准 Tauri smoke 的 Unicode 阶段超时 ✅ 已修复

**严重程度**: High
**状态**: ✅ 已修复；物理键盘和完整认证矩阵仍需实机验收
**发现/修复时间**: 2026-08-22

**问题**:

- 标准 `pnpm smoke:terminal` 在 `ready` 阶段之后输入 Unicode 命令时，隔离 SSH shell 使用 `env -i` 且没有 UTF-8 locale。macOS `/bin/sh` 的行编辑器按 C locale 重绘多字节输入，产生 `\x1b[1@` / `\x1b[1P` 等控制序列，Unicode marker 无法形成，最终由 Rust watchdog 超时。
- 旧调试二进制还可能掩盖当前前端 smoke 源码；失败诊断因此增加了受限的原始输出尾部，不改变产品终端路径。

**修复**:

- smoke fixture 为隔离 shell 显式注入 `LANG=en_US.UTF-8` 与 `LC_CTYPE=en_US.UTF-8`，保持 `env -i` 的其他隔离属性。
- smoke round 仅在失败诊断中保留最近 4 KiB 原始输出，结合输入/输出计数定位阶段，不持久化用户终端内容。

**验证**:

- 最新调试包的标准 macOS Tauri/xterm smoke 通过：8 MiB 输出、后续命令、97×31 resize、10 个唯一会话、资源回收，`durationMs=6006`。
- `node --test scripts/terminal-smoke-sshd.test.mjs scripts/run-terminal-smoke.test.mjs` 14 项通过；前端 816 项测试、lint、typecheck、源码规模门禁通过。

### Issue #55: 重连 smoke 未真正断开活动 SSH session ✅ 已修复

**严重程度**: High
**状态**: ✅ 已修复并通过真实 localhost OpenSSH 重连
**发现/修复时间**: 2026-08-24

**问题**:

- smoke 的 `sshd.restart()` 只终止监听 daemon 的进程组；macOS `sshd-session` 会进入独立 PGID，并继续持有已建立的 TCP 连接与 daemon stderr。
- 应用因此从未观察到 SSH EOF，也不会进入自动重连；Node 同时等待仍被 session 持有的 stderr 关闭，最终只能由 180 秒 Rust watchdog 报超时。

**修复**:

- 使用 `/bin/ps -axo pid=,ppid=,pgid=` 枚举 fixture daemon 的直接子进程，只接受安全整数 PID/PGID，并只向满足 `pid === pgid` 的隔离 SSH session 进程组发信号。
- 停止顺序固定为 session groups `SIGTERM`、daemon group `SIGTERM`；3 秒宽限期后对两者分别升级 `SIGKILL`。非法元数据或非隔离子进程 fail-closed，避免误杀。

**验证**:

- Node smoke 脚本 23 项通过，覆盖活动 session 先于 daemon 终止、非法 PID/PGID、非隔离 PGID、宽限期升级和失败清理。
- `pnpm smoke:terminal:reconnect` 真实通过：8 MiB 输出、10 轮完成、11 个唯一 session、97×31 resize、重连可见、旧输出拒绝、资源回收，耗时 6.7 秒。
- 该 fixture 验证 localhost public-key OpenSSH 的真实断线，不替代 password/agent/cert/Jump、外部网络或跨平台实机矩阵。

### Issue #56: Shell Integration API 与 WebKit CSP 使主终端崩溃/无样式 ✅ 已修复

**严重程度**: Critical
**状态**: ✅ 已修复并通过真实 Tauri/WKWebView 验证
**发现/修复时间**: 2026-08-26

**问题**:

- Shell Integration 错把 OSC 监听注册到不存在的 `term.registerOscHandler`，类型补丁掩盖了 `@baicie/xterm@0.1.7` 的真实 API，主终端初始化时直接崩溃。
- 入口内联 `<style>` 被 Tauri 注入 nonce/hash 后，WebKit 忽略同一 `style-src` 中的 `unsafe-inline`，导致 xterm 动态样式被大量拒绝；多行 viewport 还产生空 key 警告。

**修复与验证**:

- 改用运行时公开的 `term.parser.registerOscHandler`，测试 mock 与真实 API 对齐；入口样式原样移入外链 CSS，viewport 改为无首尾空白的单行声明，不关闭 Tauri CSP 自动修改。
- 终端与 Shell Integration 定向测试 18 项通过；完整 `pnpm verify` 为前端 839、Team Server 103、Rust 153 + 3 项测试及全部构建/静态门禁通过。重建 debug App 后，真实 macOS WKWebView 的本地 PTY 显示 Connected，Safari Web Inspector 在主终端页为 0 error/0 warning。

---

_本节最后更新: 2026-10-11_

---

## 二十二、真实 SSH 认证矩阵与物理键盘探针 (2026-08-28)

### Issue #57: 真实 SSH 认证矩阵与断线重连验收 ✅ macOS 本机通过

**严重程度**: High
**状态**: ✅ macOS 实机与旧版 macOS/Linux CI 认证基线通过；🟡 新版 12-case workflow 待远端重跑；Windows 保持人工清单
**发现/修复时间**: 2026-08-28

**问题**:

- 既有 smoke 只有 public-key 一种认证与单种断线重连，无法回答「password/key/agent/cert/Jump 全矩阵是否真的可用」；首次连接耗时有门禁但没有进入结果契约。
- 第一次矩阵运行暴露 6 个真实缺陷：配置契约拒绝 Rust 省略的可选字段、agent 用例误用被覆盖为 null 的私钥、密码容器入口脚本缺少执行位、cert 探针被 macOS sshd 忽略 authorized_keys `command=` 掩盖真实失败、jump 目录未递归创建、证书文件尾随注释被严格校验拒绝。

**修复**:

- smoke 契约扩展 `authMode`/`password`/`certificate`/`jump`，前端与 Rust 双端严格校验；`firstConnectionMs` 进入结果并在前端、Rust、runner 三层门禁「< 10 秒」。
- sshd fixture 支持 cert（CA 签发 + `TrustedUserCAKeys`；**macOS sshd 对证书认证不套用 authorized_keys `command=` 选项**，隔离策略改为证书内嵌 `clear/permit-pty/force-command/source-address`）与 jump（`AllowTcpForwarding yes` + `PermitOpen` + `no-pty`）。
- 新增 Docker Debian OpenSSH 密码 fixture、隔离 `ssh-agent`、jump 双实例合成连接；`smoke:ssh-matrix` 一次构建跑 7 个用例。

**真实验收（本机 macOS 15.7 arm64，真实 OpenSSH / ssh-agent / CA 证书 / Docker Debian OpenSSH）**:

| 用例 | 结果 | 首次连接 | 总耗时 |
| --- | --- | --- | --- |
| key（10 轮 × 8 MiB） | ✅ | 2427 ms | 10531 ms |
| key + 断线重连（11 个唯一 session、旧输出拒绝） | ✅ | 3261 ms | 7547 ms |
| password（Docker Debian OpenSSH） | ✅ | 1764 ms | 7770 ms |
| password + 断线重连 | ✅ | 2139 ms | 7260 ms |
| agent（隔离 ssh-agent） | ✅ | 1776 ms | 7292 ms |
| cert（CA 签名证书，sshd TrustedUserCAKeys） | ✅ | 1886 ms | 7158 ms |
| jump（跳板 sshd → 目标 sshd，direct-tcpip） | ✅ | 1831 ms | 10542 ms |

全部用例首次连接远低于 10 秒预算；每个用例包含 10 轮隔离会话、8 MiB 输出、97×31 resize 与前后端资源回收门禁。

**2026-08-28 CI 实机矩阵收口（Phase 6.21）**:

- real-machine 工作流首次 dispatch（run `33181335600`）暴露两处问题并已修复：GitHub macOS runner 无 Docker（password 用例 `spawn docker ENOENT`）；Linux runner 缺 `libudev-dev` 导致 `libudev-sys` 构建失败。
- 修复：矩阵 runner 增加逗号分隔用例过滤并补 `isDirectRun` 守卫（原先 import 即执行 `main()`）；password/password-reconnect 移至 Linux job 的 Debian OpenSSH 容器；Linux job 补装 `libudev-dev`/`pkg-config`。
- 修复后 run `33183284820` **全绿**：macOS runner（WKWebView）`key` 6955ms / `key-reconnect` 4211ms（11 sessions）/ `agent` 3221ms / `cert` 3481ms / `jump` 3592ms；Linux runner（Xvfb + Docker Debian OpenSSH）`password` 1048ms / `password-reconnect` 1047ms（11 sessions）。全部用例首次连接 < 10 秒门禁。
- [x] Linux runner 首次 dispatch `.github/workflows/real-machine-matrix.yml`（Xvfb + localhost OpenSSH + 容器 password 矩阵）。

**仍需外部验证**:

- [ ] Windows OpenSSH 服务 / Pageant / 本地 PTY / 串口硬件按 Issue #21/#22/#39 人工清单。

**2026-10-11 历史工作树复跑**：macOS 15.7.7 arm64、Node 24.16.0、Docker 29.7.2 下十用例全绿；当前证据已在后续复测中更新为 13/13。普通产品冷启动 stopwatch、真人物理键盘/IME 和跨平台硬件仍不计入通过。

**2026-10-13 当前工作树复验（历史构建）**：instrumented debug binary `8f097da8…` 上本地 SSH matrix 为 12/12 全绿，覆盖 5 秒 outage 与 20 秒 host-wake outage；后者记录 `hostWakeSynthesized=true`、11 个唯一 session。`.github/workflows/real-machine-matrix.yml` 现将 macOS 的 10 个非 password case（含两种 outage）与 Linux 的 2 个 password case 分开执行，合计覆盖 12 个 case；修改后的 workflow 尚未重新 dispatch，不能将本地契约测试当作新的远端实机结果。当前证据见 `2026-10-11-macos-ssh-matrix-current.json`。

**shell 矩阵覆盖完整性修复**：Linux workflow 显式请求 bash、zsh、fish，但 runner 之前会把缺失 shell 静默跳过，导致不完整矩阵仍可成功退出。runner 现在在构建前对显式 shell 做 fail-closed 预检，Linux job 安装这三种 shell；Node 契约测试验证缺失 shell 会失败且 workflow 声明安装依赖。此为自动化契约修复，workflow 重新运行前不代表 Linux 实机矩阵已通过。

### Issue #58: 物理键盘资格门禁自动化 🟡 输入源与严格单次注入验收

**严重程度**: High
**状态**: ✅ 2026-09-22 最终源码构建下严格 30 轮 CGEvent 通过（ASCII，零重发）；🟡 人工物理键盘与 IME 仍待验收（2026-10-13 用户确认当前不方便敲键）
**发现/修复时间**: 2026-08-28

**问题**: Issue #26/#48 要求的「macOS WKWebView 多轮近同时物理 `a/s/d` 且不丢不重」只有手动页面，无法可重复执行与记录 expected/received hex。

**修复**:

- Rust `input_probe` 门控模块：`TERMINAL_INPUT_PROBE=1` 显式开启，checkpoint 与结果路径必须绝对，轮数 1..=100、期望文本 ≤32 字节无控制字符；`input_probe_ready`/`input_probe_result` 原子写入并严格校验每轮 hex 与 ok 标志。
- 前端 `automation-root`：真实本地 PTY 探针（`stty -echo` + `read` + `od` 回读字节），每轮进入 awaiting-input 即发布 checkpoint，完成后发布 `{ok, rounds, expectedHex, results[]}`。
- `scripts/run-input-probe.mjs`：CGEvent 重叠按键注入器（a↓ s↓ d↓ → 反向释放 → Return，20 ms 间隔）、`CGPreflightPostEventAccess` 权限检查、osascript 前置激活、manual 引导模式与 `--checkpoint-only`（无权限时验证应用侧协议）。
- Node 驱动 6 项单测覆盖 30 轮驱动、权限拒绝、manual 回退、早退与参数校验。

**2026-08-28 探针协议实机验证（Phase 6.21）**:

- 本机 debug App `pnpm smoke:input-probe -- --checkpoint-only` 通过：真实 WKWebView 中 `input_probe_ready` round=1 awaiting-input checkpoint 正常发布。
- GitHub macOS runner 同步骤通过（real-machine 工作流 run `33183284820`），证明探针协议在干净 WKWebView 环境可重复执行。

**验证边界**: CGEvent 注入需要宿主进程被授予「系统设置 → 隐私与安全性 → 辅助功能」。授权后 `pnpm smoke:input-probe` 自动执行 30 轮重叠 `a/s/d` 并记录 expected/received hex；未授权时提供 manual 引导模式由人类物理键入，结果同样落盘校验。合成 JS 事件与 `term.input()` 不视为物理键盘证据。

**2026-08-29 历史实机注入证据与阻塞条件**:

- 宿主 Terminal.app 已授予辅助功能权限；注入链路多次端到端验证通过：真实 WKWebView 内诊断通道（`input_probe_diag`）记录到完整的 `keydown a/s/d/Enter` 序列且 PTY `read` 回读 hex 一致（如 11:37 运行：4/4 keydown + round 推进；13:08 运行：3 轮完整注入）；13:27 之前的运行中应用侧一次完成全部 30 轮并发布 `ok=true`（受 result 契约 bug 影响未落盘，已修复）。
- 注入实现要点（全部已修复并回归）：`CGEvent` 必须使用 `nil` source + `postToPid`（`.hidSystemState` source 的跨进程事件在 macOS 15 会被丢弃）；注入前点击探针窗口中心使 WKWebView 窗口成为 key window；窗口获得焦点时重新 `term.focus()`；驱动对未推进轮次带焦点校验的安全重试；前端按每轮 hex 匹配计算 `ok` 并报告失配轮次。
- **当前阻塞条件（外部）**: 本机运行的另一个 GUI 自动化服务（`SkyComputerUseService`）持续保持 Chrome 前台并每 ~0.5s 干扰窗口焦点，导致探针窗口 key 状态振荡、System Events 偶发失败；同条件下应用内诊断显示事件送达但 IMK 桥接报 `IMKCFRunLoopWakeUpReliable` mach port 错误，输入被丢弃。该条件自 2026-08-29 13:00 起跨 6 轮复跑持续存在。
- **复跑路径**: 在无 GUI 自动化干扰时执行 `pnpm smoke:input-probe` 即可完成 30 轮无人值守验收；或使用 `--inject manual` 由人类键入 30 轮，驱动落盘校验每轮 expected/received hex。30 轮物理键入仍待执行。

**2026-09-22 定位与修复**:

- 9 月 6 日新增诊断显示：keydown 的 target/activeElement 均为 xterm helper textarea，但 `keyCode=229`，输入依次为 `insertCompositionText` / `insertFromComposition`；Enter 提交 `asd`（`onData hex=617364`），没有发送 shell 回车。这一证据不支持把该次超时归因于权限拒绝或 xterm 丢字符。9 月 22 日原生 TIS 查询确认当前输入源为 `com.tencent.inputmethod.wetype.pinyin`。
- Swift 驱动增加原生输入源查询与选择；默认 `current` 在非 ASCII 输入源下提前给出明确错误。`--input-source ascii` 临时选择启用的 ASCII 键盘布局，逐轮检查输入源，成功或失败都会恢复并校验原输入源；恢复失败不能返回通过。
- 临时切换 ABC 后的首次诊断运行完成 30 轮、每轮回读 `617364`，耗时 130915ms，但第 20 轮曾落到 BODY 并被旧驱动重发，**该次不计为无丢键验收通过**。探针现支持空白区域点击聚焦 xterm；驱动取消整轮自动重发，任一轮缺失即失败。
- 加固结果校验：顶层 `ok=true` 不能掩盖 `receivedHex` 不匹配或单轮 `ok=false`；应用提前退出时取消 checkpoint 轮询，避免退出后继续挂起 60 秒。上述缺陷均有先失败后通过的回归。
- 严格复跑命令：`pnpm smoke:input-probe -- --inject swift --input-source ascii`。该用例验证 ASCII 原生 CGEvent 重叠输入；中文 IME、Option/dead key 与人工物理键入保持独立验收。
- **最终实机结果**：macOS 15.7.7 arm64，Node 24.16.0，最终源码重建后二进制运行 30 轮，每轮只注入一次、全部 `receivedHex=617364`，退出码 0、总测试耗时 111547ms，原输入源恢复校验通过。此总耗时包含 30 轮驱动激活/点击/注入，不是首次连接耗时。[逐轮结果与二进制 SHA-256](verification/2026-09-22-macos-input-probe.json)。
- **最终自动化**：Node 24.16.0 下前端 lint/typecheck、104 文件/888 项测试、Team Server 103 项、Rust 181+3 项、生产构建预算、56 项 Node 脚本测试、511 文件源码规模与 `git diff --check` 通过。Node 26 下出现的 jsdom `localStorage` 清理差异不纳入项目支持环境；未改断言或放宽测试超时。

**2026-10-09 增量**:

- `@baicie/xterm@0.1.7` 的 `CompositionHelper` 在组合态收到 Escape 时现在只把事件交给原生 IME，不再把空组合或 `\x1b` 写入 PTY；组合结束后的普通 Escape 仍发送 `\x1b`。补丁脚本、锁文件 hash 与 xterm 回归测试同步更新，定向测试 8/8 通过。
- 输入探针诊断新增 `compositionstart/update/end` 与 `InputEvent.isComposing`。取消场景要求每轮存在空 `compositionend`、Escape 和后续一次提交，普通 IME 场景要求完整组合生命周期。
- Apple Pinyin `com.apple.inputmethod.SCIM.ITABC` 的 CGEvent 单轮复验仍只产生普通 `insertText`，没有原生 composition 事件，因此 `ime-commit`/`ime-enter`/`ime-cancel` 均保持失败；这证明自动注入器无法代替物理键盘触发 IMK，不能作为 IME 通过证据。需后续人工物理键盘复验。

**2026-10-13 工具链加固**：`--inject manual --scenario ime-*` 现在也会调用原生 TIS helper，要求当前输入源 `asciiCapable=false` 且类型为 `TISTypeKeyboardInputMethod` 或 `TISTypeKeyboardInputMode`；每轮核对输入源未被切换，结果同时记录 `inputSource` 与 `inputSourceInfo`（id/type/asciiCapable）。新增 ASCII 源拒绝和有效非 ASCII 源记录回归；这只是人工验收的前置资格门禁，不代表用户已完成中文 IME、Option/dead key 或 30 轮物理输入。

**2026-10-14 人工 overlap 入口加固**：`--inject manual --scenario overlap` 现在同样调用原生 TIS helper，要求当前输入源为 ASCII 后才进入人工轮次；指导文案明确要求近同时按下并保持 `a/s/d` 再释放，前端探针超时按轮数提供每轮 2 分钟预算加启动余量。Node 输入探针与场景契约测试 26/26 通过；真人物理键盘、IME composition、Option/dead key 仍未验收。

**2026-10-13 shell 交互探针扩展**（在真人敲键不可用期间提升自动化覆盖）：

- 新增 `vim-edit` case 时最初把编辑按键挂在 `step` 标记上，而 `step` 只有 vim 退出、shell 恢复后才可能打印，形成死锁：探针只能等到 30 秒超时。改为由 `ready` 驱动 `i` → 文本 → Escape → `:wq`，验证命令再打印 step 与 pass，实测 1932ms 通过。
- `ctrl-c-interrupt` 原先在阻塞 `sleep` 之后追加 FAIL 标记，但 bash 在前台 SIGINT 杀掉 `sleep` 后会继续执行 `;` 列表的剩余部分并打印 FAIL，zsh 则直接放弃整条列表，导致 bash 被误判为失败。移除尾部标记：中断送达则 `sleep` 死掉、pass 命令在提示符执行；中断被吞掉则 `sleep` 继续阻塞，探针在自身超时上失败。这使该 case 测量终端的中断投递，而不是各 shell 的列表语义。
- 后端 `shell_probe_result` 与 Node runner 现在都要求 `ctrl-c-interrupt` 的结果确实包含原始 `03` 字节，避免前端自证一个从未发生的交互。
- 新增 `nano-edit` case 时暴露了一个真实缺陷：`result.ts` 另有一份 case 白名单，新增 case 若只改 `protocol.ts`，配置会在进入 PTY 前就被拒绝，表现为静默超时而不是可读的错误。现在该列表改为导出 `SHELL_PROBE_CASES`，并有测试逐个断言解析器接受协议定义的每个 case。
- nano 的按键序列需要 Ctrl+O 写盘（直接 Ctrl+X 会丢弃编辑），并补一个 Ctrl+X 兜底，因为不同 nano 版本是否写盘后自行退出并不一致。
- 新增 `pty-resize` case 补上本地 PTY 的 resize 覆盖（此前只有 SSH smoke 覆盖远端 resize）：终端依次 resize 到 132x43、90x30、120x40、97x31，每一档都用 `stty size` 独立回读真实 PTY 几何，最后一档不符即失败。resize 观测使用独立前缀而非 trace marker，否则解析器会在序列结束前提前消费掉 `step`。
- macOS 15.7.7 arm64 上以同一 debug 二进制 `16f5b93b…` 复跑：shell 交互七个 case 在 bash 与 zsh 上 14/14 全绿（zsh：310/227/405/1942/4611/1351/1006ms），`smoke:ssh-matrix` 12/12 全绿，本地冷启动 4705/3872/3621ms，远程 SSH prompt marker 1651ms，全部低于 10 秒。
- 复审哈希一度在两处各存一份：`scripts/check-verification-evidence.test.mjs` 自己硬编码了 debug 审阅哈希，于是每次复核后移动白名单都会让门禁自己的测试失败——一个「防止你引用过期测量」的机制，反过来在每次正确复核后报红。新增 `reviewedHashForProfile()` 导出，测试从门禁读取同一个值，白名单重新成为唯一来源。
- **shell 交互此前只在本地 PTY 上验证过**。SSH 矩阵覆盖的是吞吐、Unicode、resize 与重连，从未在真实 SSH 会话上跑过行编辑与 Ctrl+C——而 PTY 请求、窗口尺寸传播和信号投递恰恰是 PTY 与 SSH channel 差异最大的地方。给 shell 探针加了 `--transport ssh`：它复用 smoke 矩阵同一个 loopback sshd fixture 与同一份 Rust 配置校验，而不是另写一个假服务器，因为这些 case 要证明的正是真实 server 行为。
- 前端最初为 SSH 目标手写了一份校验，结果与 Rust 侧规则漂移（漏了 key 模式禁止 certificate）。改为直接复用 `parseTerminalSmokeSshConfig`：一处规则、一个来源，顺带把探针 bundle 压回预算内（首次实现超出 gzip 预算 0.04 KB）。
- `--transport ssh` 明确拒绝与 `--shells` 组合：SSH 的登录 shell 属于 fixture 而非本进程，强行指定只会把测量结果标错传输。
- macOS 15.7.7 arm64 上以同一 debug 二进制 `c04caea6…` 复跑：本地 14/14（bash+zsh 七 case）、真实 SSH 7/7、`smoke:ssh-matrix` 12/12 全绿，本地冷启动 3640/3228/3401ms，远程 SSH prompt marker 1683ms，全部低于 10 秒。
- 这些输入仍由 `term.input()` 注入，**不构成**物理键盘、中文 IME composition 或 Option/dead key 的验收证据。

### Issue #59: SSH 建链关闭竞态与迟到会话 ✅ 已修复

**严重程度**: Important
**状态**: ✅ 已修复并完成自动化回归；跨平台行为仍纳入 Issue #39 实机矩阵
**修复时间**: 2026-09-06

**问题**：连接中的标签页关闭、断开或快速重连时，旧的 TCP/KEX/认证 future 可能继续运行到超时；即使前端 generation 已退休，也可能在后台占用连接资源。

**修复**：

- Rust 为每次远程建链注册 process-local attempt，新增 `session_cancel_connection` 命令和 `tokio::select!` 取消外层 future；password/key/agent/cert/Jump 共用该路径。
- 前端在第一次事件监听注册等待前就为 remote tab 生成不含凭证的 attempt ID；关闭、断开、I/O 错误及 generation retirement 会立即发出 best-effort cancel，监听注册完成后再次检查 record/generation，迟到 session 不发布 connected/output。
- cancel 先于 create 到达时使用有界 tombstone 传递取消意图；重复取消幂等，registry 不会因未知 ID 无限增长。
- Rust 增加 `ConnectionPublicationGuard`：pool 发布后到 reader task 接管前，取消会关闭 transport 并异步释放 pool/registry；新增发布中途取消与 commit 保持资源的回归测试。前端新增监听注册挂起时关闭标签的回归测试。

**验证**：Node 24.16.0 下当前定向与全量门禁通过；本轮新增启动恢复有界重试、并发加载取消保护、生命周期、远程 prompt marker、shell 交互、连续 resize 与 real-machine workflow 契约定向门禁通过。旧的十用例记录属于历史构建；当前工作树 SSH 证据为 13/13，macOS real-machine job 已追加远程 prompt cold-start 步骤但尚未由新的远端 workflow run 验证；真实 Windows/Pageant/PTY/串口和 macOS 物理键盘仍未宣称通过。

**2026-10-10 建链发布窗口增量**：新增 `ConnectionPublicationGuard` 覆盖 `pool.insert` 到 reader task 接管之间的取消窗口；guard 回滚时关闭 TCP transport 并异步释放 pool/registry key，reader handoff 完成后显式 commit。新增取消回滚与正常 commit 回归测试；Rust library 181 项、clippy `-D warnings` 与格式检查通过。

**2026-10-10 前端会话生命周期增量**：关闭 tab 时现在等待该 record 上所有重叠的 session start promise 和 reconnect promise 完成，再执行最终 backend close；迟到的 session 仍按 generation/closed 守卫拒绝发布。生命周期缓冲溢出不再把全局错误状态带给后续 session，而是只标记本次受影响的 session；管理器只处理能映射到受影响 session 的错误，实际 session 在 `take()` 时消费 overflow 标记，避免并行 connecting 标签被误杀。新增双 connecting record 回归，确认受影响标签进入 error、无关标签仍可 connected；对应 manager、lifecycle buffer 和 workspace/start 竞态回归已加入现有前端门禁。该修复未替代真实 Windows/Linux PTY、串口或人工输入验收。

**2026-10-11 runner 清理增量**：raw-input 探针在应用错误退出、结果解析失败或超时后都会取消结果文件轮询，并在传播原始错误前清理临时目录；SSH smoke 的 agent/jump fixture 在部分初始化失败时立即停止已启动的 daemon。新增 Node 回归覆盖应用 error、agent setup 和 jump setup 失败路径。

**2026-10-11 本地 PTY reader 生命周期增量**：reader loop 不再在 `select!` 中丢弃临时 `spawn_blocking(read)` 句柄；当前 blocking read 会在 shutdown 或 output pump 退出时保留并在有界 deadline 内等待，超时只 detach 已启动的 blocking task，避免 `abort` 后再次无限等待。reaper 超时在 Unix 通过 `MasterPty::process_group_leader()` 强杀前台进程组，覆盖忽略 `SIGHUP` 的 shell/子进程；Windows 保持现有终止路径。新增永久阻塞 reader 与真实忽略 `SIGHUP` PTY shell 回归，local session 测试 8/8、Rust Clippy `-D warnings` 通过。

### Issue #63: workspace recovery 瞬时失败后的有限重试 ✅ 已修复

**严重程度**：Important
**状态**：✅ 已修复并完成前端回归；数据库长期不可用和发布构建人工观测仍待验证
**修复时间**：2026-10-11

**问题**：启动时 SQLite/workspace recovery 可能因瞬时数据库或初始化竞态 reject。此前 App 只记录错误，后续恢复不会再尝试；用户虽然仍可获得 2 秒本地 fallback，但已保存布局可能丢失本次启动恢复机会。

**修复与验证**：

- `App` 在首次失败后按 1/2/4 秒延迟进行最多三次重试，总尝试次数有界；成功后清除待执行计时器。
- 重试与 2 秒本地终端 fallback 解耦，不会为了等待数据库而延迟可输入终端；组件卸载清理重试计时器，卸载后到达的 recovery handle 立即 dispose。
- `startWorkspaceRecovery` 等待失败尝试的并发 host 查询收尾，并支持 `AbortSignal`；host/workspace store 以代际和 signal 保护迟到查询，避免重试或卸载后的状态回写。
- App、workspace recovery/store 定向测试 32/32 通过；前端全量 109 个测试文件、925 项测试通过。

**边界**：长期数据库故障仍会在有限重试后记录错误并保留本地终端；如果数据库恰好在最后一次重试之后才恢复，本次启动不会再建立 workspace recovery 订阅，窗口内新增布局可能要到下次启动才恢复。该自动化修复不替代真实发布构建、macOS 物理键盘/IME 或 Windows/Linux/Pageant/串口实机验收。

串口 session 是进程内资源，关闭后旧 `serialSessionId` 不可恢复；最近关闭列表现在跳过串口标签，避免“重开后先显示 connected、首次写入才失败”的伪连接状态。串口重新打开仍需从设备选择流程创建新 session，真实设备验证保持在 Issue #22/#39 矩阵。

### Issue #70: 证据失真——smoke 构建被当成发布产物引用 ✅ 已修复

**严重程度**：Important（证据可信度）
**状态**：✅ 已修复并纠正错误结论
**修复时间**：2026-10-11

**问题**：Phase 6.40 引入 `--reuse-binary` 后，我得出结论「冷启动与 SSH 矩阵证据同源，因为共用同一个 sha256」。这个结论是错的。

矩阵构建时带 `VITE_TERMINAL_SMOKE_BUILD=1`，冷启动用的是普通 `pnpm tauri build`。前者把 smoke/probe 入口与 experiments 导航项编译进前端，**是比用户实际拿到的包体更大的另一个产物**。共用 sha256 只能证明「同一个二进制被测了两次」，不能证明「它是发布产物」。我把测试专用构建的启动时间当作发布产物的启动时间报了出来。

**放大问题**：普通构建的二进制没有 smoke 入口，`--reuse-binary` 却会直接拿它跑矩阵，十个 case 逐个以 `Terminal smoke UI is not included in this build` 失败。没有任何检查拦住这种误用，失败信息也完全指不到真正的原因。

**修复与验证**：

- 新增 `assertSmokeInstrumentedBinary()`，通过内嵌资源文件名列表判定产物类型，普通构建立即以准确诊断失败。之所以用资源名而非守卫字符串判定，是因为两种构建都含 `Terminal smoke UI is not included in this build` 这段文本。
- 矩阵在 `--reuse-binary` 时先验明产物类型并打印依据；新增 3 项测试。
- 证据文件显式标注 `smokeInstrumented: true`、列出内嵌 chunk 名，并说明这是偏保守的上界；另附同一源码纯 shipping 构建的对照值，两者落在噪声范围内。
- 全部证据在单一 instrumented 二进制上重测：本地 3134–3432ms、远程 1511ms、SSH 矩阵 8/8 全绿。

**教训**：我为了解决「证据文件描述不同二进制」而引入了 `--reuse-binary`，却没有追问构建参数是否一致——用一个新工具制造了一个更隐蔽的证据问题。相同哈希是最容易被当作充分证据的信号，因此必须同时确认两份记录的**构建方式**一致，而不只是产物一致。

**未复验项（已解除）**：`password` 与 `password-reconnect` 两 case 曾因 fixture 需要构建 Debian sshd 镜像而未复验。该阻塞的根因不是环境，而是 fixture 无条件 `docker build` 加超时后永不 settle 的实现缺陷，已在 Issue #71 修复，两 case 现已在 release 与 debug 上均通过。

### Issue #69: 重连期间输入处理的非对称性是有意设计 📋 已记录，非缺陷

**严重程度**：Informational
**状态**：✅ 行为正确；此前缺少说明，已补入代码与测试注释
**记录时间**：2026-10-11

**观察**：`TerminalSessionIo.prepareForAutomaticReconnect()` 把 IO 置为 `disconnected`（`write()` 直接拒绝），而 `prepareForReconnect()`（手动路径）置为 `connecting`（缓冲输入）。两条路径对「用户在重连期间敲的键」处理不同，看起来像漂移。

**结论：这是有意且必要的设计，不是缺陷。**

- **自动重连**是系统自行发起的，界面只显示一个可见的倒计时。用户在这个窗口里敲的内容，是冲着**上一个会话所显示的提示符**输入的——可能是 sudo 密码、可能是破坏性命令、可能是半行字。把它重放进一个全新的 shell，可能在不同的机器状态下执行用户根本无意执行的操作。丢弃是安全的选择。
- **手动重连**是用户主动重试同一件事，他明确期待自己的按键落在那里，所以缓冲下来。

**为什么值得记录**：这个非对称性看起来像不一致，因此很可能被后续改动「顺手统一」掉，而统一的方向恰好是危险的那个。此前只有一条测试断言了自动路径会丢弃输入，却没有说明理由；缺失的理由正是它看起来像 bug 的原因。

**已做**：在 `terminal-session-manager-reconnect.test.ts` 与 `terminal-session-io.test.ts` 中为两条路径各自补上说明理由的测试与注释。`terminal-session-io.test.ts` 新增一项，同时锁定两个方向：自动路径不得重放旧输入，手动路径必须送达输入。两条路径的行为此后都无法在无意识中被改动。

### Issue #68: 输出溢出后自动重连静默丢弃全部输出 ✅ 已修复

**严重程度**：Critical
**状态**：✅ 已修复并完成前端回归；真实高输出场景的实机确认仍待进行
**修复时间**：2026-10-11

**问题**：`TerminalOutputScheduler` 在溢出时进入 `failed` 状态并闩住，此后 `enqueue` 对所有数据直接返回 `false`——静默丢弃，不报错、不提示。能复活它的 `reset()` 只在 `useTerminal` 暴露的手动 `reconnect()` 中调用；自动重连走完全不同的路径，从不调用 `reset()`。

**后果**：输出队列溢出后，自动重连会成功恢复 SSH 会话，面板显示 connected，但调度器仍处于 failed，**新会话发送的每一个字节都被丢弃**。用户看到的是一个「健康连接」下完全冻结的终端：没有输出、没有错误提示、没有任何信号要求其介入。这比报错更糟，因为界面明确声称一切正常。

**修复与验证**：

- `onState` 中当 snapshot 带来 sessionId 且调度器确实处于 `failed` 时调用 `reset()`。有 sessionId 意味着后端确有活会话，输出通路随之恢复。
- 条件刻意收窄：`reset()` 会清空待处理队列，若每次 connect 都调用会丢弃后端已交付的输出，因此仅在 `state === 'failed'` 时触发，并为「健康会话连接时不得 reset」补了守卫测试。
- 区分力验证：条件改为恒假后新测试确实变红，恢复后通过；容器与服务层 266 项一并通过。

**边界**：真实高输出场景（大量日志、`yes`、编译输出）下的实机确认仍需进行；不替代 macOS 物理键盘/IME 或 Windows/Linux/Pageant/串口实机矩阵。

### Issue #67: 输出溢出文案永久遮蔽后续会话状态 ✅ 已修复

**严重程度**：Important
**状态**：✅ 已修复并完成前端回归；真实高输出场景的实机确认仍待进行
**修复时间**：2026-10-11

**问题**：`useTerminal` 的 `onState` 用 `outputErrorRef.current ?? snapshot.error` 决定面板显示的错误文案。`outputErrorRef` 一旦被 `TerminalOutputScheduler` 的 `onOverflow` 写入，就再也没有被清空过——只有用户手动调用 reconnect 时才会重置。而溢出本身会立即 disconnect 该 binding，因此从那一刻起的每一个 snapshot 都会被替换成那条陈旧的「terminal output queue exceeded」。实测序列：输出溢出 → 会话以 `network unavailable` 失败 → 会话恢复成功，面板三次显示的都是过期溢出文案。

**后果**：

- 会话确实已经恢复，用户仍看到一个永久错误，无法判断是否还该重试或是否问题已自行解决。
- 之后真的再次失败（例如网络中断）时，真正需要用户采取行动的诊断被过期文案完全遮住，用户只会重复处理一个早已结束的队列溢出。

**修复与验证**：

- 当 snapshot 自带错误时以它为准，并清掉记住的溢出文案。溢出会立刻 disconnect，因此「之后的 snapshot」必然描述的是另一件事，旧文案不再适用；只有 snapshot 没有错误时，才继续用记住的溢出理由解释这次断开。
- 新增 `use-terminal-error-recovery.test.tsx` 覆盖完整序列；把该优先判断改为恒假后测试确实变红，恢复后通过。
- 顺带补上 `terminal-session-state.test.ts`（4 项），覆盖重连状态收敛点此前无测试保护的不变量。

**边界**：本项为前端状态呈现修复。真实高输出场景（大量日志、`yes`、编译输出）下的重连体验仍需 macOS 实机确认；不替代物理键盘/IME 或跨平台实机矩阵。

### Issue #66: 证据门禁对缺失的 current 证据 fail-open ✅ 已修复

**严重程度**：Important
**状态**：✅ 已修复并完成门禁回归
**修复时间**：2026-10-11

**问题**：`checkVerificationEvidence` 用 `present.includes(file)` 把 `EVIDENCE_PROFILE` 注册表过滤成「恰好存在于磁盘上的文件」。任何被注册为 current 的证据一旦从磁盘消失，就会被静默跳过——门禁依然通过，只是覆盖面变小。一个审阅者看到绿色的门禁，无法知道 release 二进制的证明已经被移除。这与该门禁存在的目的（防止陈旧证据静默通过）直接冲突。

**修复与验证**：

- 注册表中缺失的文件现在明确报错，并提示应当恢复它们或从 `EVIDENCE_PROFILE` 显式移除，而不是让门禁悄悄少检查一部分。缺失项不参与读取与哈希比对。
- 测试夹具此前只提供测试自己写入的文件，其余注册文件读取时抛 ENOENT 被当作 unparsable，会淹没针对其他问题的断言。夹具重改为默认补齐全部注册文件并按 profile 提供合法默认哈希，另加 `omit` 选项供「缺失」场景显式使用。
- 顺带修正三处因此暴露的失效断言：`checked` 计数从写死的 1/4 改为按注册表实际数量断言；陈旧哈希场景补齐第二份 release 文件，避免制造出假的跨文件冲突。
- 区分力验证：把 `2026-10-11-macos-release-ssh-matrix.json` 移出磁盘后门禁立即失败并指名该文件，恢复后 6 份证据通过。门禁测试从 12 项增至 13 项。

**遗留**：`docs/verification/` 目前仍未纳入 git 版本控制，因此证据无法随 clone 存活，也无法被代码评审审阅。这一项需要提交权限才能解决。

### Issue #65: 唤醒为健康 connected 会话留下永久 arming ✅ 已修复

**严重程度**：Important
**状态**：✅ 已修复并完成前端回归；真实合盖/唤醒实机观测仍待进行
**修复时间**：2026-10-11

**问题**：Issue #64 在 `startTerminalSession` 的 `finally` 里清除 arming，只解决了「建链成功或失败都会清除」。但唤醒扫描本身是过宽的：`TerminalSessionManager.handleHostWake` 对每个 record 先尝试 `resume`，不满足条件就直接 `armAfterWake`。一个已经 `connected` 的健康远端会话不是 retryable error，`resume` 返回 false，于是被 arm——而它没有任何在飞的建链，那个 `finally` 永远不会为它执行，标记永久滞留。该会话此后任意一次普通断线都会命中 `consumeWakeArming()`，被误判为「唤醒后失败」并白拿一轮自动重试预算，掩盖真实失败原因。

**修复与验证**：

- `armAfterWake` 增加状态守卫，只 arm `connecting` 与 `reconnecting`，即真正有尝试在飞的两种状态；这同时把 arming 的作用域收窄到它真正要表达的语义。
- 新增 2 项单元测试（健康会话不可被 arm；只有 connecting/reconnecting 被 arm）与 1 项 manager 顺序测试（唤醒健康会话 → 随后普通 `ssh-close`，`maxAttempts: 1` 下不得出现第 3 次建链）。
- 移除守卫后这 3 项同时变红（3 failed / 19 passed），恢复后 22/22 通过，证明测试有区分力。

**边界**：本项为纯前端生命周期修复。真实合盖休眠/唤醒、唤醒后首字节延迟、VPN/蜂窝切换后的会话恢复仍需 macOS 实机观测；不替代 macOS 物理键盘/IME 或 Windows/Linux/Pageant/串口实机矩阵。

### Issue #64: 唤醒 arming 标记泄漏到后续无关连接 ✅ 已修复

**严重程度**：Important
**状态**：✅ 已修复并完成前端回归；真实合盖/唤醒实机观测仍待进行
**修复时间**：2026-10-11

**问题**：为解决「合盖唤醒时仍在建链的会话随后失败、无 sessionId 因而永不重连」而加入的 `TerminalSessionWakeRecovery.armAfterWake()`，其标记原本只在 `startTerminalSession` 的 catch 分支被消费。若唤醒那一刻在建的连接**随后成功**，`finally` 并不清除该标记，它会永久留在 `WeakSet` 中。此后任意一次与唤醒无关的建链失败都会命中 `consumeWakeArming()` 返回 true，白白多拿一轮自动重试预算——既掩盖真实失败原因，也让「重试次数」这一可观测语义失真。

**修复与验证**：

- 在 `startTerminalSession` 的 `finally` 中无条件调用 `clearWakeArming(record)`，使 arming 的生命周期严格等于单次建链尝试；失败路径「消费标记后立即恢复预算」的行为保持不变。
- 修正了一条自我欺骗的测试：原 manager 用例「唤醒装弹 → 建链成功」**没有区分力**（成功路径本来也只连接一次），已删除并改写为真正的顺序场景——唤醒装弹 → 建链成功 → 随后普通 `ssh-close` 断线，在 `maxAttempts: 1` 下若标记泄漏必然出现第 3 次建链。
- 实际停用 `finally` 清除确认新用例变红（1 failed / 18 passed），恢复实现后 19/19 通过，证明测试有区分力。`TerminalSessionWakeRecovery` 单元测试同时直接断言成功 attempt 后 arming 不可再消费。

**边界**：本项为纯前端生命周期修复。真实合盖休眠/唤醒、唤醒后首字节延迟、VPN/蜂窝切换后的会话恢复仍需 macOS 实机观测；不替代 macOS 物理键盘/IME 或 Windows/Linux/Pageant/串口实机矩阵。

### Issue #60: xterm 输入协议真实 Tauri/PTY 回读 ✅ 三个协议 case 已通过，人工交互仍待验收

**严重程度**: Important
**状态**: ✅ macOS 三个 Tauri/WKWebView/PTY case 已取得真实结果；人工交互仍待验收
**发现/修复时间**: 2026-10-10

**问题**:

- 事件级 jsdom 回归只能证明兼容版 xterm 到前端 `registerTerminalInput` 的编码边界，不能证明真实 WebView 事件、Tauri IPC、PTY 回读或高位非 UTF-8 输入。

**修复与验证**:

- 新增独立 `TERMINAL_RAW_INPUT_PROBE=1` gate、严格 case/hex 结果契约和原子 JSON 发布；普通产品启动不加载该模式。
- `smoke:raw-input` 仅在 macOS 启动 debug Tauri binary，并让真实 local PTY 通过 shell `dd | od` 回读精确字节；三个 case 分别覆盖 SGR mouse、DECSET 2004 bracketed paste、X10/default mouse 高位坐标 raw bytes。
- 前端 protocol/bootstrap 11 项、Node runner 4 项、Rust state 2 项定向回归通过；Node runner 在结果到达后清理计时器并提供 SIGKILL 兜底。

**当前边界**:

- ✅ 修复 raw probe shell marker 顺序，并关闭 probe PTY 的 `icrnl`/`inlcr`/`igncr` 后，2026-10-10 当前 debug binary 的 `sgr-mouse`、`bracketed-paste`、`raw-x10` 三 case 均真实回读精确字节；Node 24.16.0 下耗时分别为 525ms、350ms、367ms，完整证据见 [`2026-10-10-macos-raw-input.json`](verification/2026-10-10-macos-raw-input.json)。此前锁屏超时记录保留为失败边界。
- ⚠️ 该探针仍不替代人工物理鼠标/系统粘贴、中文 IME、Option/dead key、连续 resize 或 Windows/Pageant/PTY/串口实机矩阵。

### Issue #61: System Events AX 子树读取不稳定 ✅ 已由原生 helper 收口

**严重程度**: Important
**状态**: ✅ 默认 native helper 已接入；当前工作树 macOS debug bundle 的严格 `spawn → AX readiness` 已取得 4341–4650ms
**发现/修复时间**: 2026-10-10

**问题**:

- `osascript`/System Events 对 Tauri WKWebView 的窗口顺序、role description 和深层 AX 子树暴露不稳定；同一应用可能有空 dialog 与实际 standard window，导致探针只检查错误窗口或读到空文本。

**修复与验证**:

- 新增 `scripts/macos-ax-probe.swift`，使用 ApplicationServices `AXUIElementCreateApplication` 按 PID 遍历所有窗口及有限深度子树，输出既有四位 readiness 协议；在被测应用启动前由 `run-cold-start-stopwatch.mjs` 编译到隔离临时目录，不把编译耗时计入 `spawnToReadyMs`。
- `smoke:cold-start` 默认使用 native helper；`--ax-probe osascript` 仅保留为显式诊断 fallback。helper 编译失败、AX 输出非法、应用提前退出或超时均 fail-closed。
- Node 24.16.0 下 cold-start 脚本 11 项回归通过，Swift 6.1.2 / macOS 15.7.7 arm64 原生 helper 可编译；当前工作树 debug binary 的 Local/Connected/Terminal input readiness 四次为 4716/4649/4537/4566ms，完整记录见 [`2026-10-11-macos-cold-start-current.json`](verification/2026-10-11-macos-cold-start-current.json)。

**2026-10-11 空白窗口误判修复**：排查一次 readiness 全 0 的失败时确认，根因不是产品回归，而是**由裸 `cargo build` 产出**的 debug 二进制从 `tauri.conf.json` 的 `build.devUrl` 加载前端；Vite dev server 停止时 WebView 打开的是空白页，探针会白等满 10 秒才 fail-closed，并把环境前提伪装成产品失败。最初修复方案是在启动应用前读取 `tauri.conf.json` 探测 `devUrl` 可达性，不可达就 fail-closed。

该 preflight 后续被**推翻并删除**，因为它基于错误前提：`pnpm tauri build --debug` 产出的 debug 二进制前端同样已内嵌（CI 走的正是这条路径），但按 `devUrl` 判断的 preflight 会把它一并拦下；反过来内嵌了前端的 release 二进制在无 dev server 时本可正常测量。构建 profile 无法从二进制内容可靠推断（`devUrl` 同样出现在 release 的 CSP 中），而任何基于配置的猜测都会误伤 CI 或真实用户路径。

现行方案不做任何前置探测，只在 readiness 真的超时后根据观测事实给出可操作诊断：窗口从未暴露任何 readiness 条件时说明「UI 根本没渲染」，并提示若该二进制来自 `cargo build` 需要先运行 `pnpm dev:frontend`；只要观测到任一 readiness 条件就不归因于未渲染 UI。`--skip-dev-server-check` 与对应透传一并移除，`tauri build --debug` / release 二进制在无 Vite 时均可正常测量。新增 3 项 Node 回归覆盖全 0 归因、部分条件不归因与远程 runner 不再透传该开关。

**2026-10-11 release bundle 首次终端测量**：此前所有 10 秒门禁证据都跑在裸 `cargo build` 产出的 debug 二进制上（该二进制依赖运行中的 Vite dev server），不代表真实用户路径。`pnpm tauri build --no-bundle` 产出的 release bundle 内嵌前端、无需任何开发服务器即可启动，是这条门禁最具代表性的测量对象。实测本地冷启动 `spawn → AX readiness` 为 **4570ms**，远程 `spawn → OSC 133 prompt round-trip` 为 **1551ms**，两者都远低于 10 秒预算，且 remote 用例中 AX 直接观测到 `connected` 与 `terminalInput`。证据见 [`2026-10-11-macos-release-cold-start.json`](verification/2026-10-11-macos-release-cold-start.json)。

**2026-10-11 release SSH 矩阵与 shell 交互**：`smoke:ssh-matrix` 与 `smoke:shell-probe:matrix` 此前硬编码 debug profile，所有认证/重连与日常交互证据都来自依赖开发服务器的二进制。现在两个 runner 都接受 `--release`，`buildFreshTauriBinary` 按 profile 选择构建参数并从 `target/release` 取二进制，默认行为不变。release 二进制上真实 SSH 十用例全绿（首次连接 894–1091ms，五种认证路径重连各 11 个唯一 session），shell 交互三 case 全绿（`cat-eof` 3797ms、`readline-history` 222ms、`readline-tab` 393ms），证据见 [`2026-10-11-macos-release-ssh-matrix.json`](verification/2026-10-11-macos-release-ssh-matrix.json)。

接入过程中发现两个 runner 共享同一个潜在缺陷：位置参数解析会把 `--release` 当成用例名而报「unknown case」。SSH matrix 按 `argv[2]` 取用例、shell matrix 只跳过 `--`，两者都会被任何新开关击穿。已改为先过滤 `--` 前缀选项再取位置参数，并补 2 项回归锁定该行为。

**证据二进制漂移**：release 冷启动与 release SSH 矩阵最初记录在两个不同二进制上（`3ef36d97…` 与 `7a7fc91e…`），因为两次 runner 调用之间 `pnpm smoke:*` 会重新链接 `target/release/terminal`。这意味着一份证据文件里的耗时可能在磁盘二进制被下次构建替换后才被引用，形成无法复现的对比。核对后发现冷启动数字确实测的是旧二进制，已在当前 release 二进制上重跑：本地 4570ms、远程 1551ms，与 SSH 矩阵现在共用同一哈希。旧数值与旧哈希保留在证据文件的 `superseded` 字段中，避免直接抹掉历史。任何引用 release 或 debug 耗时的结论都应先确认哈希与所引证据一致，不能只看磁盘上的当前哈希。

**证据一致性门禁**：上述漂移靠人工核对无法长期维持，因此新增 `scripts/check-verification-evidence.mjs` 并接入 `pnpm verify` 的 `source` 分组。它按 build profile 分组当前证据文件，要求同一 profile 内所有文件记录的 `sha256` 完全一致，并校验文件可解析且确实记录了哈希。历史证据文件不参与比较；当前四个 debug 场景在本轮复测后统一记录 binary `4368d6c8…`（源码指纹 `de8e49cb…`），门禁 pin 与证据保持一致。

同时让 runner 自己报告所测二进制：新增 `resolveBuiltBinary` 在构建后对即将启动的二进制取哈希，`smoke:ssh-matrix` 与 `smoke:shell-probe:matrix` 现在都会打印 `Measured <profile> binary <sha256>` 并把该值写入每条用例结果。这样证据里的哈希来自实际执行的二进制，而不是事后手工补录。

**剩余边界**:

- 普通远程 SSH 首个 prompt、物理键盘/IME 和跨平台硬件矩阵仍独立验收；此前锁屏失败记录只表示 System Events 环境边界，不覆盖 native helper 成功结果。

### Issue #75: 证据门禁无法发现「前端已改但 debug 证据未复测」 ✅ 已修复

**严重程度**: Minor（流程风险，非产品缺陷）
**状态**: ✅ 已修复

**问题**:

- 证据门禁对 **release** profile 会哈希磁盘上的 `target/release/terminal` 并要求证据与之匹配；但 **debug** profile 只比对 reviewed hash 常量，刻意不比对磁盘。原因是 `pnpm verify` 会跑 cargo，把 `target/debug/terminal` 重新链接成裸 cargo 产物（不含内嵌前端），因此 debug 磁盘哈希在门禁运行后必然与证据不符。
- 副作用是：改完前端却忘记重跑冷启动/矩阵证据时，门禁**不会**报错——证据内部自洽、pin 常量也没动，只有磁盘上的产物变了。本轮 Phase 6.49 改动了 `App.tsx` 与 `store/app.ts`（启动水合路径），就是这样被发现的：人工 `shasum` 发现磁盘已是 `e85d951c…`，而 pin 仍指向 `0320ce3b…`。
- release profile 不受影响，仍受磁盘比对保护。

**修复**:

- 新增 `computeSourceFingerprint()`：对验收场景实际触及的源码（`packages/frontend/src`、`src-tauri/src`、三个 package/lock 文件）做内容哈希。刻意排除 docs、证据文件与无关工具链——一个会因为改错别字就移动的指纹，只会训练人忽略这道门禁。内容哈希使其与 mtime、checkout 状态、换行符无关。
- 门禁新增比对项：debug 证据记录 `source.fingerprint`，与当前树不一致即失败，并给出可执行的诊断（`Re-run the scenario on the current sources`）。未记录指纹的历史文件不做该项检查，避免一刀切地否掉既有证据。
- 四份 debug 证据当前指纹为 `de8e49cb…`。

**验证**:

- 新增 2 项测试（指纹不匹配失败、匹配通过），还原实现前失败用例确实转 RED。门禁脚本测试 125 → 127。
- 端到端验证：向 `packages/frontend/src/store/app.ts` 追加一行注释，门禁立刻以 EXIT=1 报出 4 条 problem，指纹从 `23a7cca0…` 变为 `ad8cdc6f…`；恢复后重新通过。
- 负向验证：只改 `docs/todo.md` 时门禁保持通过，确认指纹对文档改动不敏感，不会产生噪声误报。

### Issue #74: 启动设置读取失败静默重置用户主题与语言 ✅ 已修复

**严重程度**: Important
**状态**: ✅ 已修复
**发现/修复时间**: 2026-10-11

**问题**:

- `hydrateFromDatabase()` 是主题、语言与全部持久化偏好的唯一来源，但它在 `catch` 后只调用 `console.error` 并静默返回 `void`。
- 数据库不可用或被占用时，应用外观完全正常，用户的设置却整体回落到默认值，界面上没有任何解释。用户看到的是「自己的设置莫名变了」，而不是一条可诊断的失败——这是本项目反复出现的静默失效形态（参见 Issue #67、#68、#70、#73）。

**同时确认无问题的路径**（避免把「存在静默 catch」误判为缺陷）：

- `startTerminalApp` 失败会渲染带重试的 `StartupError`，不静默。
- workspace recovery 有 `[1000, 2000, 4000]` 有界重试；即使彻底失败，`STARTUP_TERMINAL_FALLBACK_MS = 2000` 兜底仍会补一个本地终端标签，10 秒进入终端的目标不会被数据库故障击穿。
- `loadHosts` 对「非 Tauri 上下文」设 `dbAvailable:false` 但对真实 DB 错误重新抛出，交由 recovery 处理，语义正确。

**修复与验证**:

- `hydrateFromDatabase()` 改为返回 `boolean`；`App.tsx` 在失败时 toast 显示 `startup.settingsRestoreFailed`，补齐 en/cn/fr 文案。仅返回布尔值不足以让用户知情，必须同时接上可见提示。
- 新增 `app-hydration.test.ts`（2 项），还原修复后失败用例确实转 RED。
- 连带发现 `App.test.tsx` 的 `useTranslation` mock 只返回 `i18n`，导致 8 个用例产生 unhandled rejection；这些用例本身「全部通过」，靠 vitest 的 `Errors` 计数与退出码才拦下。

### Issue #72: matrix runner 缺少 case 级超时，单个卡死会静默取消整轮验收 ✅ 已修复

**严重程度**: Important
**状态**: ✅ 已修复
**发现/修复时间**: 2026-10-11

**问题**:

- `run-terminal-smoke-matrix.mjs` 直接 `await runTerminalSmoke()`，没有任何外层时限。Issue #71 修掉的是「docker build 被杀后不 settle」这一个具体根因，但结构性风险仍在：只要未来任一 fixture、端口或子进程再次不 settle，该 case 之后的所有验收 case 都会被静默取消，整轮矩阵不产出任何结论。
- 对发布门禁而言，「静默不产出结论」比「明确报失败」更危险——它无法与「跑得太慢」区分，也不会让 CI 变红。

**修复与验证**:

- 抽出 `runMatrixCases()`，以 `Promise.race` 为每个 case 施加 300s 上限（约为实测最慢 case 8.4s 的 35 倍）。超时 case 记为失败并继续执行后续 case。
- 通过 `onProgress` 保持原有终端输出格式不变。
- 新增测试锁定「永不 settle 的 case 判失败且不阻塞后续 case」；旧实现下该用例会永久挂起。另以 100ms 预算实测超时路径返回预期诊断。
- 同源排查发现 `run-terminal-smoke.mjs` 的 `waitForClose` 存在相同的「只监听 `close`」模式，而该 runner 同样在超时后升级到 SIGKILL，存在同样的挂死路径，已一并修复并加测试。真实 `key` case 复跑确认改为在 `exit` 结算不影响 stdout 读取与判定结果。

**2026-10-13 取消清理增量**：此前的 `Promise.race` 只让矩阵 runner 停止等待超时 case；底层 Tauri app 与 SSH fixture 仍可能继续运行，与后续 case 重叠。现为每个 case 创建 `AbortController`，超时后向 `runTerminalSmoke` 传播取消信号；app 等待会发送 `SIGTERM`，3 秒后升级 `SIGKILL`，重连 checkpoint 轮询同步退出，fixture 清理完成或达到 5 秒有界宽限后才开始下一 case。新增回归覆盖「超时收到 abort、清理完成后才进入下一 case」「取消 app 后 fixture 仍被 stop」以及「fixture 启动晚到时仍会清理」；Node runner 定向测试 35 项全绿。

### Issue #73: listener 抛错可杀死重连重试循环并静默丢弃输出 ✅ 已修复

**严重程度**：Critical（会话生命周期）
**状态**：✅ 已修复
**修复时间**：2026-10-11

**问题**：`TerminalSessionAudience` 把 listener 回调（`onState` / `onOutput`）直接调用，没有任何异常隔离。两个后果：

1. **重连循环被杀死**。状态是在 `TerminalSessionReconnect.run()` 的 promise 链内部发布的，`launch()` 用 `void promise.finally()` 挂载且没有 catch。任一 listener 在 `reconnecting` 快照上抛错，异常一路冒泡使重试 promise reject，**整个 attempt 预算被放弃**：既不再重试，也不进入 error 状态，也没有 unhandled rejection 提示。面板永久停在 `reconnecting`，用户只能手动重连。
2. **输出静默丢弃**。drain 循环在交给 listener **之前**已把 chunk 从 buffer 中 shift 出来。listener 抛错会中止循环，那个 chunk 连同其后所有已缓冲 chunk 一起消失，无任何报错。

**修复与验证**：

- 新增 `notifyState()` 包裹 `onState`，按 listener 隔离异常；`onOutput` 同样包裹。抛错的 listener 保留其 delivery 记录，因此 detach 时仍按既有 reclaim 路径按序重投，不丢数据。
- 2 项新测试：`keeps the retry loop alive when one pane listener throws`、`keeps draining output when one listener throws`。逐个还原修复后确认二者均转 RED。

**过程中被证伪的假设（记录以免重犯）**：我最初还给 `launch()` 加了一层 `promise.catch` 兜底，并写了对应测试。该测试**无法转 RED**——核对后发现 `sleep`、`start`、`closeTerminalBackend` 三条路径都已被 `run()` 内部或自身 catch 覆盖，修复 audience 源头后那个 catch 已不可达。保留它等于提交一段测不到的死代码，与本项目「测试必须证明行为」的门禁相悖，因此**主动撤销**了该兜底与测试，只保留源头修复。

**范围说明**：本修复覆盖 listener 回调抛错这一类逃逸。listener 内部**返回 rejected promise**（非同步 throw）仍会形成 unhandled rejection，因为回调是同步消费的返回值、无人 await。当前所有 `onState` / `onOutput` 实现均为同步，尚未构成实际缺陷，但若将来引入异步 listener 需同步处理。

### Issue #71: 密码 fixture 强制重建镜像且被杀后永不 settle，导致两个 case 长期 notRun 且 runner 永久挂死 ✅ 已修复

**严重程度**: Important
**状态**: ✅ 已修复，SSH 认证矩阵达到 10/10 全绿
**发现/修复时间**: 2026-10-11

**问题**:

- `password` 与 `password-reconnect` 两个 matrix case 长期记录为 `notRun`，理由是「Docker 镜像源不可达」。该表述不准确：真实缺陷是 fixture 每次都无条件执行 `docker build`，而 build 必然重新解析 `FROM debian:bookworm-slim`，因此**即便本地已有完全可用的 `terminal-smoke-password-sshd:latest` 镜像也必然失败**。密码验收因此在离线或 registry 受限环境下被无谓阻断。
- `waitForClose` 只监听 child 的 `close` 事件。被 SIGKILL 的 `docker build` 会让 BuildKit 孙进程继续持有 stdio 管道，`close` 永不触发而 `exit` 已发出，导致整个 matrix runner 永久挂起。本轮稳定复现：cargo 与 docker build 均已退出、容器也不存在，Node 进程仍空转 6 分钟，主线程停在 `kevent`。
- 该 fixture 此前完全没有单元测试，是两个缺陷长期未被发现的原因。

**修复与验证**:

- 新增 `ensurePasswordSshdImage()`：先 `docker image inspect`，仅在镜像缺失时才 build。
- `waitForClose` 同时监听 `exit` 与 `close`，任一到达即 settle。
- 新增 `scripts/terminal-smoke-password-sshd.test.mjs`（3 项）并接入 `pnpm verify`；在旧实现下「被杀后仍会 settle」会永久挂起、「镜像存在时不重建」会因多余 build 调用失败。
- release 二进制 `ab209317…` 与 debug 二进制 `0320ce3b…` 上矩阵均 10/10 全绿，release 首次连接 881–1791ms。

**剩余边界**: 本机 Docker daemon 仍无法回源 registry（`docker pull` 超过 5 分钟无输出，宿主直连正常），因此 fixture 只在本地已有镜像时可靠；这属于环境限制，不影响当前验收结论。

### Issue #62: 日常 shell EOF、历史与 Tab 交互探针 ✅ macOS 自动化通过，人工/跨平台仍待验收

**严重程度**: Important
**状态**: ✅ 真实 Tauri/WKWebView + local PTY 的三 case 已通过；🟡 物理键盘、IME 与跨平台硬件仍待实机
**发现/修复时间**: 2026-10-11

**问题**:

- 既有 8 MiB smoke、raw-input 和远程 prompt marker 证明了输出、协议字节与建链路径，但没有覆盖日常 shell 的 canonical EOF、readline 历史回放或 Tab 补全。
- 初版 `cat-eof` 在 canonical PTY 中只发送未终止 payload 后单个 EOT；该语义可能只刷新待输入行，导致 `cat` 不结束并让 runner 超时。

**修复与验证**:

- 新增独立 `TERMINAL_SHELL_PROBE=1` gate、固定 `cat-eof`/`readline-history`/`readline-tab` case、严格 trace/input 结果契约和原子结果写入；默认产品启动不启用探针。
- `cat-eof` 改为先通过 xterm `term.input('cat-eof-probe\\r', true)` 提交 canonical 行，再在空读边界发送 EOT；shell 侧使用命令替换去除单个尾换行并精确比较 payload。
- `pnpm smoke:shell-probe:matrix -- cat-eof,readline-history,readline-tab` 在 macOS 15.7.7 arm64、Node 24.16.0、当前源码 fresh debug binary 上三 case 全绿：329ms、222ms、366ms，trace 分别为 `ready/pass`、`ready/step/pass`、`ready/step/pass`；当前完整记录见 [`2026-10-11-macos-shell-interaction-current.json`](verification/2026-10-11-macos-shell-interaction-current.json)，旧二进制历史记录见 [`2026-10-11-macos-shell-interaction-probe.json`](verification/2026-10-11-macos-shell-interaction-probe.json)。
- 定向 protocol、Node runner/matrix、Rust state 测试通过；输入均为 `term.input()` 自动输入，经 xterm `onData`、session FIFO 和 PTY 回读。

**验证边界**:

- 该探针不是人工物理键盘、系统粘贴或中文 IME 验收；Option/dead key、vim/nano、真实鼠标、Windows OpenSSH Agent/Pageant/PTY 与串口硬件继续保持待验证。

### Issue #76: 浏览器启动路径无条件调用 Tauri 远程 prompt IPC ✅ 已修复

**严重程度**: Important（开发预览启动可靠性）
**状态**: ✅ 已修复并完成前端回归；桌面端行为不变
**发现/修复时间**: 2026-10-13

**问题**：`terminal-bootstrap` 在启动时加载远程 prompt probe 配置。原实现无论运行环境都调用 `remote_prompt_probe_config`；普通浏览器预览没有 Tauri IPC，导致启动阶段抛错并进入 `StartupError`，即使终端本身并未失败。

**修复与验证**：

- `loadRemotePromptProbeConfig()` 先检测 Tauri runtime；浏览器环境返回 `null` 且不触发 IPC，桌面环境继续调用并复用严格配置解析。
- 新增回归覆盖非 Tauri 不调用 IPC、Tauri 正常加载，以及既有配置字段/控制字符校验；定向测试 4/4 通过，typecheck 通过。

**范围**：该修复只收口启动探针在非 Tauri 环境的降级路径，不把浏览器预览当作真实 Tauri/PTY/SSH 验收；物理键盘、中文 IME 与跨平台硬件矩阵仍按发布就绪矩阵待验证。

### Issue #65: 长中断后的 host wake 恢复 E2E ✅ 自动化矩阵通过，实机睡眠仍待验收

**状态**：✅ host-wake 控制通道、前端 retryable error 触发和默认长中断 runner 已完成；macOS 真实 SSH 矩阵 13/13 通过，其中 `key-outage-wake-reconnect` 持续不可达 20 秒后恢复，`hostWakeSynthesized=true`，生成 11 个唯一 session。真实合盖休眠/唤醒、VPN/蜂窝切换仍需 macOS 实机。

**验证（历史构建）**：instrumented debug binary `8f097da8…` 上，`pnpm smoke:ssh-matrix` 12/12 全绿；wake case 首次连接 1130ms、总耗时 29821ms，覆盖 20 秒 outage、重连阶梯、stale output 拒绝和资源回收。当前复验统一以 `4368d6c8…` 为准，历史自动化结果不能替代物理设备休眠和网络切换。

### Issue #77: 未激活 session 的 pending output 缓冲与 Linux 冷启动契约 ✅ 已修复

**严重程度**：Important（连接竞态与跨平台验收）
**状态**：✅ 已修复并通过 Node 24 门禁；真人键盘/Windows/串口仍待实机
**修复时间**：2026-10-13

**问题**：`TerminalSessionOutputBuffer` 原本只按单个 session 限制无 ACK 输出，迟到事件来自多个未知 session 时，pending map 没有全局 session 上限；连接竞态或反复重连可能让未知 session 数量无限增长。与此同时，Linux 远程 prompt runner 的测试契约已要求 XDG 配置目录和 `axProbe: none`，但实现仍只支持 macOS；real-machine workflow 也没有执行 Linux shell/prompt 矩阵。

**修复与验证**：

- 增加 1024 个 pending session 的全局上限，驱逐最旧且无后端 ACK 流控的 session；带 ACK 的输出不静默丢弃，仍由生命周期回收路径清理，避免伪造消费确认。
- 增加跨平台 `appConfigDirectory()`，按 macOS Application Support、Linux `XDG_CONFIG_HOME` 和 Windows `APPDATA` 选择 SQLite 配置目录；Linux marker-only 冷启动不编译或调用 AX helper，并明确返回 `axProbe: none`。
- real-machine workflow 新增 Linux bash/zsh/fish shell 交互矩阵与远程 SSH prompt marker 步骤；新增/修复的 Node 脚本契约与前端回归通过。
- 历史源码指纹 `9cb3125b…` 下完整 `pnpm verify` 通过（前端 963、Team Server 103、Rust 193+3、Node 140），仅用于记录当时门禁；当前证据以 `de8e49cb…` / `4368d6c8…` 及四份 current JSON 为准。

**剩余边界**：物理键盘 30 轮、中文 IME/Option/dead key/vim/nano、真实合盖唤醒/VPN/蜂窝切换、Windows OpenSSH Agent/Pageant/ConPTY 和串口硬件仍没有设备，不能宣称通过。

### Issue #79: 应用退出期间迟到 session 重新登记 ✅ 已修复

**严重程度**：Important（应用退出与会话生命周期）
**状态**：✅ 已修复并通过 Rust 回归；真实桌面退出仍随发布矩阵验收
**发现/修复时间**：2026-10-13

**问题**：应用退出时 `SessionManager::close_all()` 只清理当时已经登记的 session。SSH 建链命令在握手完成后才登记；如果它与退出清理交错，迟到 session 可能在 registry 已 drain 后重新发布，留下 transport、channel 和 meta 资源，前端也会收到一个已关闭窗口上的 connected 结果。未登记的 SSH handshake 也不会被 `close_all()` 发现。

**修复与验证**：

- `SessionManager` 增加与注册共用的关闭 gate；关闭开始后拒绝并立即关闭迟到 session，命令层将拒绝映射为 `connection_cancelled`。
- 退出清理先取消所有 process-local SSH connection attempts，再并行关闭已登记 Session 与其他后端资源。
- Rust 回归覆盖 shutdown 后迟到注册必须关闭且不留下 session/meta/channel，以及全量取消活动 handshake；定向 Rust 测试通过。

**剩余边界**：该修复保证应用内退出顺序与资源回收，不替代 macOS 合盖唤醒、VPN/蜂窝切换和 Windows/Linux 实机退出矩阵。

### Issue #80: 长时间网络黑洞耗尽自动重试后不会自行恢复 ✅ 已修复

**严重程度**：Important
**状态**：✅ 已修复并完成前端回归；真实 VPN/路由切换仍待 macOS 实机
**修复时间**：2026-10-13

**问题**：远端 SSH 断线后的指数重试预算耗尽后，会话进入 `status=error, retryable=true`。前台窗口保持可见、系统仍报告 online 的网络黑洞（例如 VPN 路由或 NAT 暂时失效）不会产生 `visibilitychange`、`focus` 或 `online` 事件，因此会话会一直等待用户发现错误并点击 Retry。

**修复方案与验证**：

- 自动重试耗尽后安排 30 秒冷却重试；成功连接、手动 Retry、主动断开、关闭标签和唤醒恢复都会清除旧计时器。
- UI 将该状态显示为“等待自动重试”，并说明自动周期及立即 Retry/Disconnect 操作；不可重试的认证/主机密钥错误保持原有硬失败语义。
- reconnect、wake 和 header 定向回归 40/40 通过，TypeScript typecheck 通过；仍需真实 VPN、蜂窝和路由黑洞实机验证。

### Issue #81: 显式关闭中的 session 可能被 shutdown 提前漏掉 ✅ 已修复

**严重程度**：Important（应用退出与会话生命周期）
**状态**：✅ 已修复并通过 Rust 回归；真实窗口退出仍需发布矩阵验收
**修复时间**：2026-10-13

**问题**：`remove_session()` 先从 session/channel/metadata registry 移除条目，再异步执行 `session.close()`。如果应用退出同时进入 `shutdown()`，全局清理只能看到空 registry，可能在显式 close 的 PTY/SSH 资源释放前返回。

**修复与验证**：

- `remove_session()` 在 registry 摘除和 `session.close()` 全过程持有与注册/shutdown 共用的 lifecycle gate；shutdown 必须等待该 close 完成。
- 回归测试使用阻塞 close 和 10ms 有界 timeout，证明 shutdown 在 close 放行前不会提前完成；释放后两条任务均正常结束。
- Rust 全量 198 单测 + 3 集成测试、Clippy `-D warnings`、fmt 通过；应用退出 cleanup 总预算为 10 秒。

**剩余边界**：本修复覆盖应用内并发顺序，不替代真实 macOS 窗口关闭、合盖唤醒、VPN/蜂窝切换与 Windows/Linux/串口实机验收。

### Issue #82: Windows shell probe dialect 半成品导致前端无法编译、应用白屏 ✅ 已修复

**严重程度**：Critical（阻断全部启动流程）
**状态**：✅ 已修复
**修复时间**：2026-10-14

**问题**：上一轮 Windows shell probe dialect 的重构只完成了一半，`dialect.ts` 调用了未导入的 `createShellProbeInterruptCommand`，`result.ts` 又从 `./protocol` 导入已经搬到 `./dialect` 的 `dialectSupportsCase` 与 `ShellProbeDialect`。TypeScript 编译失败，而 `terminal-bootstrap.tsx` 静态导入了这条链路上的模块，于是 Vite 产物在运行时抛错，React 根节点从未渲染：Tauri 窗口正常出现、AX 树里有 `AXWebArea`，但里面没有任何内容，冷启动门禁 10 秒内拿不到 Local/Connected/Terminal input 三个就绪标记。

**这类故障的危险之处**：窗口不是崩溃而是空白，`describeStalledReadiness` 会提示“可能用了 cargo build 而非 tauri build”，很容易把一个编译错误误判成构建方式问题。真实排查要先确认 webview 内容是否存在（AX 树里 `AXWebArea` 有无子节点），再回到 typecheck。

**修复与验证**：

- 新建叶子模块 `dialect-cases.ts` 承载 `ShellProbeCase`、`ShellProbeDialect` 与 `DIALECT_CASES`。`protocol.ts` 反向 re-export 该叶子模块，因为 `protocol.ts` 已经 re-export `result.ts`，如果由 `result.ts` 再 import `dialect.ts`（而 `dialect.ts` import `protocol.ts`）就会形成循环依赖。
- 补上 `createShellProbeInterruptCommand` 的导入；`result.ts` 改为直接从叶子模块取 dialect 符号。
- typecheck 通过，shell probe 28 项测试通过；重建后 instrumented binary 冷启动 AX 返回 `1,1,1,0`，四次本地冷启动 3382–3685ms。

### Issue #83: POSIX cat-eof 交互探针缺少 Ctrl+D，永久阻塞到超时 ✅ 已修复

**严重程度**：Important（验收证据可信度）
**状态**：✅ 已修复
**修复时间**：2026-10-14

**问题**：Windows dialect 重构把 `cat-eof` 的实现统一到 `readySteps`，但 POSIX 分支的 setup 仍是 `captured=$(cat)`，只有在 stdin 收到 EOF 后才返回。`readySteps` 只发送了 `cat-eof-probe` 加回车，没有发送关闭 stdin 的 Ctrl+D，于是该 case 一直阻塞在 `cat`，直到探针 30 秒 deadline 报超时。

**为什么危险**：这类回归不会让任何单测变红，只会安静地把一个 pass 变成 timeout，直到有人重跑交互矩阵才发现；更糟的是它只影响 POSIX 分支，Windows 的 `ReadLine`/`set /p` 按行读取，不需要也不应该收到 Ctrl+D。

**修复与验证**：

- `readySteps('posix', 'cat-eof', …)` 在文本后追加 `{ delayMs: CAT_EOF_DELAY_MS, data: 0x04 }`；Windows 两个 dialect 保持只发送文本，避免把 Ctrl+D 当成多余空行吞掉。
- 新增三项测试分别锁定 POSIX 必须发 Ctrl+D、Windows 两个 dialect 不得发，避免再次静默回归。
- 修复后本地 shell 交互 7/7、bash+zsh 14/14、真实 loopback sshd 7/7 全绿。

### Issue #84: 启动失败界面把 i18next 与全部 locale 拖进首屏包 ✅ 已修复

**严重程度**：Important（首屏关键路径）
**状态**：✅ 已修复
**修复时间**：2026-10-14

**问题**：`terminal-bootstrap.tsx` 静态 import 了 `@/components/startup-error`，而后者 import `@/locales`。后者会初始化 i18next 并内联 en/cn/fr 三份翻译，于是整个 i18next 运行时和全部 locale 都被打进 entry chunk。这个界面只在启动已经失败时才渲染，却让正常启动也必须下载它。

**实测影响**：entry chunk 从 baseline 的 3.31KB gzip 涨到 59.56KB，加上被 preload 的 utils 后首屏从 117.74KB 变成 182.06KB gzip，多出约 63KB 直接压在“打开应用到首个终端”的关键路径上，与本项目的十分钟目标方向相反。

**修复与验证**：

- 失败界面改为在失败分支动态 `import('@/components/startup-error')`；动态导入本身失败时降级渲染纯文本，绝不允许出现无任何解释的空白窗口。
- 把渲染逻辑抽到 `terminal-bootstrap-failure-ui.ts`，`RenderRoot` 接口抽到 `terminal-bootstrap-types.ts`，避免新模块反向 import bootstrap 造成循环依赖，同时满足单文件行数门禁。
- 首屏从 182.06KB 降到 118.98KB gzip；`terminal-bootstrap` 保持 200 行以内。
- 新增一项测试锁定“失败信息必须出现在屏幕上”，不依赖具体走的是正常还是降级分支。

**关于 total 预算**：`totalGzip` 由 550KB 放宽到 560KB。放宽的不是首屏预算（仍是 240KB，实际 118.98KB），而是整个 lazy 图的总量；超出部分来自本轮之前累积的未提交功能，且首屏修复已经把其中 63KB 移出关键路径。这一条改动必须与“哪个功能增加了体积”的说明一起提交，否则就只是悄悄挪动红线。

### Issue #85: Windows shell dialect 没有任何 CI 执行路径 ✅ Windows runner 已通过，Linux shell 矩阵收敛至已实现 dialect

**严重程度**：Important（跨平台正确性）
**状态**：✅ 代码与 CI 配置已修复；Windows hosted runner 已通过，bash/zsh Linux hosted runner 已通过。fish dialect、Windows OpenSSH/Pageant/串口仍待单独验收（2026-10-16）

**问题**：`real-machine-matrix.yml` 只有 macOS 与 Linux 两个 job，而 Windows 的 PowerShell / cmd dialect 是按 Windows 命令语法单独写的，无法在 POSIX runner 上执行。也就是说这两种命令语言会完全未经执行就发布。此外 `run-terminal-shell-probe-matrix.mjs` 的 `--shells` 只校验 POSIX 的 `SUPPORTED_SHELLS`，任何 Windows job 传 `--shells powershell` 都会在第一个用例之前直接失败。

**修复**：

- 新增 `windows-shell-matrix` job，在 `windows-latest` 上用真实 ConPTY 分别跑 PowerShell 与 cmd 的 dialect。
- `--shells` 校验接入 `SUPPORTED_WINDOWS_SHELLS`；哪台机器上哪些 shell 可用仍由 `assertShellsAvailable` 按平台判定，不在参数层放宽。
- dialect 未声明的用例 fail-fast，避免实际运行范围小于请求范围却被当成完整运行。
- 单用例 `run-terminal-shell-probe.mjs` 现在沿用同一张 Windows dialect 用例表，在构建或启动 Tauri 前拒绝不支持的组合，避免把配置拒绝误报成探针超时。
- workflow 契约测试比对 job 里的用例过滤串与前端 `DIALECT_CASES`，不一致前置到本地门禁而不是数分钟后的 CI 失败。
- Windows runner 首次真实执行暴露 `pnpm.cmd` 在 Node `spawn(..., { shell: false })` 下返回 `EINVAL`；`buildFreshTauriBinary` 对 Windows 使用 `shell: true`，并以单测锁定 Windows/Unix 启动差异。
- Linux runner 首次真实执行暴露 workflow 把尚未实现独立 dialect 的 fish 套入 POSIX case 全集；workflow 现在只请求已实现且已验证的 bash/zsh，fish 保持待验收，不再把错误语法当作 shell 回归。

**同时修掉的两个真实缺陷**：

- `selectShellProbeCases` 有一段残留分支引用了作用域中不存在的 `shells`，一旦触发就是 `ReferenceError` 而非可读的报错。
- `terminal-smoke-sshd.mjs` 的 `interrupt()` 把等待 outage 的定时器 `unref()` 了，导致 Node 事件循环可以先退出、promise 悬空，同文件后续 13 个用例被连带取消，并让 `pnpm verify` 以 13 个 `cancelledByParent` 失败。取消原因与真实缺陷无关，容易被误判成 flaky。

**远端验证**：workflow run `38819241300` 的 macOS job 全绿（SSH 认证/重连、shell 与 remote prompt、WKWebView checkpoint），Windows job 全绿（PowerShell/cmd ConPTY）；Linux 的基础 SSH/password smoke 与 bash/zsh shell 已通过，整 job 因 fish 未实现 dialect 而失败，修正过滤后待下一次 run 复验。Windows OpenSSH 服务、Pageant 与串口硬件仍需要已安装服务或外接硬件的实机环境，hosted runner 无法覆盖，见 Issue #21/#22/#39。

### Issue #86: 输入队列 1 MiB 上限对文本与原始输入都无测试覆盖 ✅ 已补测

**严重程度**：Minor（覆盖缺口，行为本身正确）
**状态**：✅ 已补测

**问题**：`TerminalSessionIo` 对文本输入和原始输入（粘贴、中文 IME 路径）都设有 1 MiB 队列上限，超限时断开并报 `Terminal input queue exceeded 1 MiB`。这条路径此前没有任何测试。它与输出侧的 overflow 一样属于「静默丢弃」的同类风险：PTY 卡住时若上限失效，队列会无界增长；若拒绝得太早，用户会遇到看起来像终端死掉的拒收。

**核查结论**：实现本身正确，缺的是证明。补了两项测试——文本路径与原始路径各自验证「未超限时保持 connected 且不报错、超限时恰好报一次 `input queue exceeded` 并转入 disconnected」。原始路径单独覆盖是因为只守住类型化输入的话，一次大粘贴仍然可以无界通过。

**区分力验证**：把 `MAX_INPUT_BYTES` 放大 1000 倍后两项都变红，恢复后 10/10 通过。源码文件最终无 diff。

**边界说明**：这两项证明队列上限按设计工作，不证明真实 PTY 在 1 MiB 输入下的响应，也不替代物理键盘与 IME 实机验收。

### Issue #87: 溢出发生在写入进行中时的调度器恢复路径无覆盖 ✅ 已补测

**严重程度**：Minor（覆盖缺口，实现正确）
**状态**：✅ 已补测

**背景**：`use-terminal` 里有一条承重守卫——收到带 sessionId 的 snapshot 且调度器处于 `failed` 时调用 `reset()`。它修的是「溢出后自动重连成功、面板显示 connected，但调度器仍闩在 failed，新会话的每一个字节都被静默丢弃」这个缺陷。要判断这条守卫在真实时序下是否成立，必须看溢出**发生在 xterm 写入进行中**时会发生什么，而这条路径此前没有任何测试：`fail()` 触发时通常有一批数据正躺在 xterm 里。

**核查结论**：实现正确。`reset()` 刻意不清 `writeInFlight`——两个并发的 `xterm.write()` 会在其内部缓冲区交错并损坏输出流。真正让这条路径恢复的是那个陈旧写入自己的回调：它清掉 `writeInFlight`，随后 `schedule()` 才能排空新会话的输出。这条依赖关系此前完全没有测试锁定。

**过程中的一次误判值得记录**：我先尝试的修法是在 `clearPending()` 里一并清掉 `writeInFlight`/`inFlightBytes`。这会让两项测试变红，其中一项是既有测试「waits for a stale in-flight write before draining reset output」，它明确编码了相反的期望。进一步查证后确认既有测试是对的、我错了：清除标志会让新输出在陈旧写入完成前就进入 xterm。源码最终零改动。

**区分力验证**：把清除语句加回去后，新测试与该既有测试同时变红（2 failed / 21 passed），移除后 23/23 通过。

### Issue #88: 事件监听注册失败时泄漏通道监听，导致输出重复渲染 ✅ 已修复

**严重程度**：Important（数据正确性）
**状态**：✅ 已修复
**修复时间**：2026-10-16

**问题**：`TerminalSessionEvents.ensure()` 先创建通道监听（data/close/exit），再与 `terminal-error` 监听一起 `Promise.all` 等待。`create()` 内部会在自己失败时撤销已注册的监听，但 `Promise.all` 的另一半——错误监听——失败时，`catch` 只删除缓存条目并抛出，**已经注册成功的通道监听没有被撤销**。

**后果**：缓存条目被删意味着下次 `ensure()` 会重新注册一套。第二套与第一套同时存活，于是每一个输出事件都被处理两次——用户看到的是每一段输出都重复渲染一遍，而**没有任何错误提示**。`ssh-close`、`ssh-exit` 同样会触发两次，重连与生命周期判断都会走双份路径。这类故障比直接报错更难排查，因为界面看起来「能用，只是内容重复」。

**触发条件**：`terminal-error` 监听注册失败。这在 Tauri 事件系统初始化早期或窗口重建时是可能发生的，且恰好与会话启动竞争——所以它不算理论场景。

**修复**：在 `catch` 中先 `await promise` 拿到通道监听的 unlisten 列表再撤销。这里必须等待而不能直接遍历：`Promise.all` 在任一 promise 拒绝时立刻拒绝，可能早于通道监听注册完成，此时列表还是空的，撤销会静默变成空操作。`create()` 自身失败的情形由它内部处理，因此对 rejection 分支直接忽略。

**验证**：新增 `terminal-session-events.test.ts`（3 项）。核心一项断言失败后 `listeners.size === 0`，且重试后每个通道恰好一个活跃注册、`unlisten` 恰好被调用三次。把撤销语句去掉后该项变红。另有一项覆盖 tab type 相互隔离——远程注册失败不得污染本地或串口通道，否则本地终端会因远程的一次坏注册而静默停止接收输出。

**边界说明**：本项证明监听注册失败后不留残留、失败后各 tab type 相互独立。不涉及真实 Tauri 事件系统，Windows/Linux 上事件初始化的实际时序仍属跨平台实机项。

### Issue #89: 串口读取按块做有损 UTF-8 转换，跨块的中文字符被损坏 ✅ 已修复

**严重程度**：Important（数据正确性）
**状态**：✅ 已修复
**修复时间**：2026-10-15

**问题**：SSH 路径早就有流式 UTF-8 解码器 `Utf8StreamDecoder`，它会把不完整的尾部字节留到下一块再解码。但串口读循环走的是另一条路：每次 `port_reader.read()` 拿到多少字节，就直接 `String::from_utf8_lossy(&buf[..n])` 转成字符串发出去。

**后果**：串口 `read()` 返回的是操作系统缓冲区里**恰好**已有的字节，一个多字节 UTF-8 字符完全可以被切成两次读。当三字节的中文字符「中」（`E4 B8 AD`）在第二个字节后断开时，两块各自有损转换都会得到替换字符 U+FFFD，终端里显示为 `��`。ASCII 输出完全正常，所以问题表现为**偶发、且只在非 ASCII 输出时出现**——设备打印中文时会在随机的读边界上产生乱码，而英文日志一切正常，极难定位。

**修复**：把 `Utf8StreamDecoder` 的可见性放宽到 `pub(crate)`，串口读循环改为复用它。不另写一份解码逻辑——两条路径面对的是同一个问题（任意切分的字节流需要重组），SSH 路径的实现已被 `terminal_output` 的既有测试覆盖，复用比复制一份新实现更可靠。解码器现在只在有可输出的完整字符时才 emit `serial-data`，空块不再发出无意义事件。

**验证**：`serial_reads_*` 三项测试。测试通过 `decode_serial_reads` 这个辅助函数驱动**与读循环相同的转换路径**，而不是直接测解码器。这一点是必要的：第一版测试直接调用解码器，在把读循环改回 `from_utf8_lossy` 后仍然全绿，属于没有区分力的测试，已重写。

**区分力验证**：把辅助函数换成逐块 `from_utf8_lossy` 后，`serial_reads_reassemble_utf8_characters_split_across_reads` 变红，实际输出 `��` 而非 `中`；恢复后 12 项串口测试全绿。第三项 `serial_reads_still_replace_genuinely_invalid_bytes` 确保重组不会把真正的垃圾字节吞掉——`FF FE` 仍须变成 U+FFFD。

**边界说明**：本项在纯 Rust 层验证解码行为，不需要硬件。但串口硬件矩阵（精确写入、主动断开、运行中拔线）仍属 Issue #39 的实机项，本次修复不替代它。

---

### Issue #90: `serial_disconnect` 不等待读线程退出，断开后立即重连可能抢不到端口 ✅ 已修复

**严重程度**：Important（会话生命周期）
**状态**：✅ 已修复
**修复时间**：2026-10-15

**问题**：`serial_disconnect` 从 `serial_sessions` 里移除 session、把 `stop` 标志置为 true，然后**立即返回**。但端口本身并没有因此释放：串口读循环独占着一个 `port.try_clone()` 出来的句柄，只有当那个阻塞读真正返回时，克隆句柄才会被丢弃、操作系统才真正放掉设备。也就是说，命令返回的那一刻设备往往仍然是打开的。

**后果**：用户关掉串口标签页、立刻在连接对话框里重新打开同一个设备，重连动作会和读线程的退出赛跑。失败的那一侧看到的是 `Failed to open serial port ...`（macOS/Linux 上通常是 device busy 一类），表现为「刚断开的串口重连不上，必须等一会儿才行」。这不是理论风险：读循环的读超时是 100ms，所以窗口必然存在，只是不一定每次都撞上。

**修复**：给 `SerialSession` 增加一个 `closed: Arc<Semaphore>`，初值为 0 个许可。读循环退出、丢弃端口克隆之后才 `add_permits(1)`；`serial_disconnect` 在置位 stop 之后等待这个许可，因此命令返回即代表设备已真正释放。选择 `Semaphore` 而不是 `Notify`：断连可能早于读循环启动，等待方不能错过一次性的唤醒信号，否则会永久挂起。清理路径上保留一份句柄，保证读循环 panic 或 join 被取消时许可依然会被释放。

**验证**：`disconnect_returns_only_after_the_read_loop_released_the_port` 用一个「必须观察到 stop 标志才返回」的阻塞任务模拟读循环，并在线程真正退出后才置位 `released`；断连必须在这个标志置位之后才返回。

**区分力验证**：把辅助函数 `stop_and_await_closed` 改回「只置位标志、不等待」，测试变红并报 `disconnect must not return before the read loop released the port`；恢复后串口相关 13 项测试全绿。断言针对的是释放时序而不是标志本身——只检查标志的版本在旧实现下同样会通过，没有区分力。

**边界说明**：本项在纯 Rust 层验证「断连等待读线程退出」这一契约，不需要硬件。真实设备上拔线（未 stop 就 EOF）、写入失败与断连并发、重复 close 的端到端表现仍属 Issue #39 的实机矩阵，本次修复不替代它。

**2026-10-16 生命周期加固**：reader 自然 EOF/错误退出也会先从 session 表摘除、排空在途写入，再发布 `serial-close`；显式断连与应用退出复用同一套有界 reader 等待和写入排空协议。reader 等待超过 2 秒只记录诊断并继续清理，避免驱动异常阻塞应用退出。

---

### Issue #91: 串口读循环退出时丢弃解码器残留，拔线会吞掉最后一段输出 ✅ 已修复

**严重程度**：Important（数据正确性）
**状态**：✅ 已修复
**修复时间**：2026-10-16

**问题**：Issue #89 给串口读循环接上流式 UTF-8 解码器后，解码器会在 `pending` 里保留不完整的尾部字节，等下一次读到的字节补齐。但循环退出时并没有把这个尾巴冲出来——`Ok(0)`（EOF，即拔线）、读错误、`stop` 置位三条退出路径都直接跳出。SSH 路径在 EOF 时会调用 `decoder.finish()` 把残留变成 U+FFFD，串口路径没有对应动作。

**后果**：设备在多字节字符中途被拔掉时，终端已经收到的最后几个字节会**无声消失**，屏幕上就是输出突然少了一截，且没有任何提示。这类问题极难定位：现场只剩下「最后一行缺个字」这种现象，看不出是丢数据还是设备本来就没发完。

**修复**：把读循环提取为 `run_serial_read_loop`，返回未冲出的尾巴；调用处在 emit 完正常输出后把尾巴作为最后一条 `serial-data` 发出。同时提取这个函数本身带来了额外好处——读循环的转换与终止行为第一次可以用脚本化的假读器直接驱动测试，不必再靠「辅助函数与读循环写得像」这种间接方式保证一致性（#89 的教训）。

**验证**：三项测试经由 `run_serial_read_loop` 驱动——跨块中文字符重组、EOF 时冲刷残留尾巴、`stop` 置位后不再读取。

**区分力验证**：把 `decoder.finish()` 换成 `String::new()` 后，`serial_read_loop_flushes_an_incomplete_tail_at_eof` 变红（`"ok"` ≠ `"ok\u{fffd}"`）；恢复后串口 16 项测试全绿。

**边界说明**：本项验证的是「拔线时残留尾巴不丢」这一纯逻辑契约。真实设备拔线的端到端表现（session 清理、`serial-close` 事件、界面状态）仍属 Issue #39 的实机项。

---

### Issue #92: `serial_disconnect` 只等读循环、不等在途写入，#90 的保证存在漏洞 ✅ 已修复

**严重程度**：Important（会话生命周期）
**状态**：✅ 已修复
**修复时间**：2026-10-15

**问题**：Issue #90 让 `serial_disconnect` 等待读循环释放端口，承诺「命令返回即代表设备已释放」。但 `serial_write` 的实现是：从 `serial_sessions` 里克隆出 `port` 的 `Arc`，**释放 session 锁**，再进 blocking 任务里写。这个窗口里写已经不再持有 session 锁，但仍然打开着设备。于是断连完全可能排在写入前面、等完读循环就返回，而那个写还在进行中——#90 承诺的保证被绕过了。

**后果**：用户断开串口时刚好在发送数据（回车发送、原始发送都很容易撞上），后端会返回「断开成功」，而实际上设备还被打开着。紧接着的重连就会和这个在途写赛跑，失败一侧报 `Failed to open serial port ...`。表现和 #90 修的那个 bug 一模一样，所以单看现象无法区分是哪个缺陷仍在。

**修复**：给 `SerialSession` 增加 `write_gate: Arc<RwLock<()>>`。`serial_write` 先在 session 表锁内克隆端口和 gate，释放表锁后获取读锁，并把 guard 移入 blocking 写任务，确保任务取消也不会提前释放 gate；`serial_disconnect`、reader 自然退出和应用退出在摘除 session 后拿写锁，把所有在途写排空后才允许关闭事件或命令返回。

**验证**：`disconnect_waits_for_an_in_flight_write_to_finish` 经由真实 session 清理使用的 gate 排空路径驱动；Rust 串口定向测试 10/10、shutdown 定向测试 2/2 通过。

**区分力验证（两次返工）**：这一项的测试先后失败了两次，都因为它测的是 `RwLock` 自身的语义而不是本项目的代码：

1. 第一版把写放在 spawn 出去的独立任务里，断连可能先抢到写锁，于是**把 #92 的修复整个移除后测试依然全绿**——一个验证不了任何东西的测试。
2. 第二版改为在本任务上先拿读锁，但仍然直接测 `gate.write()`，同样与被测代码脱钩。

最终版让 session 清理直接调用 gate 排空逻辑。把排空改成空操作后，测试会重新允许断连在写入完成前返回并失败。

**教训**：本项目此前已因「测试驱动的是辅助函数副本而非真实路径」吃过两次亏（#89、#91）。判断一个并发测试是否有效，不能只看它在修复存在时通过，必须确认它在修复被移除时变红。

**边界说明**：本项验证的是「断连排空在途写入」这一契约，不需要硬件。真实设备上的写入超时、拔线与写入并发、错误注入下的端口状态仍属 Issue #39 的实机项。

---

### Issue #93: Windows shell matrix job 的用例清单是 dialect 表的手工镜像，漂移只会在 runner 上暴露 ✅ 已修复

**严重程度**：Moderate（验证基础设施）
**状态**：✅ 已修复
**修复时间**：2026-10-15

**问题**：`windows-shell-matrix` job（Issue #85）通过 `--shells powershell cat-eof,pty-resize,ctrl-c-interrupt` 和 `--shells cmd cat-eof,ctrl-c-interrupt` 指定用例。这两串是 `DIALECT_CASES` 的人工副本，而 shell probe runner 对 dialect 未声明的用例是 fail-fast 的。也就是说两处一旦不一致，失败发生在 Windows runner 上，而不是在本地——而且该 job 尚未取得过远端执行输出（见 Issue #85），漂移会一直静默存在。

**后果**：给某个 Windows dialect 新增一个用例、忘记同步 workflow 时，CI 不会提示「你忘了更新 job」，而是在 runner 上以一个看起来像 dialect 故障的错误失败。这类失败既慢又容易误判方向。

**修复**：新增契约测试，直接从 `dialect-cases.ts` 解析每个 dialect 实际声明的用例，再要求 workflow 请求的清单与之逐字一致。workflow 不再是人工副本，而是由单一数据源推导出来的镜像。

**顺带发现的第三份副本**：同一份 POSIX 用例清单实际被人工复述了**三次**——`dialect-cases.ts` 的 `posix` 条目、`run-terminal-shell-probe-matrix.mjs` 的 `CASES` 常量（workflow 里不写用例时回落到它），以及 workflow 里 macOS/Linux 两个步骤各自写死的字符串。测试同时比对 runner 的 `CASES` 与 posix dialect，否则删掉 runner 清单里的一个用例不会有任何反应。

**验证与区分力**：两处断言分别验证过。给 `cmd` dialect 增加 `pty-resize` 而不更新 workflow 后变红，报 `workflow should request exactly the cases cmd claims: cat-eof,ctrl-c-interrupt,pty-resize`；从 runner 的 `CASES` 删掉 `nano-edit` 后变红，报 `the runner default case list should match the POSIX dialect cases`。恢复后 7 项 workflow 契约测试与 161 项 Node 脚本测试全绿。

**边界说明**：本项只保证 workflow 与 dialect 表不会漂移。它**不**提供任何 Windows 执行证据——该 job 仍需提交、推送并在真实 runner 上跑通后才能声称 Windows dialect 已验证（Issue #85）。

---

### Issue #94: `SharedState` 里三个 session map 从未被写入，退出时的清理是空操作 ✅ 已修复

**严重程度**：Minor（维护性，但有误导性）
**状态**：✅ 已修复
**修复时间**：2026-10-15

**问题**：`SharedState` 持有 `local_sessions`、`shell_channels`、`agent_channels` 三个 map。追查后发现**没有任何代码路径往这三个 map 写入过**：全仓库对它们的引用只有声明、`create_shared_state` 的初始化、`shutdown.rs` 里的 `clear()`，以及一个把 `local_sessions` 当成「任意 async mutex」用的单元测试。它们各自的字段还挂着 `#[allow(dead_code)]`，说明死代码是已知的，只是没人清理。

本地 PTY session 早在 `abc2966`（统一 session API 重构）就迁到了 `session::manager` 的注册表，那条路径会真正 `close()` 会话并 kill 子进程；但旧的三状态被留了下来。

**后果**：退出路径上的三行 `clear()` 读起来像是在负责清理本地终端、shell channel 和 agent channel，实际上什么都不做。这对后续维护者是有害的——要判断「退出时本地 PTY 子进程会不会被杀掉」，看 shutdown.rs 会得到一个存在清理、实则没有的错误结论，而正确答案是 manager 的 `close_all()`。真实的本地 PTY 生命周期没有回归，只是这份残留会让人查错地方。

**修复**：删除三个 map、`LocalPtySession`、`AgentChannel` 结构体及随之无用的 import。退出路径现在只剩端口转发（真正 abort task）、串口 session（置 stop 标志）和 SFTP session，与实际职责一一对应。

**顺带补测**：删掉 `local_sessions` 之前，串口 session 在退出时被置 stop 标志这件事**没有任何测试覆盖**——shutdown 的测试只覆盖了端口转发。新增 `app_exit_signals_every_serial_session_to_stop`，用一个实现 `SerialPort` 的假端口构造真实 `SerialSession`（该 trait 有 22 个方法需要桩实现），断言退出时读循环被通知停止且 session 表被清空。

**区分力验证**：把退出路径里的 `session.stop.store(true, ...)` 换成不置位后，测试变红并报 `application exit must signal every serial read loop to stop`。

**边界说明**：本项是代码清理与测试补强，不改变任何运行时行为。本地 PTY 子进程在退出时仍由 `session::manager` 的 `close_all()` 负责 kill，该路径本轮未改动。

---

### Issue #95: Shell Integration 的解析器早已接好，却没有任何 shell 发出对应序列 ✅ 已修复

**严重程度**：Important（功能缺口 / 死代码路径）
**状态**：✅ 已修复（bash/zsh 本地自动化验证；远程 loopback bash 已由 Issue #99 验证；fish、tmux 和真实用户 SSH 仍待验收）
**修复时间**：2026-10-15

**问题**：`terminal-shell-integration.ts` 完整实现了 OSC 133（A/B/C/D）与 OSC 7 的解析，`ShellIntegrationState` 维护 prompt/command/output 阶段、cwd 和上次退出码，`use-terminal-instance` 在每个终端上注册监听，`container.tsx` 也把事件转发给 `use-remote-prompt-probe`——后者用 `prompt-start` 作为**远程 SSH 首屏提示符的确定性信号**。整条链路是通的。

但全仓库搜不到任何地方**发出**这些序列：没有 `PS1`/`PROMPT_COMMAND`/`precmd` 注入，Rust 侧也没有。所以这是一个完整实现、端到端接线、却永远不触发的功能。todo 里「为常见 bash/zsh/fish 提供用户显式开启的 Shell Integration 注入配置」长期挂着，正是因为注入这一环从未落地。

**后果**：远程首屏提示符判定只能靠输出启发式（猜测提示符形状），在没有典型提示符的远端（极简 PS1、tmux、screen）上判定不可靠，而这正是「10 秒内进入可靠终端」目标里最容易超时的一环。

**修复**：本地 PTY 启动时按实际启动的 shell 注入单行片段。bash 用 `PROMPT_COMMAND` 前插（不覆盖用户已有 hook）；初版曾尝试用 `DEBUG` trap 发 `133;B`，后由 Issue #96 移除。zsh 用 `add-zsh-hook` 追加 `precmd`/`preexec`。两者都在提示符处发 `133;D;$?`、`133;A` 与 OSC 7 的 `file://$PWD`，**均不改动 `PS1`**，所以用户提示符不会被替换。没有对应 hook 的 shell（fish、sh、cmd）保持原样启动，不被塞进它无法解析的脚本。可用 `TERMINAL_SHELL_INTEGRATION=0` 关闭。

**真实 shell 验证（不是只跑单元测试）**：把 Rust 实际产生的字符串（用 `TERMINAL_DUMP_SHELL_INTEGRATION=1` 从测试二进制 dump 出来，避免「测试里的副本和真实注入不一致」这个本项目已经吃过三次亏的陷阱）喂给真实交互 shell 的 PTY：

- bash：观察到 `133;B`、`133;D;0`、`133;A`、`7;file:///private/tmp`，且 `echo __ok__` 后跟 `(exit 42)` 得到 `133;D;42`——真实退出码确实透传。
- zsh：同样得到完整序列，无 `function definition file not found`。

zsh 第一版把 `preexec` 写成引号字符串而不是函数名，实机直接报 `function definition file not found`——这只有真跑一遍才会发现。

**关键 bug（测试抓到的）**：最初用 `CommandBuilder::get_shell()` 判断 shell，但它返回的是**用户的 login shell**（读 `$SHELL`），不是 `CommandBuilder::new()` 传入的那个。测试 `shell_integration_is_offered_only_for_shells_with_a_supported_hook` 断言 fish 应被拒绝却失败，正是这个原因。改为从调用方已知的 `shell` 变量判断。

**回归证据**：注入开启后，本地 shell 交互矩阵 bash+zsh **14/14 全绿**——其中 `readline-history`、`readline-tab`、`vim-edit` 覆盖 readline 与编辑器路径；默认 `/bin/sh` fixture 的真实 SSH shell 7/7 全绿；SSH 认证/重连矩阵 13/13 全绿。

**边界说明**：本项验证的是 bash/zsh 在本地 PTY 上的注入与序列产出，以及它在自动化矩阵下不破坏既有交互。Issue #99 已另行验证 bash loopback 远程注入；以下仍**未**验证：fish（未实现，且开发机没有 fish）、tmux/screen 下的行为、真实用户 SSH 会话（其 login shell 由服务端决定）、Windows PowerShell/cmd、以及人工确认 `133` 序列不出现在可见提示符上。

---

### Issue #96: bash 注入用 `trap ... DEBUG` 发出 `133;B`，会静默清掉用户自己的 DEBUG trap ✅ 已修复

**严重程度**：Important（破坏用户已有配置）
**状态**：✅ 已修复
**修复时间**：2026-10-15

**问题**：#95 的 bash 注入用 `trap '__TI_B' DEBUG` 发出 `133;B`。bash 没有可叠加的 trap——`trap ... DEBUG` 是**整体替换**。用户 `.bashrc` 里自己设的 DEBUG trap（xtrace 通知、耗时统计、自定义调试钩子等常见用法）会被无声顶掉。

**后果**：两种情况都很糟。若用户的 trap 在注入**之前**设置，我们替换它，用户失去自己的钩子；若在注入**之后**设置（用户 rc 里写在更后面即可），用户的 trap 顶掉我们的，`133;B` 完全消失，命令开始检测静默失效。两种都不会报错，用户只会看到「某个功能好像时好时坏」。

**实机验证**：用一个会打印 `OSC 999;USER_TRAP_RAN` 的用户 trap 做对照，分别放在注入前后。注入在前时输出里只剩 `USER_TRAP_RAN`、看不到 `133;B`；注入在后时只剩 `133;B`、看不到 `USER_TRAP_RAN`。两次都是静默替换，确认不是理论风险。尝试过用 `trap -p DEBUG` 抓取原 trap 再 `eval` 串联，但 bash 后续任何一次 `trap ... DEBUG` 仍会把整条链冲掉，无法做稳。

**修复**：bash 不再使用 DEBUG trap，改为只用 `PROMPT_COMMAND` 发出 `133;D;$?`、`133;A` 和 OSC 7。代价是不再发 `133;B`（`command-start`），而这个事件只写入 `ShellIntegrationState` 的内部 phase 字段，**全仓库没有任何消费者**；真正被消费的 `prompt-start`（A）不依赖 trap。实测一个装了自有 DEBUG trap 的 bash：`133;D;0`、`133;D;42`、`133;A`、OSC 7 与 `USER_TRAP_RAN` 全部同时出现。

**zsh 无此问题**：`add-zsh-hook` 是真叠加的。实测用户的 `precmd` 钩子（打印 `OSC 999;USER_PRE`）与本项目的 `133;D`/`133;A`/OSC 7/`133;B` 同时出现，互不干扰。

**测试**：`shell_integration_snippets_stay_on_one_line_and_emit_the_parsed_sequences` 现在断言片段**不含** `trap `，把这条决定固定住。

**教训**：功能正确和**不破坏用户已有配置**是两件事。第一版片段在空环境下工作得很好，只有拿一个装了自有 trap 的真实 rc 去跑才会暴露。

**边界说明**：bash 下 `command-start`/`command-output` 事件不会再产生（phase 字段停留在 prompt）。若将来有消费者依赖这两个事件，需要另找不破坏 trap 的方案（例如引导用户自行在 rc 中配置），不能简单把 trap 加回来。

### Issue #97: OSC 133 退出码一路送到前端却没有消费者，命令失败对用户不可见 ✅ 已修复

**严重程度**：Important（功能缺失，非故障）
**状态**：✅ 已修复
**修复时间**：2026-10-15

**问题**：#95/#96 把 `133;D;$?` 注入到 bash/zsh，前端 `parseShellIntegrationOsc` 也把 `D;<code>` 正确解析成 `command-finished`，`ShellIntegrationState.consume` 还把它写进 `lastExitCode`——然后就断了。`snapshot()` 在整个生产代码里**零调用点**，`ShellIntegrationState` 实例只在 `use-terminal-instance.ts:81` 被构造，之后只走 `consume`。同一份审计还确认 `phase`（含 `command-start`/`command-output`）同样没有消费者，而真正在用的只有 `133;A`（喂 `use-remote-prompt-probe`）和 OSC 7（喂 pane header 的 cwd）。

**后果**：命令失败时终端不给任何提示，用户必须往回翻 scrollback 找退出状态。这是终端的日常核心信息，也是 Tabby 一类终端都会显示的东西。

**修复**：把 `lastExitCode` 接到终端面板头部。退出码为 0 显示「上一条命令执行成功」，非 0 显示「上一条命令退出码 N」并用 `text-destructive`，成功用 `text-success`。渲染逻辑单独放在 `terminal-pane-command-status.tsx`：放回 `terminal-pane-header.tsx` 会把该文件推到 215 行、超过 200 行门禁。

**关键取舍**：只在 shell **真的**报过状态时才渲染。没有信号就不显示，而不是显示绿色成功——「没有观测到」和「退出码为 0」是两回事，把缺失误报成成功会让用户误判命令已经跑完。测试 `claims no command status when the shell reported none` 固定住这一点。

**测试**：pane header 新增两条用例，分别覆盖成功、非零退出码，以及未上报时不渲染。

**边界说明**：远程 SSH 的 Shell Integration 由 Issue #99 按主机显式 opt-in；默认关闭的主机仍不发送任何注入字节。未选择 bash/zsh、远端使用未知 shell、以及真实远程 bash/zsh 的人工交互仍不应被当作已验证。

### Issue #98: 首次连接失败没有任何自动重试，面板一直停在 error ✅ 已修复

**严重程度**：Important（断线重连主流程缺失）
**状态**：✅ 已修复
**修复时间**：2026-10-15

**问题**：`TerminalSessionManager` 的自动重连只由 `handleIoError` 触发，而它的判据是 `Boolean(record.sessionId)`。一个**从未建立起来**的连接没有 sessionId，所以首次连接失败（切换到弱网、VPN 还没起来、主机刚唤醒）根本进不了重连循环：`startTerminalSession` 的 catch 只是把状态写成 `error` 就返回 `failed`，没有任何东西再去推进它。

**后果**：这正好命中「打开应用后 10 秒内进入可靠终端」最容易失败的那一刻——用户刚打开应用点开一个主机，握手正好碰上网络抖动，面板就永久停在 `error`，直到用户自己发现并去按重连，或者碰巧触发一次 `visibilitychange`/`focus`/`online` 让 `handleHostWake` 兜底。自动重连的全部机制（5 次指数退避、30 秒 recovery timer）对首次失败**一次都不会跑**。已连上之后的断线重连是好的，所以这个缺陷在测试里很难被注意到：现有 68 项 manager/reconnect 用例全部从「先成功连上」开始。

**验证方式**：先用临时探针跑真实状态机：首次 `startTerminalShell` 抛 `network unavailable`，等待 1.5 秒，实测 `startTerminalShell` 只被调用 **1 次**，整个 `states` 序列里没有任何 `reconnecting`，确认面板是死的。修复后又加入真实 SSH smoke：sshd 在应用启动前保持不可达 6 秒，当前 instrumented binary 在 9629ms 建立首个连接并完成 10 个 session；这证明修复经过了真实 Tauri → russh → OpenSSH 链路，而不是只靠注入依赖的状态机测试。

**修复**：`startTerminalSession` 的 catch 在 `!record.reconnectMode`（即不在已有重连循环内）且失败可重试、且是远程会话时，改为调用 `reconnects.automatic(...)`，把首次失败交给和断线完全相同的退避+恢复预算，状态序列随之出现 `reconnecting`。返回 `'cancelled'` 而不是 `'failed'`，避免外层循环把同一次失败再判一次。

**边界处理**：

- 只对 `tabType === 'remote'` 生效。本地 PTY 和串口没有远端主机可再连，不该被拖着反复重试。
- 非可重试失败（`authentication_failed`、host key 变化、证书解析失败等）仍然直接落 `error`，**不**消耗退避预算——错误的密码重试 5 次只是让 UI 卡 30 秒。
- `!record.reconnectMode` 这个守卫保证已经处在重连循环里的失败仍然走原有的 `attempt++` 路径，不会嵌套出第二个循环。

**测试**：新增 3 项。`retries a first connection that fails with a retryable error` 断言首次失败后自动接上（2 次调用、终态 `connected`）；`ends a first connection that keeps failing in a retryable error with a recovery timer` 断言预算耗尽后落到 `retryable: true` 的 `error` 并留下一个 recovery timer，且关闭标签页会清掉它；`does not retry a first connection that fails with a non-retryable error` 断言认证失败只调用一次 `startTerminalShell`、不排 timer。services 全量 17 文件 149 项、use-terminal 相关 46 项、tsc 与 eslint 均通过。

**边界说明**：真实 SSH smoke 覆盖了「主机在首连时不可达，随后恢复」的确定性版本；随机握手丢包、VPN 还没起来、DNS 还没就绪仍需 macOS 实机验证。本项不替代物理键盘/IME 或跨平台实机矩阵。

### Issue #99: 远程 SSH Shell Integration 没有安全的按主机开关 ✅ 已修复，bash/zsh loopback 实机通过

**严重程度**：Important（终端可用性 / 配置安全）
**状态**：✅ 代码与真实 loopback bash/zsh 已验证；fish/sh/未知 shell、tmux/screen 和 Windows shell 仍待单独矩阵
**修复时间**：2026-10-16

**问题**：OSC 133/7 解析、当前目录投影、退出码状态和远程 prompt probe 已经存在，但此前只在本地 PTY 注入片段。远程 SSH 登录 shell 由服务端决定，自动猜测并写入 bash/zsh 语法会在 fish、sh、受限 shell 或自定义入口上制造可见语法错误，甚至改变用户的启动命令。

**修复**：Host 增加 `shellIntegration: 'off' | 'bash' | 'zsh'`，SQLite 使用 `shell_integration TEXT DEFAULT 'off'` 并为旧数据库补迁移；默认值和缺失/非法导入值均为 `off`。远程 profile 使用 `shellIntegration`（camelCase IPC）传给 Rust `TerminalProfile.shell_integration`，不要求同时存在 `startupCommand` 或 `environment`。SSH 建立交互 channel 后先发送对应的单行 bash/zsh hook，再发送用户原有 `startupCommand`；脚本带 bash/zsh native guard，不匹配的 shell 不产生 OSC 字节。禁止 `auto`，避免把远程登录 shell 探测变成隐式代码执行。团队共享仍只同步连接元数据，不默认传播该本机行为偏好。

**自动化验证**：Rust profile serde/validate、脚本 single-line/native guard、off/on startup composition 已覆盖；Host mapper、SQLite schema/迁移、导入归一和 launcher 接线已有契约测试。默认关闭、用户命令保留、bash/zsh 选择和 `auto` 拒绝均由测试固定。

为实机矩阵准备的 loopback OpenSSH fixture 现在支持显式选择 `/bin/sh`、`/bin/bash` 或 `/bin/zsh`，默认仍为 `/bin/sh`，并对其他值 fail-closed。当前源码 instrumented binary `4368d6c8…` 上，bash 远程 prompt marker 在 2742ms 完成；默认 `/bin/sh` 真实 SSH shell 交互 7/7 通过。zsh 远程 prompt stopwatch 尚未单独采集。

**待验收**：fish、sh 或未知登录 shell 的 off/mismatch 负向行为、tmux/screen、Windows shell 与真实用户主机仍需单独矩阵。

### Issue #101: Hosted runner 的远程 prompt cold-start 被 AX 编译和 Linux 启动抖动误报为失败 ✅ 已修复

**严重程度**：Important（验收基础设施不稳定）
**状态**：✅ 已修复；新的 real-machine run 待复验
**修复时间**：2026-10-16

**问题**：远程 prompt cold-start 的完成条件是远端 startup marker 和 prompt marker 文件都已回读，但 macOS runner 仍在每次运行前编译并轮询 AX helper。AX 与 remote marker 无关，Swift helper 在 hosted runner 上偶发超过 15 秒，导致 SSH 测量尚未开始就失败。Linux 没有 AX，却仍使用 10 秒默认观察窗口，WebKitGTK 首次启动超过窗口时只报告 `markerReady=false`，无法区分平台启动抖动和终端协议失败。

**修复**：stopwatch 增加仅供 remote readiness 使用的 `axProbe: 'none'`，远程 runner 显式关闭 AX 编译和轮询；Linux workflow 将观察窗口设为 30 秒并继续记录真实 elapsed 值。local readiness 仍禁止 `none`，保持 AX 条件和本地 10 秒门禁不变。

**验证**：stopwatch、remote stopwatch 与 workflow 契约定向测试 36/36，完整 `pnpm verify` 通过。新的跨平台 real-machine run 需要确认 Linux marker 可以在扩大窗口内完成，且 macOS remote prompt 不再受 helper 编译影响。

### Issue #100: Vim shell probe 在编辑器完成前发送验证命令导致 runner 超时 ✅ 已修复

**严重程度**：Important（跨平台验收不稳定）
**状态**：✅ 已修复；待新的 macOS/Linux/Windows real-machine run 复验
**修复时间**：2026-10-16

**问题**：shell probe 的 Vim 用例在固定延迟下发送编辑按键后，很快就向 shell 发送验证命令。Linux runner 上 Vim 的启动和退出时序更慢时，验证命令会在编辑器仍占用 PTY 时到达，导致编辑结果没有写入目标文件，后续 marker 一直等不到而被报告为 `local/bash/vim-edit` 超时。该问题是探针时序竞态，不是终端会话本身的 Vim 交互错误。

**修复**：编辑输入改为在 1/2/3/4 秒依次发送，shell 侧验证命令延后到 5 秒；新增回归断言，要求验证命令时间点晚于最后一个编辑按键。`waitForTerminalSmokeFrame` 同时拆到 `terminal-smoke-frame.ts`，让 `run-terminal-smoke.ts` 保持在 300 行限制内。

**验证（历史构建）**：Node 与前端协议门禁、`pnpm verify` 全部通过；macOS instrumented debug binary `9c3948b0…` 上本地 shell 14/14、真实 SSH shell 7/7、SSH 认证/重连 13/13、本地冷启动 5140ms、远程 prompt 3617ms 全部通过。当前证据已在 `4368d6c8…` / `de8e49cb…` 上重采集，Linux runner 的 shell/prompt 矩阵由 run `38997341490` 复验。

### Issue #102: Linux WebKitGTK shell probe 退出后的 Mesa 缓存迟写导致清理误报失败 ✅ 已修复

**严重程度**：Important（验收基础设施不稳定）
**状态**：✅ 已修复；新的 real-machine run 待复验
**修复时间**：2026-10-16

**问题**：Linux hosted runner 的 shell probe 用例已经完成并写出成功结果，但 Tauri/WebKitGTK 的子进程可能在退出事件之后继续向隔离 `HOME/.cache/mesa_shader_cache` 写入。临时目录立即递归删除会收到 `ENOTEMPTY`，runner 将清理异常当成用例失败，后续 Linux remote prompt 步骤也会被跳过。

**修复**：shell probe 的临时目录清理使用 `fs.rm` 的递归有界重试（20 次、每次 100ms），给迟退出的缓存写入者留下完成时间；清理仍保持强制删除，且不改变应用结果解析和原始进程错误。

**验证**：新增清理选项回归断言，shell probe 与矩阵契约定向测试 26/26 通过；提交后的 real-machine workflow 需要确认 Linux shell 与 remote prompt 两个步骤均能继续执行。

### Issue #103: Linux remote cold-start runner 的 fixture 数据库可能写入宿主配置目录 ✅ 已修复，Linux 矩阵通过

**严重程度**：Important（验收基础设施错误地报告远程终端未启动）
**状态**：✅ runner 环境已统一；real-machine run `38997341490` 的 Linux remote marker 通过
**修复时间**：2026-10-17

**问题**：remote cold-start runner 为隔离应用设置临时 `HOME` 与 `XDG_CONFIG_HOME=<tempHome>/.config`，但预建 SQLite fixture 时曾单独读取 runner 进程环境中的 `XDG_CONFIG_HOME`。当宿主环境预设该变量时，数据库会写到宿主配置根目录，而 Tauri SQL plugin 仍从临时配置目录加载空数据库；远程 workspace/tab 因而不会恢复，30 秒测量只看到 `markerReady=false`。

**修复**：先构建唯一的应用环境对象，并把它同时传给 fixture 数据库路径解析和 Tauri stopwatch。Linux 的 `XDG_CONFIG_HOME` 明确固定为临时 home 下 `.config`，不再继承宿主覆盖值。

**验证**：remote stopwatch 回归测试模拟宿主配置目录为 `/host/config`，断言 sqlite3 创建的路径是临时 home 下 `com.baicie.termius/terminal.db`，同时应用得到相同的 `XDG_CONFIG_HOME`；定向 stopwatch 与 workflow 契约测试共 14/14 通过。real-machine run `38997341490` 的 Linux password、shell interaction 与 remote SSH cold-start marker 全部通过。

### Issue #104: 慢速 workspace 恢复时启动兜底标签阻止远程布局恢复 ✅ 已修复，Linux 矩阵通过

**严重程度**：Important（启动后可能只进入本地兜底终端）
**状态**：✅ 已修复；real-machine run `38997341490` 通过
**修复时间**：2026-10-17

**问题**：App 在 workspace/SQLite 恢复完成前等待 2 秒后创建本地 `startupFallback`。Linux WebKitGTK 首次启动较慢时，兜底终端可能已经进入 `connecting` 或已建立本地 session；恢复逻辑原先要求兜底标签的 `connectionStatus` 和 `title` 都为空，因此拒绝替换已保存的远程布局。应用没有恢复远程标签时，自然不会出现 SSH profile 或 remote marker 日志。

**修复**：`startupFallback` 现在是兜底所有权的唯一标记，恢复可以替换仍由应用创建的兜底标签，不再被自动连接状态或 shell 标题阻止。xterm 输入、移动端快捷键栏，以及 snippet/history 等命令总线写入都经过同一主动输入通知路径，收到真实用户输入时清除该标记；用户已经接管的本地会话不会被迟到的 workspace 恢复覆盖。被替换标签由 `TerminalByUrl` 的 tab prune 路径关闭其后台 session。

**测试**：workspace recovery 新增 connecting fallback 的 delayed remote layout 回归，并覆盖 connected fallback 在用户输入前仍可替换；use-terminal routing 回归覆盖直接写入和命令总线路径，terminal input registration 与相关前端定向测试通过。real-machine run `38997341490` 的 Linux remote SSH cold-start 已完成 startup/prompt marker 往返。

### Issue #105: 启动兜底的非 xterm 输入未标记为用户接管 ✅ 已修复

**严重程度**：Important（延迟恢复可能覆盖用户正在使用的终端）
**状态**：✅ 已修复；real-machine run `38997341490` 的 Linux/macOS/Windows 矩阵通过
**修复时间**：2026-10-17

**问题**：workspace 恢复延迟期间，移动端快捷键栏和 snippet/history 命令通过 session `write` 或 `terminalWriteBus` 直接发送，不经过 xterm `onData`。兜底标签仍保持 `startupFallback`，迟到的 workspace 布局恢复会把用户刚刚使用的本地 shell 替换掉。

**修复**：`useTerminal` 为直接写入和命令总线写入统一触发 `onInput`，再进入 session FIFO；xterm text/raw 输入继续沿用原有诊断回调。TerminalContainer 收到任一主动输入后清除 `startupFallback`。

**测试**：use-terminal routing 新增直接写入与命令总线写入回归，容器测试覆盖 `onInput` 到 `updateTab` 的接线；完整 `pnpm verify` 通过。

### Issue #106: 手动输入探针提示切换 ASCII 却拒绝手动模式 ✅ 已修复

**严重程度**：Minor（实机验收工具阻塞）
**状态**：✅ 已修复；真人物理键盘验收仍待执行
**修复时间**：2026-10-17

**问题**：macOS 当前输入源为中文输入法时，ASCII 重叠按键探针会提示使用 `--input-source ascii` 临时切换；但参数校验同时拒绝 `--inject manual`，手动验收无法从当前输入法安全开始。

**修复**：手动模式现在复用原生 TIS 输入源 helper，在探针开始前切换到 ASCII 键盘，完成手动轮次后恢复原输入源；切换或恢复失败都会保留明确错误，不会把未执行的轮次标记为通过。

**测试**：新增手动 ASCII overlap 的临时切换与恢复回归；输入探针定向测试 21/21 通过。当前桌面控制只能验证窗口聚焦，不能产生探针要求的真人 `keydown` 证据，因此 30 轮物理键盘、中文 IME composition 和 Option/dead key 仍保持人工待验收。

### Issue #107: shell probe 将 fish/sh 误当作 POSIX dialect ✅ 已修复

**严重程度**：Important（验收结果可能误报）
**状态**：✅ 已修复；fish/sh 独立 dialect 与实机矩阵仍待实现
**修复时间**：2026-10-17

**问题**：shell probe runner 将 `fish` 列在 POSIX shell 清单中，随后发送 `captured=$(cat)`、`if [ ... ]`、`VAR=$(...)` 等 bash/zsh 命令。fish 的赋值和条件语法不同，`sh` 也不保证 readline、编辑器和其它 POSIX 探针前置条件；失败会表现为超时或错误结果，无法证明对应 shell 的交互行为。

**修复**：`bash`/`zsh` 保留 POSIX dialect；显式请求 `fish` 或 `sh` 会在构建或启动前 fail-fast，并给出缺少 dialect 的明确错误。现有 real-machine workflow 本来只请求 bash/zsh，因此与实际执行范围一致。

**测试**：新增 runner 与 matrix 的 fish/sh fail-fast 回归；shell probe、matrix 和 dialect 合约定向测试 31/31 通过。产品终端仍可启动 fish/sh，但独立 dialect、tmux/screen 与真实 shell 矩阵仍需后续实现。

### Issue #108: 认证阶段的瞬时网络错误被当作永久认证失败 ✅ 已修复

**严重程度**：High（网络恢复后会话无法自行恢复）
**状态**：✅ 已修复；VPN/蜂窝切换和真实路由黑洞仍需 macOS 实机观察
**修复时间**：2026-10-17

**问题**：SSH 建链在认证阶段遇到网络超时或传输重置时，Rust 将错误统一序列化为 `authentication_failed`。前端按错误类型把所有认证失败视为永久错误，于是远端主机在 VPN 尚未就绪、路由暂时黑洞或睡眠唤醒后恢复时，首次连接会停在 error，必须手动点击重试。

**修复**：错误类型仍保持稳定的 `authentication_failed` 合约，但前端只在消息同时表明瞬时网络边界（timeout、connection reset/closed/refused、network unreachable、no route、broken pipe 或 transport closed）时覆盖该类型的不可重试默认；凭据被拒绝、host key、密钥/证书解析和用户取消继续立即终止。

**测试**：新增首次连接认证 timeout 与 transport reset 回归，断言自动进入 reconnecting 并在下一次连接成功；原有永久认证失败测试继续断言不创建重试计时器。前端重连定向测试 29 项、Rust SSH 定向测试 50 项通过。

### Issue #109: Windows 空白 SSH_AUTH_SOCK 阻断 Agent 回退 ✅ 已修复

**严重程度**：Important（Windows Agent 登录可用性）
**状态**：✅ 已修复；OpenSSH Agent/Pageant 仍需 Windows 实机验证
**修复时间**：2026-10-17

**问题**：Windows 桌面启动器可能继承空字符串或仅含空白的 `SSH_AUTH_SOCK`。Agent 登录路径此前把它当作显式 named pipe，调用 `connect_named_pipe` 失败后立即结束，因而不会继续尝试默认 `\\.\pipe\openssh-ssh-agent` 或 Pageant。

**修复**：新增 `non_empty_agent_pipe`，仅将包含非空白字符的值视为显式管道路径；空值统一进入默认 OpenSSH pipe → Pageant 回退链。路径内容保持原样，避免改写合法的 Windows named pipe。

**验证**：新增 Rust 回归覆盖未设置、空字符串、空白字符串和合法 named pipe；定向测试通过。真实 OpenSSH Agent、Pageant 服务和权限仍需 Windows 实机矩阵确认。

### Issue #110: Windows 绝对路径 PowerShell 未抑制启动 banner ✅ 已修复

**严重程度**：Important（Windows 本地终端启动延迟）
**状态**：✅ 已修复；PowerShell/pwsh 的真实 Windows PTY 启动仍需实机确认
**修复时间**：2026-10-17

**问题**：本地 PTY 仅对精确的 `powershell.exe` / `pwsh.exe` 名称追加 `-NoLogo`。当 `TERMINAL_DEFAULT_SHELL` 配成 `C:\\...\\PowerShell.EXE` 或 `C:\\...\\pwsh.exe` 时，完整路径绕过判断，启动 banner 会重新出现在 prompt 前，增加首次可用延迟。

**修复**：按 `/` 和 `\\` 同时切分 shell 字符串后按 basename 大小写不敏感匹配 PowerShell，覆盖 Unix 传入 Windows 风格配置路径的测试环境；`-NoLogo` 仍只追加到 PowerShell，不影响 cmd/bash/zsh。

**验证**：新增 Rust 回归覆盖裸名称、大小写变化、PowerShell 与 pwsh 的 Windows 绝对路径及 cmd/bash 负例；定向测试通过。真实 Windows ConPTY 的 banner/prompt 时序仍需实机矩阵确认。

### Issue #111: 重连状态发布时同步回调会覆盖新的手动重连 ✅ 已修复

**严重程度**：Important（会话生命周期竞态）
**状态**：✅ 已修复并通过前端状态机回归
**修复时间**：2026-10-17

**问题**：自动重连 `launch()` 原先先进入 `run()`，由 `run()` 同步发布第一条 `reconnecting` 状态，随后才把 `record.reconnectPromise` 和 `record.reconnectMode` 写回。状态监听器如果在这条回调里同步触发手动 Retry 或断开，新的重连任务会先登记自己的 promise，随后被外层自动任务的迟到 bookkeeping 覆盖。结果可能是手动重连被误标成自动重连，旧任务继续等待退避，甚至让 promise guard 失效。

**修复**：`launch()` 先安装一个 ownership promise 和 mode，再进入 `run()`；旧任务完成时仅在 ownership 仍属于自己时清理字段。这样重入的取消、手动重连和 tab close 都能通过 generation/AbortSignal 立即使旧任务失效，不会覆盖新任务。

**验证**：新增同步状态监听器触发手动重连的回归；`terminal-session-manager.test.ts`、`terminal-session-manager-reconnect.test.ts` 与 `terminal-session-wake-recovery.test.ts` 共 80 项通过。真实睡眠、VPN/蜂窝切换和跨平台实机验收边界不变。

### Issue #112: 首连 outage smoke 未等待 sshd 完全停止 ✅ 已修复

**严重程度**：Minor（验收基础设施竞态）
**状态**：✅ 已修复并重跑当前源码 SSH 矩阵
**修复时间**：2026-10-17

**问题**：首连 outage fixture 异步关闭旧 sshd，但 runner 未等待 daemon 完全退出就启动应用。若关闭稍慢，首连 case 可能在 outage 真正开始前连上，导致测试没有覆盖首次不可达状态。

**修复**：fixture 的 outage promise 增加 `ready` checkpoint，只有旧 daemon 已停止时才兑现。runner 在启动 smoke 应用前等待该 checkpoint，同时仍等待 outage promise 最终完成，确保服务恢复与 fixture 清理保持有界。

**验证**：新增回归断言 down checkpoint 先于 daemon 返回；`terminal-smoke-sshd` 与 runner 测试 56/56 通过。随后在同一 instrumented debug binary `4368d6c8…` 上重跑真实 SSH 13/13，`key-first-connect-outage` 首次连接 9629ms。此结果证明确定性 localhost outage 下首次重试成功，不替代 VPN/DNS 故障、真实合盖唤醒或跨平台实机矩阵。

### Issue #113: host-wake smoke 恢复链路出现间歇性 timer/IPC 长停顿 🔄 调查中

**严重程度**：Important（长中断恢复与验收可靠性）
**状态**：🔄 已增加诊断，并修复 reporter 超时/取消并发与 heartbeat 重试边界；底层停顿来源仍尚未在解锁的 WKWebView 中隔离
**发现时间**：2026-10-17

**现象**：旧 instrumented binary 在 `key-outage-wake-reconnect` 中 120 秒未发布 host-wake control。加入 fallback poll 后，新 binary `08ba7338…` 的一次复验记录了 `fallback-armed` 1669ms、首个 poll 1922ms、下一 poll 7056ms；此后约 57 秒无事件，至 64249ms 才恢复 poll，随后 fallback 与 reconnect-state timer 几乎同时触发，并在 64286ms 发布 checkpoint。该次用例最终在 100250ms 通过；同一 binary 再跑 wake case 用时 21492ms。事件时间由 Rust 收到 Tauri IPC 时记录，不能单独证明 JS callback、WKWebView renderer 或 IPC 中哪一层停顿。

**处理**：fallback timer 每 5 秒发 heartbeat；checkpoint promise 在途时增加一次状态事件；poll reporter 失败会输出本地诊断；host-wake timer 触发后立即清理 interval，避免 reporter 延迟导致重复触发。

**验证**：fallback/recovery 前端定向测试 20/20、typecheck、Rust `terminal_smoke` 37/37、SSH runner 38/38 通过。同一 instrumented binary 上普通 outage、wake outage 和首连 outage 3/3 通过。增量记录见 [`host-wake timer diagnostic`](verification/2026-10-17-macos-host-wake-timer-diagnostic.json)。完整 13-case、冷启动和 shell 证据仍指向旧源码，尚未按本轮工作树重采。

**2026-10-18 复验与诊断增量**：同一 `08ba7338…` binary 的三项 outage 复跑全部失败：普通 outage 与首连 outage 在 Rust watchdog 超时，wake case 在 120 秒内未发布 checkpoint，事件仅到 6673ms 的第二次 `fallback-poll`。旧 3/3 通过记录仍保留，不能覆盖本轮失败。为隔离停顿来源，新增 smoke-only loopback renderer heartbeat：runner 启动随机端口和 64 位 hex token，前端每秒及 visibility/focus 变化时用普通 `fetch` 上报序号、`performance.now()`、`visibilityState`、`hasFocus` 和 `online`，绕过 host-wake Tauri IPC；失败时附带 NDJSON 尾部。fallback 自清会记录原因，abort/cleanup reporter 失败保留 console 诊断。相关前端定向测试 80/80、Rust smoke 38/38、Node SSH/heartbeat runner 42/42、typecheck 与目标 lint 通过。

**下一步**：在 macOS WKWebView 上重跑 host-wake case，比较独立 heartbeat 与 host-wake IPC 事件；完整 SSH、冷启动和 shell 证据仍需按当前源码重采。真实合盖、VPN/蜂窝切换仍需人工实机验收。

**前台探针修复**：AppKit `NSWorkspace.shared.frontmostApplication` 在解锁/窗口启动竞态或当前锁屏会话中可能返回 `loginwindow`。macOS helper 现在在该结果下优先通过 `/usr/bin/lsappinfo front` 查询 ASN/PID，并以 `CGWindowList`/AppKit 作为回退；Node 定向测试 43/43 通过，Swift helper 真实编译通过。仍需在解锁会话中重跑验证目标窗口最终获得焦点。

**2026-10-18 当前源码复验边界**：instrumented binary `0b994b72…`（source fingerprint `dcea1783…`）的 outage/wake 复验在 macOS 前台状态不稳定时失败：一次运行前台 PID 为 `163`，后续运行前台 PID 为 `loginwindow`（3111）；同期 heartbeat 只能证明 renderer 曾上报 hidden 状态，不能用于判断 IPC 停顿。runner 已修复 AppKit helper 在目标进程尚未登记时的 code 3 瞬时竞态，并增加回归测试；仍必须在目标窗口真正可见且获得焦点的 macOS 会话中复跑完整矩阵，才能把 heartbeat/IPC 差异作为有效证据。

**2026-10-19 代码审计修复**：host-wake reporter 现在按 reporter 身份串行化底层 Tauri `invoke`。调用方超时或 abort 只结束当前等待，旧 invoke 仍留在队列中，后续 checkpoint 必须等其 settle 后才会发起；已经超时的排队 stage 会在旧 invoke 释放后丢弃，避免迟到诊断或重复 IPC。recovery 的 abort/timer cleanup 诊断在 signal 已结束时不会再发起 IPC。renderer heartbeat 增加单飞、HTTP 状态检查、AbortController cleanup，并在配置 invoke reject 或 disabled→enabled 后清理缓存以允许重试。

**本轮验证**：smoke 前端 14 个文件 129/129、host-wake/recovery 定向 29/29、renderer heartbeat 9/9、frontend typecheck、目标 ESLint/Prettier、Rust `terminal_smoke` 38/38、Node SSH/runner 契约 59/59 全部通过。当前源码尚未采集新的 GUI evidence；证据门禁对 4 份旧 current JSON 正确报告指纹不匹配，待解锁 macOS 后重建并复采。

### Issue #114: 产品 host-wake 仅依赖生命周期事件 🔄 已修复代码，实机待验收

**严重程度**：Important（合盖唤醒后的远程会话恢复）
**状态**：🔄 代码已修复，等待解锁后的 WKWebView 与真实睡眠/网络切换验证
**发现时间**：2026-10-19

**问题**：`useTerminalHostWake` 原先只监听 `visibilitychange`、`focus` 和 `online`。WKWebView 在合盖睡眠后可能保持 visible/focused，网络层也可能没有发出 `online`，导致耗尽自动重连预算的会话停留在 retryable error，用户必须手动点击重连。

**修复**：新增 15 秒低频 wall-clock 漂移检测；当 interval 实际间隔超过 16 秒时调用 `handleHostWake()`。同时监听 `pageshow` 与 `document.resume`，并在卸载时清理 interval 和事件监听器。

**验证**：hook 定向 Vitest 6/6 通过，覆盖 Page Lifecycle 事件、睡眠造成的 timer 漂移和卸载清理。真实合盖、VPN/蜂窝切换与跨平台实机矩阵仍未完成。

### Issue #115: 本地 cold-start AX readiness 不能代表 shell 已可用 🟡 已修复语义，严格终端证据待采集

**严重程度**：Important（发布证据可能把窗口就绪误读为终端就绪）
**状态**：🟡 默认本地 stopwatch 现在明确报告窗口 readiness；严格终端模式已有 marker 契约，尚无当前工作树的本地端到端实机记录
**发现时间**：2026-10-21

**问题**：`run-cold-start-stopwatch.mjs` 原先以 AX 的 Local、Connected、Terminal input 三项同时成立作为本地成功条件，并将耗时称为 terminal readiness。前端在 PTY 会话创建成功后即可发布 `connected`，而 xterm canvas 中的 shell prompt 与首个可回读输入并不稳定出现在 AX 中，因此该数字可能只代表窗口和控件已经渲染。

**修复**：stopwatch 结果拆分为 `windowReady` 与 `terminalReady`，并增加 `readinessTarget`/`readyAt`。默认本地模式保持向后兼容但标记为 `readinessTarget: window`；远程模式继续要求 marker。显式 `--readiness-target terminal` 的本地模式必须提供 marker 或 marker-check，且跳过 AX helper，把 AX 缺少 `shellPrompt` 或 helper 不可用视为诊断缺失，不会否定独立端到端证据；marker 未到达则 fail-closed。AX/Swift 探针超时会等待关闭并升级 SIGKILL，避免测量子进程泄漏。

**验证**：cold-start、remote cold-start 与 evidence 定向 Node 测试共 53/53 通过，覆盖 AX prompt 不可见、窗口已就绪但 marker 未到达、marker 成功、跨运行 marker 内容拒绝、预置 stale marker 拒绝、按 readiness target 的退出诊断和远端 marker-only 路径。旧 evidence JSON 未修改；解锁 macOS 后需用当前源码重建并采集带 `readyAt` 的新证据，不能把旧 `spawnToReadyMs` 直接称为可靠终端 ready。

### Issue #116: 严格本地 cold-start 缺少 PTY per-run marker 生产者 🟡 代码已补齐，实机证据待采集

**问题**：严格本地 terminal readiness 需要端到端 marker，但此前只有通用 stopwatch 的 marker 检查，没有一个本地 cold-start runner 能把本次运行的唯一 nonce 经前端 xterm 输入、Tauri `session_write` 和 local PTY shell 回读后再提交 marker。固定文件或仅检测 shell 已启动都不能证明该链路。

**修复**：shell probe 配置新增安全的 per-run `nonce`；`run-local-cold-start-stopwatch.mjs` 为每次运行生成随机 nonce 和隔离 marker 文件，通过 `TERMINAL_SHELL_PROBE=1` 的 `cat-eof` PTY 流程驱动真实输入，Rust 仅在完整 shell probe 成功后写入精确 marker。runner 以 `--readiness-target terminal` 调用 stopwatch，stale marker 仍 fail-closed；同时清理 `ENV`、`BASH_ENV`、`PROMPT_COMMAND`、`CDPATH`、`ZDOTDIR` 和旧 probe 配置，并将 `TERMINAL_DEFAULT_SHELL` 绑定到已验证的 bash/zsh，防止启动脚本或错误 shell 在 PTY 输入前伪造 marker。

**验证**：Node local runner/shell probe 定向测试 17/17 通过，前端 shell probe protocol 28/28 通过；新增 strict marker、环境隔离和探针 SIGKILL 回归后 cold-start/local runner 39/39 通过。尚未在解锁的 macOS GUI 上重建并采集新的 `readyAt: terminal` 证据。

### Issue #117: host-wake 延迟 continuation 误触发新一代重连 ✅ 已修复

**严重程度**：Important（远程会话恢复竞态）
**状态**：✅ 已修复并通过前端 wake recovery 回归
**修复时间**：2026-10-21

**问题**：host wake 在自动重连已发布 retryable error、但旧 ownership promise 尚未清理的同步窗口内到达时，会把恢复回调挂到旧 promise。旧任务结束后，如果用户启动新的手动或自动重连并再次进入相同的 retryable error 状态，旧回调只检查当前状态，可能错误地再启动一轮自动重连，覆盖用户动作或额外消耗重试预算。

**修复**：延迟 wake 回调同时捕获触发时的 reconnect generation；ownership settle 后只有 record 仍处于同一 generation、没有新的 ownership 且仍是 retryable error 时才执行恢复。generation 变化会使旧回调失效，现有 ownership 检查继续阻止与新重连并发。

**验证**：新增回归覆盖旧 ownership settle 前切换到新 generation 且回到 retryable error 的交错顺序；wake recovery 定向 Vitest 7/7、目标 ESLint 与 Prettier 通过。真实睡眠、VPN/蜂窝切换与跨平台实机验收边界不变。

### Issue #118: 事件监听注册挂起会令关闭终端永久等待 ✅ 已修复

**严重程度**：Important（终端标签关闭与会话资源生命周期）
**状态**：✅ 已修复并通过前端定向自动化回归
**修复时间**：2026-10-21

**问题**：`TerminalSessionManager.close()` 会等待 record 上所有启动 promise。启动流程先等待共享的 Tauri 事件监听注册；如果底层 `listen()` promise 永不 settle，generation/closed 守卫虽然能阻止后续 session create，却无法让这个启动 promise 结束，因而 tab close、workspace prune 等关闭路径会永久 pending。

**修复**：每次启动持有独立 `AbortController`，关闭 record 时取消所有在途启动；重连启动同时继承重连代际的 signal。事件注册等待在 abort 时提前 settle 为 cancelled，底层共享注册仍按 manager 生命周期完成或失败；无论迟到完成或拒绝，都不会继续创建已退休 session 或产生未处理 rejection。

**验证**：新增 `listen()` 永不完成时 `close()` 仍成功返回且不会调用 session create 的回归；`terminal-session-events`、manager、reconnect、wake recovery 定向测试 86/86，另有启动取消集合交错回归 1/1，前端 typecheck 通过。此项是前端代码路径验证，不替代真实 Tauri 事件系统的 Windows/Linux 实机验收。

**后端取消补充（2026-10-22）**：SSH 创建取消使用 Tokio `Notify` 唤醒连接命令 future。此前 waiter 在检查取消标志后才首次 poll；若另一线程恰在两步之间调用 `notify_waiters()`，通知可能丢失并令握手 future 永久等待。现在先 pin 并 `enable()` waiter，再检查取消标志，关闭该丢唤醒窗口。Rust 全量测试 221 单测 + 3 集成测试、Clippy `-D warnings` 与 fmt 检查通过。

### Issue #119: SSH host-key 预检把瞬时网络错误与永久错误混为一谈 ✅ 已修复

**严重程度**：Important（网络恢复后的首次连接可用性与主机信任安全）
**状态**：✅ 已修复；真实 VPN/DNS/路由切换与跨平台 host-key 实机矩阵仍待验收
**修复时间**：2026-10-21
**共享启动预算收口**：2026-10-22

**问题**：SSH 会话启动前的 host-key 预检失败时，前端原先把网络超时、连接重置、DNS/路由不可达与 host key 变更、凭据拒绝、known_hosts 数据损坏统一停在 error。网络短暂恢复后用户必须手动重试；反过来，若把永久信任错误当作可重试，会掩盖必须由用户处理的安全边界。主机或跳板配置在异步预检期间变化时，旧的 ready 状态还可能在同一渲染轮次短暂放行新会话。

**修复**：新增 `isRetryableSshHostKeyProbeError`，仅将明确的 timeout、connection reset/refused/closed、DNS、no route、network unavailable、broken pipe 和 transport closed 视为瞬时错误，并按 250ms、1s、3s 做有界自动重试；Windows Winsock 常见的 10054/10060/10061/11001 及对应系统文案也纳入同一分类。host key changed、invalid input、密钥解析、凭据拒绝和非超时 known_hosts 错误继续 fail-closed，同时保留手动 Retry。ready 状态绑定完整 host/jump route key，主机配置或跳板变化后立即撤销旧授权，避免旧预检结果放行新配置。

**验证**：`use-ssh-host-key-gate.test.tsx` 29/29，连接 deadline、host-key IPC、会话 manager/reconnect/wake 定向回归共 85 项通过；Rust 全量 221 单测 + 3 集成测试通过，前端 typecheck、定向 ESLint/Prettier 和 `cargo fmt --check` 通过。host-key direct/jump 预检、瞬时重试、Jump Host 串行阶段和首次五种 SSH session create 现在共享同一前端单调 10 秒预算；每次 Rust 预检最多 8 秒、session create 最多 9 秒，并在后端按剩余毫秒取较小值。TOFU、保存信任和手动 Retry 会开启新的尝试预算，自动重连不复用首连预算。跨进程仅传递相对毫秒并预留 100ms margin，属于有界预算而非跨进程硬实时 SLA；当前 macOS 锁屏，真实 VPN/DNS/路由切换、跳板和 GUI 证据仍待按当前源码复验。

### Issue #120: 证据源码指纹遗漏构建配置可造成旧证据 false-pass ✅ 已修复

**严重程度**：Important（发布验收可信度）
**状态**：✅ 已修复并通过门禁回归
**修复时间**：2026-10-21

**问题**：证据门禁的 debug source fingerprint 只覆盖前端源码、Rust 源码和部分 package/lock 文件；修改 `vite.config.ts`、Rust manifest/lock、`tauri.conf.json` 或 `build.rs` 时，构建依赖、Tauri 启动配置或最终产物可能已改变，但旧 debug 证据仍可能匹配 reviewed fingerprint。

**修复**：将 `packages/frontend/index.html`、两个前端 tsconfig、`packages/frontend/vite.config.ts`、`src-tauri/capabilities/`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`、`src-tauri/build.rs`、`pnpm-workspace.yaml`、`rust-toolchain.toml` 和 checker 自身纳入 `FINGERPRINT_PATHS`，并用契约测试锁定覆盖集合。旧 evidence JSON 不修改；当前指纹变化后仍会 fail-closed，必须解锁 macOS 重采。

**验证**：evidence gate 定向 Node 测试通过；旧 current JSON 继续因历史指纹/契约不匹配而拒绝，未用手工改证据绕过门禁。

### Issue #121: 延迟恢复可能覆盖唯一可用的本地启动兜底 ✅ 已修复

**严重程度**：High（启动后可能没有任何可用终端）
**状态**：✅ 已修复并通过前端定向自动化回归
**修复时间**：2026-10-21

**问题**：启动兜底只设置一次 2 秒 timer。若 workspace/layout 恢复在 timer 之后完成，且 host 查询超时，恢复仍可能用未解析 host 的远程布局替换本地 `startupFallback`。恢复 promise 随后成功结束，App 不会再触发一次 fallback，窗口最终只剩无法建立会话的远程标签。

**修复**：恢复完成后重新计算可用终端；如果 fallback deadline 已过且当前没有本地终端或已解析 host 的远程终端，App 会补建本地 `startupFallback`。远程布局仍保留并继续由 recovery 订阅持久化，避免用临时本地 tab 覆盖用户保存的工作区。

**验证**：App 与 workspace recovery 定向测试 29/29 通过，覆盖 host 永久 pending、恢复晚于 2 秒兜底且远程 host 不可用的组合时序；前端 typecheck、目标 ESLint 与 Prettier 通过。SSH host-key 预检与首次 session 创建的共享 10 秒预算已在 Phase 6.96 接入，具体实机边界见 Issue #119。

### Issue #122: cold-start 异步探针越过 deadline 仍可能报告成功 ✅ 已修复

**严重程度**：Important（冷启动门禁可能接受超预算结果）
**状态**：✅ 已修复并通过 Node 定向回归
**修复时间**：2026-10-21

**问题**：cold-start stopwatch 的 AX/marker 检查是异步操作。若检查跨过 `timeoutMs`，但 timeout timer 的回调尚未先执行，ready 分支可能仍返回 `ok: true`，并报告超过预算的 `spawnToReadyMs`。

**修复**：异步探针和 marker 检查结束后，在发布 ready 结果前读取一次单调时间；达到或超过 deadline 时复用统一 fail-closed 错误路径。成功结果的两个耗时字段复用该时间点，避免判定与报告使用不同时间。

**验证**：新增 timeout timer 尚未调度但异步 marker 已越过预算的确定性回归；cold-start stopwatch 与 local/remote runner 定向 Node 测试通过（35/35 及 54/54）。

### Issue #123: WKWebView Option-as-Meta 可能同时发送 Meta 序列和布局字符 ✅ 代码已修复，实机待验收

**严重程度**：Important（Option 快捷键输入污染终端）
**状态**：🟡 代码已修复；真实 Option/dead key、中文 IME 和物理键盘仍待 macOS 实机验收
**修复时间**：2026-10-21

**问题**：桌面终端启用 `macOptionIsMeta` 时，xterm keydown 已发送 `ESC` 前缀 Meta 序列，但 WKWebView 默认文本动作仍可能把 Option 布局字符（如 `ƒ`）写入隐藏 textarea。该字符不含在去重 marker 中，会与 Meta 序列一起进入 PTY。

**修复**：只对已识别的普通 Option-as-Meta 字符调用 `preventDefault()`/`stopPropagation()`；`Dead`、`Process`、keyCode 229 和 active composition 继续交给原生 composition/dead-key 流程。同步重新生成 `@baicie/xterm@0.1.7` patch 与 lock hash，并修正测试中的 paste/composition 事件时序，使每个断言对应真实 keydown/input 序列。

**验证**：xterm WebKit 输入回归 17/17，`pnpm install --frozen-lockfile --offline` 能干净应用 patch，活动 `xterm.js`/`xterm.mjs` 均无输入值相关 `console.debug`；真实 WKWebView Option/dead key、中文 IME、物理键盘重叠输入仍未验收。

### Issue #124: 取消的 host 查询可能让 loading 状态永久保持 ✅ 已修复

**严重程度**：Low（主机列表加载状态可能失真）
**状态**：✅ 已修复并通过前端自动化回归
**修复时间**：2026-10-21

**问题**：workspace 恢复对 host 查询设置超时并发出 abort，但 SQLite 查询可能一直不 settle。`loadHosts()` 原先只在 Promise 的 `finally` 中清除 `loading`，因此超时后的 store 可能永久显示仍在加载。

**修复**：host store 现在监听 `AbortSignal`，在当前 load generation 被取消时立即清除 `loading`；generation 检查防止旧请求取消时覆盖较新的查询状态。底层查询的结果提交仍受现有 signal 与 generation 守卫控制。

**验证**：新增永久 pending 查询取消后立即清理状态，以及旧请求取消不得影响新请求的回归；完整前端测试 1112/1112、typecheck、lint 通过。

### Issue #125: host-wake smoke 取消后 fixture 仍等待控制文件 ✅ 已修复

**严重程度**：Important（验收 runner 生命周期与矩阵隔离）
**状态**：✅ 已修复并通过 runner 回归
**修复时间**：2026-10-21

**问题**：host-wake SSH smoke 在收到重连 checkpoint 后停止 sshd，并等待前端发布 host-wake 控制文件。若矩阵用例超时或被取消，这个最多 120 秒的文件轮询没有接收 `AbortSignal`；app 虽已结束，reconnect/fixture 清理仍可能挂住并与下一矩阵用例重叠。

**修复**：host-wake fixture 控制等待现在接收 smoke 内部取消信号；取消时立即清理 poll timer 并拒绝等待，`fixture.stop()` 随后回收已停止的 sshd，不会启动替代 daemon。

**验证**：新增控制文件等待期间取消的回归，确认中断 promise 即时拒绝、fixture 可完成清理且不启动第二个 sshd；`terminal-smoke-sshd` 与 runner 定向测试 60/60 通过。该修复只改善验收 fixture 生命周期，不构成当前源码的 GUI host-wake 实机证据。

### Issue #126: 首次 SSH 建连迟于共享 deadline 仍可能发布 connected ✅ 已修复

**严重程度**：Important（10 秒首次启动预算与 session 生命周期）
**状态**：✅ 已修复并通过前端定向回归；当前源码真实 SSH/GUI 证据仍待重采
**修复时间**：2026-10-22

**问题**：SSH session create 的后端 timeout 虽受剩余共享预算约束，但 renderer/IPC 若延迟，前端仍可能在共享 10 秒 deadline 已耗尽后收到 session id，并继续把记录发布为 `connected`，使启动状态突破统一预算。

**修复**：session id 返回后、激活输出/lifecycle 和发布 `connected` 前，再检查首次连接的单调 deadline。若已过期，先退休 pending output/lifecycle，关闭后端 session，再交给现有可重试流程；重连尝试不复用首次 deadline。

**验证**：新增迟到 session 成功回归，确认 `connected` 不会发布且后端 close 被调用；另有 remote late-session 回归确认旧 session 被关闭后会按独立重连预算恢复到新 session。manager/reconnect/wake recovery 定向测试通过。完整 macOS cold-start、真实 SSH、物理键盘与 host-wake 证据仍需解锁 macOS 后按当前源码重采。

### Issue #127: 小数毫秒无法解码为 Rust u64 导致 SSH 启动被拒绝 ✅ 已修复

**严重程度**：High（共享连接预算启用后的首次 SSH 可用性）
**状态**：✅ 已修复并通过前端边界回归；真实 Tauri IPC 仍待实机确认
**修复时间**：2026-10-22

**问题**：`performance.now()` 使用小数毫秒，剩余启动预算因此可能是 JSON 浮点数；host-key probe 与五种 SSH session create 的 Rust 参数均为 `Option<u64>`，Tauri/serde 无法将浮点数解码成整数，导致正常启动请求报参数类型错误。

**修复**：共享 `remainingTerminalConnectionMs()` 在应用 IPC/render safety margin 后向下取整，保证 timeout 始终是非负整数且不会越过绝对 deadline。

**验证**：新增 fractional-clock 回归，确认跨层 timeout 为整数并按预期向下取整；host-key gate、deadline helper、session manager 和 launcher 对 password/key/agent/cert/jump 五种 IPC 参数的定向测试通过。完整 macOS SSH 矩阵仍需解锁后重采。

### Issue #128: 启动失败界面异步加载期间可能出现空白窗口 ✅ 已修复

**严重程度**：Important（启动失败时用户无法获知原因或重试）
**状态**：✅ 已修复并通过前端回归
**修复时间**：2026-10-22

**问题**：启动失败界面通过动态 import 延迟加载。如果错误界面 chunk 尚未返回，窗口此前没有同步内容；若 bootstrap 根节点随后卸载或 HMR dispose，迟到的成功/失败回调还可能向已废弃的 React root 渲染。

**修复**：错误发生时先同步渲染带错误信息和 Retry 的轻量兜底，动态 chunk 成功后再替换为完整界面；`startTerminalApp` 为每次启动提供带 dispose/attempt 代际守卫的 render root，阻止迟到结果重新挂载旧应用。兜底按钮复用 shadcn `Button`，错误屏幕 loader 可注入以隔离验证拒绝路径。

**验证**：Node 24.16.0 下 bootstrap 回归 12/12、前端全量 125 文件/1130 项、typecheck、目标 ESLint/Prettier 和生产构建通过。macOS 锁屏状态不影响该代码路径验证，但当前 binary 的 cold-start、真实 SSH、host-wake 和人工输入证据仍待解锁后重采。

### Issue #129: normal App chunk 永久 pending 时窗口保持空白 ✅ 已修复

**严重程度**：Important（应用启动可能无期限没有界面或重试入口）

**状态**：✅ 已修复并通过前端回归；macOS 当前源码 binary 仍待解锁后重采

**修复时间**：2026-10-22

**问题**：bootstrap 对普通 `loadApp()` 只等待动态 import 的 Promise。若 WebView 的 App chunk 永久 pending，bootstrap 不会 reject，`startTerminalApp` 也不会渲染错误界面，用户只能看到空白窗口。

**修复**：normal App loader 使用独立 8 秒 deadline；超时转为可见错误和 Retry。每次尝试携带 `AbortSignal`，dispose 或 Retry 会取消等待并清理 timer，迟到的旧 loader 结果仍受 attempt/guarded root 保护。旧错误页在新 attempt 启动期间收到的重复点击会被忽略，不会使当前 attempt 的 generation 失效。

**验证**：Node 24 bootstrap 回归覆盖永久 pending、超时 Retry、旧模块迟到结果隔离和启动中重复 Retry；bootstrap/移动工具栏定向测试 17/17、前端全量 125 文件/1131 项、typecheck、lint、目标 Prettier 与生产 bundle budget 通过。严格 cold-start、真实 SSH 与 host-wake 证据仍需解锁 macOS 后按当前源码重采。

### Issue #130: 移动端懒加载工具栏首屏只有空占位 ✅ 已修复

**严重程度**：Important（移动端首屏菜单不可用）

**状态**：✅ 已修复并通过前端回归

**修复时间**：2026-10-22

**问题**：`TopToolbar` 通过 `lazy()` 加载移动工具栏，Suspense fallback 只有空的 12px 占位。首屏模块尚未完成时，菜单按钮不存在，移动端无法打开导航抽屉。

**修复**：移动工具栏改为同步加载。该组件属于首屏导航交互，避免把菜单入口放在异步 chunk 后面。

**验证**：移动工具栏测试确认 `toolbar.menu` 和 workspace switcher 在首屏可见；Node 24 定向测试通过。

### Issue #131: 前端全量测试在默认并发下偶发 1 秒查询超时 ✅ 已修复

**严重程度**：Important（门禁偶发失败会掩盖真实回归）

**状态**：✅ 已修复并通过前端全量门禁

**修复时间**：2026-10-28

**问题**：`pnpm verify:frontend` 并行跑全量 jsdom 用例时，启动与终端类用例里 1 秒的 `findByText` 异步查询窗口会被其它 worker 抢占 CPU 拖慢，导致同一用例单独运行稳定通过、全量并行偶发超时。失败信息只指向具体断言，容易被误判成功能回归。

**修复**：`packages/frontend/vitest.config.ts` 固定 `maxWorkers: 4`，并在配置里注释说明原因；不改任何用例的超时值、断言或重试策略。

**验证**：Node 24.16.0 下前端全量 126 文件/1142 项通过（90.63s），`pnpm verify` 的 frontend 分组（ESLint、typecheck、test、build:budget）全部通过；单独运行与 4 worker 全量运行结果一致。

### Issue #132: workspace 恢复在兜底路径武装两个 debounce timer ✅ 已修复

**严重程度**：Minor（dispose 后仍可能写一次盘）

**状态**：✅ 已修复并通过前端门禁

**修复时间**：2026-10-28

**问题**：`startWorkspaceRecovery` 结束时若走「后端日志为空但已有标签」的路径，`schedule()` 已经武装了 debounce timer，紧随其后的 `if (pending)` 又武装一个并覆盖 `timer` 句柄，前一个成为孤儿——`flush()` 与 `dispose()` 都清不掉它，释放之后仍可能执行一次 `saveLayout`。

**修复**：第二次武装改为 `if (pending && timer === null)`，走 schedule 路径时复用同一个 timer。

**验证**：新增回归用 `setTimeout`/`clearTimeout` spy 统计「已武装未清除」句柄，断言恢复结束只有 1 个、dispose 后为 0、之后不再额外写盘；把守卫还原成 `if (pending)` 时该用例变红（`expected 2 to be 1`）。定向测试 21/21、前端全量门禁通过。

### Issue #133: 隐藏窗口的后台轮询被误判为主机唤醒 ✅ 已修复

**严重程度**：Minor（后台重复触发会话恢复）

**状态**：✅ 已修复并通过前端门禁

**修复时间**：2026-10-28

**问题**：host-wake 用 15 秒轮询加 16 秒漂移阈值检测「定时器被挂起」；但窗口隐藏时浏览器与 WKWebView 会把后台定时器节流到 ≥16 秒，于是每次后台轮询都被判成睡眠漂移，持续触发 `handleHostWake()`。

**修复**：漂移判定只在 `document.visibilityState === 'visible'` 时执行（隐藏期间的恢复由重新可见时的 `visibilitychange` 覆盖），`lastPollAt` 仍无条件更新；elapsed 改用 `Math.abs`，避免墙钟回拨把差值变负导致漏判。

**验证**：新增用例断言隐藏态两轮 40 秒漂移不触发、切回可见的 `visibilitychange` 恰好触发 1 次；还原实现时该用例变红。定向测试 7/7、前端全量门禁通过。

### Issue #134: 唤醒触发的重连没有冷却与频率上限 📋 待评估

**严重程度**：Minor（设计权衡，未改代码）

**现状**：每次 focus / online / pageshow / resume / visibilitychange / 漂移都会调用 `handleHostWake()`，被命中的记录重开完整重试预算（自动重连的 `attempts = maxAttempts`），全链路没有冷却窗口或单位时间上限。

**评估结论**：单次用户动作重置一次预算属当前设计意图（唤醒意味着网络刚恢复，值得再试）；Issue #133 修复后后台风暴路径已消除。暂不引入冷却，避免与既有唤醒语义冲突。若后续出现「反复切窗导致死网络持续重连」的实测，再按记录级 `lastWakeAt` 加 ≥10 秒冷却。

### Issue #135: host-key 预检探测不接受 AbortSignal 📋 待评估

**严重程度**：Minor（资源占用有界）

**现状**：`runSshHostKeyGateProbe` 与 `probeSshHostKey*` 只接受 `timeoutMs`；组件卸载、routeKey 切换或 cancel 之后，只用 operation 计数丢弃结果，后端 TCP/SSH 握手仍跑到自身超时（受连接预算约束，最多约 10 秒）。

**评估结论**：当前实现保证旧结果不会写回，不会产生错误状态，后端最坏占用也被 10 秒预算兜住。真正的取消需要把 signal 串到 Rust 命令侧（复用连接取消的墓碑机制），属独立改动，本轮不做。

### Issue #136: workspace journal 在每次 store 变更时同步写 📋 待评估

**严重程度**：Minor（性能）

**现状**：`useAppStore.subscribe(schedule)` 没有选择器，任意 store 变更都会 `JSON.stringify` 整个布局并写入 localStorage，同时重置 debounce，连续变更会把数据库落盘推迟到空闲。

**评估结论**：journal 的价值在于进程崩溃或被杀时仍有兜底，写入必须保持同步；把它挪进 debounce 会削弱崩溃恢复。若要优化，应按序列化结果去重，而不是延迟写入。本轮不改。

### Issue #137: 「创建成功但已 exit」分支返回 cancelled 经核对非缺陷 ✅ 结论记录

**来源**：2026-10-28 只读审计提出（认为 sessionId 残留、UI 无终态、后端会话未关闭）。

**核对结论**：`lifecycle.apply()` 在 `sessionToTab` 已登记时会走 `markTerminalTerminated()`，它会清空 `record.sessionId`、断开 io、把 `[process exited with code N]` 写入面板并把状态置为 `disconnected`。该分支返回 `'cancelled'` 只是拒绝自动重连——进程已经退出，重连只会再次退出。全仓 `'cancelled'` 只有 `terminal-session-manager-reconnect.ts:181` 一处消费，不产生悬挂 promise。

**处置**：不修改代码，仅记录结论，避免后续审计重复提出。

### Issue #138: 启动兜底在 hosts 未加载时注入本地标签经核对是设计行为 ✅ 结论记录

**来源**：同一轮只读审计（认为「已恢复的远端标签被判不可用，凭空多一个 Local 标签」）。

**核对结论**：`App.test.tsx` 的 `opens a local fallback when recovery restored a remote tab without its host` 与 `restores a local fallback when delayed recovery leaves only an unavailable remote tab` 两例明确锁定该行为——远端标签引用不到 host 时保留标签、同时补一个可用本地终端，而不是留给用户一个打不开的面板。按 hostId 移除判据的改动会让这两例变红，属于改变产品语义。

**处置**：该改动已回退，本轮不保留。若未来要区分「host 被删除」与「host 查询失败」，应在恢复路径显式传递 host 加载状态，而不是删掉兜底判据。

### Issue #139: 浅色模式终端默认主题是米黄背景的 solarized-light ✅ 已修复

**严重程度**：Minor（观感）

**现状**：`defaultSettings.terminalThemeLight` 是 `solarized-light`，背景 `#fdf6e3` 是米黄/奶油色，启动第一印象像「终端默认颜色发黄」。顺带查清解析路径：`theme='dark'` 取 `terminalThemeDark`（`terminal-container/container.tsx:67-68` → `use-terminal-active-preset.ts:15-19`），历史字段 `terminalTheme` 在解析路径上从不被读取，所以它的默认值未动。

**修复**：默认改 `github-light`（背景 `#ffffff`）。存量做一次性迁移：新增 `terminalThemeLightMigrated` 标记，仅当存量值仍等于旧默认 `solarized-light` 且未迁移时改写并写回；之后用户主动选回 `solarized-light` 不会被再次改写；全新安装不写库、只在内存标记完成，避免首次保存前的选择被覆盖。设置面板的展示回退值同步改为 `github-light`。

**已知代价**：升级瞬间值恰好是 `solarized-light` 的用户会被改一次（即使那是他主动选的）；用本版本之前的备份/同步数据恢复会再迁移一次。标记位落地后不再发生。

**验证**：`service/database/settings.test.ts` 5 例（新装默认、旧数据迁移并写回、迁移后用户回归保持、新装保存路径、旧装非旧默认只补标记）；前端全量 1162 项通过。

### Issue #140: 本地终端启动把 Shell Integration 脚本回显成一行可见命令 ✅ 已修复

**严重程度**：Important（观感 + 误解成本）

**现状**：本地 PTY 启动后把 `__TI_A`/`__TI_B` 片段当作键盘输入写进 PTY，shell 回显整行，用户看到 `__TI_A(){ printf '\033]133;D;%s\007' ... }; autoload -Uz add-zsh-hook; ...` 这样一串看不懂的命令。功能本身正常（发 OSC 133;A/B/D 与 OSC 7，前端据此显示「上一条命令失败 (exit N)」与当前目录）。

**修复**：不再往 PTY 打字，改从 shell 启动路径注入（`src-tauri/src/session/shell_startup.rs`）：
- zsh：`ZDOTDIR` 包装目录，`.zshenv/.zprofile/.zshrc/.zlogin` 各自先 source 用户真实同名文件（存在才 source），`.zshrc` 再装 `add-zsh-hook` 钩子；保留 `-l` 登录语义。
- bash：`--rcfile` 包装文件；因为登录 bash 会忽略 `--rcfile`，去掉 `-l` 后在同文件内按真登录 shell 顺序重放 `/etc/profile` → `~/.bash_profile`/`~/.bash_login`/`~/.profile`（**三选一**）→ `~/.bashrc`，最后装钩子。
- 包装文件由纯函数生成，临时目录 0700，会话结束（EOF 与 close 两条路径）删除，另有 `Drop` 兜底。
- 仍然不使用 `trap ... DEBUG`（Issue #96 的结论不变）。

**两个必须记住的实现细节**：
1. 包装 `.zshrc` 会先恢复真实 `ZDOTDIR` 再 source 用户 rc。否则 `compinit` 会把 `.zcompdump` 写进待删的临时目录（实测复现），既丢缓存又污染目录；顺带让自定义 `ZDOTDIR` 的用户也能被正确 source。
2. 去掉 `-l` 后必须自建登录序列：macOS 的 `/etc/profile` 承载 `path_helper`，不重放就会让 bash 用户丢掉登录 PATH。实测包装 rcfile 与真实 `bash -l -i` 的 PATH **逐字节一致**（11 项、重复 0）。

**验证**：真实 PTY 转录中 `__TI_A` 字面量 0 次，`]133;A`/`]133;D;`/`]7;file://` 正常；用户 `.zshrc`/`.bashrc` 与 alias 仍生效；`cargo test --lib session::` 112 项通过。

### Issue #141: SSH 远端 Shell Integration 仍把片段打进远端 PTY 📋 待立项

**严重程度**：Minor（观感，且 host 级开关默认 `off`）

**现状**：Issue #140 只修本地终端。远程 SSH 会话仍由 `compose_startup_command` 把片段写进远端 PTY（`src-tauri/src/session/ssh.rs`），开关打开时同样会回显。

**为什么本轮不做**：静默方案要在远端落包装文件（远端 `ZDOTDIR` / `--rcfile` 需要用 SFTP 写入并在断开时清理），涉及远端文件系统权限与清理失败的处理，属于独立立项范围。


