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

_文档创建时间: 2026-03-19_
---

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

- `src/components/top-toolbar/index.tsx` 已处理 macOS traffic lights 偏移
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

### Issue #26: macOS WKWebView 重叠按键丢失字符 🟡 修复版 core 已恢复，物理回归待完成

**严重程度**: High
**状态**: 🟡 代码路径已恢复为 `@baicie/xterm@0.1.7`；真实 WKWebView 物理重叠按键、dead key 与 IME 仍需验收
**影响功能**: 终端输入（local / SSH / serial 共用 `useTerminal`）
**浏览器**: Safari、macOS Tauri 内置 WKWebView（纯 WebKit，不含 Chrome/Chromium 内核）
**修复时间**: 2026-05-02（历史 fallback）；2026-08-20（修复版 core 恢复并锁定）

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

**溯源与契约**：`0.1.7` 运行时/CSS/typings 与带源码的 `0.1.6` 发布物逐字节一致；可审计的上游基线是 xterm.js commit `34e017935581b6e0081b0e2bebe53e3193b85be7`（6.0.0 发布后的开发主线），不是 npm 官方 6.0.0 源码。`package.json` 精确固定 `0.1.7`，lockfile 记录不可变 SHA-512 integrity；`xterm-package-contract.test.ts` 禁止直接依赖官方 core，并验证 Vite 将修复版 core 与官方 addons 分开打包；错误声明上游模块名的 fork typings 通过 `src/types/xterm.d.ts` 桥接。

**自动验证边界**：依赖契约、输入 FIFO 不改写/不重复、前端 79 个测试文件/675 项、typecheck 与 production build 可自动验证，但 jsdom、合成 `KeyboardEvent`、`term.input()` 或普通自动键入都不能复现 WKWebView 的真实原生事件时序。发布前必须在 macOS Tauri WKWebView 中多轮近同时按下物理 `a/s/d`，精确确认 PTY 收到 `asd` 且不丢不重，并覆盖快速连续输入、key rollover、CapsLock、Option/dead key、中文 IME 与 Ctrl+C。

**剩余维护风险**：`0.1.7` 每次输入仍会执行 11 处 `console.debug`，npm `repository` 还是占位地址且发布物没有源码/source map。后续应从可追溯仓库基于上述上游 commit 发布去日志版本，并保留真实 WebKit 回归；在此之前不得用官方 core 替换。

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
**状态**: macOS 本地 PTY/Tauri/xterm 核心链路已修复并通过真实 smoke，WKWebView 兼容 core 已恢复；物理重叠按键、SSH、跨平台与硬件矩阵待验收
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
- macOS 真实 `portable-pty` 自动化 round-trip 使用隔离的 `/bin/sh -c` 测试 shell，覆盖 PTY 默认回显、`read` 精确接收中文/emoji、shell 内 `stty size` 读取 `31 97` 及正常退出等待；该测试直接驱动系统 PTY，不是 mock，也不加载用户 profile。
- Rust 112 个单测 + 2 个桌面配置集成测试通过，覆盖 ACK 进展刷新 watchdog、完全无 ACK 超时、over-ACK、SSH writer fatal completion/有界关闭、PTY 生命周期与 smoke 命令边界；`cargo fmt --check` 与 Clippy `-D warnings` 通过。
- 恢复兼容 core 后完整 `pnpm verify` 通过：前端 79 个文件/675 项、Team Server 25 个文件/103 项、Rust 112 个单测 + 2 个桌面配置集成测试，及 lint/typecheck/build/bundle/fmt/Clippy/478 文件规模门禁；首屏/总 gzip 为 108.16/545.92 KB。
- 修复后的标准 Tauri/xterm smoke 已通过：shell 命令精确生成 8,388,608 字节，xterm 中观察到 `LOAD_END`，随后命令 `AFTER_LOAD_OK` 仍可见；resize 后 shell 的 `stty size` 返回 `31 97`，xterm 为 97 列 × 31 行。恢复 `@baicie/xterm@0.1.7` 并重新构建 Tauri 调试二进制后的最新运行耗时 562 ms，三个可见性标记均为 true。该结果不等同于独立逐字节统计 parser 消费了全部 8 MiB，也不证明物理重叠按键。

**仍需外部验证**:

- [x] 前端 `onBinary` → `Uint8Array` → Tauri `Vec<u8>` 及文本/raw 共用 FIFO 的代码和服务边界回归。
- [ ] 真实 xterm/Tauri 端到端原始输入协议，覆盖 SGR mouse、bracketed paste 和非 UTF-8 字节。
- [x] macOS 系统 PTY 自动化 smoke：登录 shell、默认回显、`read` Unicode、`stty size` 与正常退出。
- [x] Tauri/xterm 中的 macOS 基础本地 PTY：登录 zsh、普通命令、Unicode、Ctrl+C 与 `stty size`。
- [x] 用修复后调试包复跑 8 MiB 高频输出，确认 `LOAD_END`、后续命令和 resize 往返仍可用。
- [ ] 在 macOS WKWebView 多轮近同时按物理 `a/s/d` 并确认 PTY 不丢不重；补快速连续输入、Option/dead key、中文 IME、vim/nano、连续 resize、SGR mouse、bracketed paste 与非 UTF-8 原始输入实测。
- [ ] 可用 SSH 服务的 password/key/agent/cert/Jump 与断线重连。
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
**状态**: ✅ 已修复；真实冷启动耗时仍需 Tauri 实机测量
**发现/修复时间**: 2026-08-22

**问题**:

- `startWorkspaceRecovery()` 先等待工作区加载，再等待主机加载；两条独立的 SQLite 读取路径会叠加首屏恢复延迟，影响打开应用后快速进入终端。

**修复**:

- 工作区与主机加载现在并行启动；workspace id 确定后立即开始布局读取，并在 hosts 加载完成后统一过滤已删除主机，保持恢复数据一致性。

**验证**:

- 新增并行启动与布局提前读取回归，全量前端 96 个测试文件/816 项通过；lint、typecheck、build 和源码规模门禁通过。
- 冷启动到首个终端的 10 秒目标仍需在真实 Tauri/macOS、Windows/Linux 和真实数据库环境中测量；最新 macOS 调试 smoke 的连接与首轮终端流程约 6 秒通过。

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

_本节最后更新: 2026-08-26_
