# Terminal 项目 Issues 追踪

> 基于 2026-03-19 代码审查生成
> 对应文档：`docs/design.md` 和 `docs/todo.md`

---

## 一、关键问题 (Critical)

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

### Issue #5: Agent 认证未实现 🟡

**严重程度**: 中
**状态**: 🟡 直接返回错误
**影响功能**: SSH Agent 转发

**问题描述**:

```117:125:src-tauri/src/terminal.rs
#[tauri::command]
pub async fn ssh_connect_agent(...) -> Result<String, String> {
    Err("Agent authentication not implemented".to_string())
}
```

**建议**:

- Unix: 读取 `$SSH_AUTH_SOCK`
- Windows: 使用 Pageant 或 Windows OpenSSH Agent
- macOS: 使用 Keychain 或 ssh-agent

---

### Issue #6: 主机链 (Jump Host) 未实现 🟡

**严重程度**: 中
**状态**: 🔴 未实现
**影响功能**: SSH 跳板机连接

**设计文档**: `docs/design.md` Section 3.3
**建议**:

- 实现 SSH 代理跳转 (ProxyJump)
- 支持配置跳板机连接序列
- 需要在连接时建立跳板机会话，再通过它连接目标主机

---

## 三、一般问题 (Minor)

### Issue #7: 命令快速补全未实现 🟢

**严重程度**: 低
**状态**: 📋 待开发
**影响功能**: 终端命令补全

**问题描述**:
根据 `docs/todo.md` Section 2.5:

- ✅ 历史记录存储已实现
- ✅ 历史记录 UI 已实现
- ❌ 上下键快速补全命令未实现

**建议**:

- 监听终端按键事件
- 根据当前输入匹配历史命令
- 使用上/下箭头导航

---

### Issue #8: Vault 加密存储未实现 🟢

**严重程度**: 低
**状态**: 🔴 未实现
**影响功能**: 敏感信息加密

**现状**:

- `src/view/vaults/vaults-view.tsx` 只是占位符
- 没有加密库依赖
- 没有主密码机制

**建议**:

- 使用 AES-256-GCM 加密敏感字段
- 使用 Argon2 或 PBKDF2 派生密钥
- 参考: `ring`, `aes-gcm`, `argon2` crates

---

### Issue #9: 命令面板功能不完整 🟢

**严重程度**: 低
**状态**: 🟡 部分实现
**影响功能**: 快速操作

**现状**:

- ✅ 快捷键 Ctrl+J 打开命令面板
- ❌ 搜索主机未实现
- ❌ 快速执行 Snippet 未实现

**建议**:

- 实现主机搜索功能
- 实现 Snippet 快速执行

---

### Issue #10: ssh_resize 函数为空 🟢

**严重程度**: 低
**状态**: ⚠️ 未实现
**影响**: 终端窗口大小调整

```219:227:src-tauri/src/terminal.rs
#[tauri::command]
pub async fn ssh_resize(
    _state: tauri::State<'_, SharedStateType>,
    _session_id: String,
    _cols: u16,
    _rows: u16,
) -> Result<(), String> {
    Ok(())
}
```

**问题**: SSH PTY resize 没有实际生效

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
| SSH 密钥认证  | 🟡 部分实现 | 后端未完成密钥解析 |
| SFTP 文件传输 | 🔴 未实现   | 后端全为占位符     |
| 端口转发      | 🟡 UI 完成  | 后端未实现         |
| 命令历史      | ✅ 已实现   | 完整实现           |
| Snippet       | ✅ 已实现   | 完整实现           |
| 分屏模式      | ✅ 已实现   | 完整实现           |

### Phase 3/4 - 高级功能

| 功能         | 状态                   |
| ------------ | ---------------------- |
| Agent 转发   | ✅ 已实现 (2026-03-19) |
| 主机链       | ✅ 已实现 (2026-03-19) |
| Vault 加密   | ✅ 已实现 (2026-03-19) |
| 命令面板     | ✅ 已实现 (2026-03-19) |
| 多工作区     | ✅ 已实现 (2026-03-19) |
| 跨设备同步   | ✅ 已实现 (2026-03-19) |
| 串口连接     | ✅ 已实现 (2026-03-20) |
| 团队协作     | 📋 待开发              |
| SSH 证书认证 | 📋 待开发              |
| 高级脚本     | 📋 待开发              |

---

## 五、修复优先级

### P0 - 必须修复 (影响核心功能)

- [x] **Issue #1**: 实现 SFTP 后端功能 ✅
- [x] **Issue #2**: 实现 SSH 密钥认证后端 ✅

### P1 - 应该修复 (影响用户体验)

- [x] **Issue #3**: 实现端口转发后端 ✅
- [x] **Issue #4**: 清理 Rust 编译警告 ✅

### P2 - 建议修复 (增强功能)

- [x] **Issue #5**: 实现 Agent 认证 ✅
- [x] **Issue #6**: 实现主机链功能 ✅
- [x] **Issue #7**: 命令快速补全 ✅
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
_最后更新: 2026-03-24 - 完善视图集成，终端/SFTP/Vaults/端口转发/命令面板_

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
const { Terminal } = require('@xterm/xterm')
const { FitAddon } = require('@xterm/addon-fit')
const { SearchAddon } = require('@xterm/addon-search')
const { WebLinksAddon } = require('@xterm/addon-web-links')

// 修复后 (正确)
import { Terminal } from '@xterm/xterm'
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
完全移除 `react-xtermjs` 依赖，直接使用原生 `@xterm/xterm`：

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

- `src/view/logs/index.tsx` - 日志视图占位符
