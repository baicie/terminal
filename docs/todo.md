# Terminal 项目待办事项

> 基于设计文档 `docs/design.md` 整理的待办事项
> 更新时间：2026-03-19（根据代码审查更新）

---

## 一、当前开发状态概览

### Phase 1 - MVP (最低可行产品) ✅ 已完成

| 功能     | 状态      | 说明                |
| -------- | --------- | ------------------- |
| SSH 连接 | ✅ 已实现 | 通过 russh 服务实现 |
| 密码认证 | ✅ 已实现 | 支持密码认证方式    |
| 终端模拟 | ✅ 已实现 | 使用 xterm.js       |
| 多标签页 | ✅ 已实现 | AppStore 管理 tabs  |
| 主机保存 | ✅ 已实现 | SQLite 存储         |
| 组管理   | ✅ 已实现 | 支持嵌套组          |
| 收藏夹   | ✅ 已实现 | 侧边栏展示收藏      |

---

## 二、待实现功能清单

### Phase 2 - 核心功能 ✅ 已完成

> 2026-03-19 完成 Phase 2 所有核心功能

| 任务             | 描述                                                                       | 状态                               |
| ---------------- | -------------------------------------------------------------------------- | ---------------------------------- |
| SSH 密钥认证支持 | 前端已支持选择 key 认证方式                                                | ✅ 前端已实现                      |
| 密钥文件选择器   | 添加 UI 用于选择本地私钥文件                                               | ✅ 已实现 (使用 Tauri dialog 插件) |
| 密钥认证后端     | 使用 `russh::keys::decode_openssh` 解析私钥并调用 `authenticate_publickey` | ✅ 已实现 (2026-03-19)             |
| 加密私钥支持     | 支持带密码的加密私钥                                                       | ✅ 已实现                          |

#### 2.2 SFTP 文件传输 ✅ 已完成

| 任务            | 描述                                          | 状态                   |
| --------------- | --------------------------------------------- | ---------------------- |
| SFTP 服务端实现 | Rust 后端使用 `russh-sftp` 实现完整 SFTP 支持 | ✅ 已实现 (2026-03-19) |
| SFTP 组件重构   | 文件浏览器 UI 已实现                          | ✅ 已实现              |
| 文件上传功能    | 支持上传本地文件到远程服务器                  | ✅ 已实现              |
| 文件下载功能    | 支持下载远程文件到本地                        | ✅ 已实现              |
| 目录浏览        | 远程目录树形结构展示                          | ✅ 已实现              |
| 文件操作        | 删除、重命名、移动等操作                      | ✅ 已实现              |

#### 2.3 本地终端 ✅ 已实现

| 任务         | 描述                      | 状态                          |
| ------------ | ------------------------- | ----------------------------- |
| 本地终端支持 | Rust 后端实现本地 PTY     | ✅ 已实现 (使用 portable-pty) |
| 本地终端 UI  | 支持创建本地 Shell 标签页 | ✅ 已实现                     |

#### 2.4 端口转发 ✅ 后端基础实现

| 任务         | 描述                        | 状态                               |
| ------------ | --------------------------- | ---------------------------------- |
| 本地端口转发 | Local Port Forwarding (-L)  | ✅ 已实现 (2026-03-19)             |
| 远程端口转发 | Remote Port Forwarding (-R) | ⚠️ 基础框架已实现                  |
| 动态端口转发 | SOCKS 代理 (-D)             | ⚠️ 基础框架已实现                  |
| 转发管理界面 | 查看和管理活动转发          | ✅ 已实现 (PortForwardDialog 组件) |
| 端口转发后端 | TCP 监听器框架              | ✅ 已实现 (2026-03-19)             |

#### 2.5 命令历史 ✅ 已完成

| 任务         | 描述                | 状态                                  |
| ------------ | ------------------- | ------------------------------------- |
| 历史记录存储 | SQLite 存储命令历史 | ✅ 已实现                             |
| 历史记录 UI  | 展示和搜索历史命令  | ✅ 已实现 (CommandHistoryDialog 组件) |
| 快速补全     | 上下键快速补全命令  | ✅ 已实现 (2026-03-19)                |

#### 2.6 Snippet ✅ 已完成

| 任务            | 描述                      | 状态                             |
| --------------- | ------------------------- | -------------------------------- |
| Snippet 存储    | 数据库已建表，已完善 CRUD | ✅ 已实现                        |
| Snippet 管理 UI | 添加/编辑/删除代码片段    | ✅ 已实现                        |
| Snippet 执行    | 快速执行保存的脚本        | ✅ 已实现                        |
| 变量支持        | Snippet 中支持变量替换    | ✅ 已实现 (变量解析和替换对话框) |

#### 2.7 分屏模式 ✅ 已实现

| 任务     | 描述                 | 状态      |
| -------- | -------------------- | --------- |
| 水平分屏 | 上下分割终端视图     | ✅ 已实现 |
| 垂直分屏 | 左右分割终端视图     | ✅ 已实现 |
| 分屏管理 | 创建、关闭、切换分屏 | ✅ 已实现 |

---

### Phase 3 - 高级功能 ✅ 已完成

> 2026-03-19 完成 Phase 3 所有高级功能

#### 3.1 Agent 转发 ✅ 已实现 (2026-03-19)

| 任务           | 描述                                   | 状态      |
| -------------- | -------------------------------------- | --------- |
| SSH Agent 支持 | 读取 SSH_AUTH_SOCK 连接本地 Agent      | ✅ 已实现 |
| Agent 转发     | 通过 Channel 转发 Agent 请求           | ✅ 已实现 |
| 后端 Handler   | 实现 server_channel_open_agent_forward | ✅ 已实现 |
| 前端 UI        | Agent 认证选项 (authType: "agent")     | ✅ 已实现 |

#### 3.2 主机链 (Jump Host) ✅ 已实现 (2026-03-19)

| 任务               | 描述                           | 状态      |
| ------------------ | ------------------------------ | --------- |
| Jump Host 配置     | 主机配置 jumpHostId 字段       | ✅ 已实现 |
| Jump Host 选择器   | UI 下拉菜单选择跳板机          | ✅ 已实现 |
| Jump Host 认证覆盖 | 可选 jumpHostAuthType          | ✅ 已实现 |
| 后端连接逻辑       | channel_open_direct_tcpip 实现 | ✅ 已实现 |

#### 3.3 Vault 加密存储 ✅ 已实现 (2026-03-19)

| 任务       | 描述                  | 状态      |
| ---------- | --------------------- | --------- |
| Vault 后端 | AES-GCM + Argon2 加密 | ✅ 已实现 |
| Vault 服务 | 创建/解锁/锁定金库    | ✅ 已实现 |
| 凭证存储   | 主机密码/私钥加密存储 | ✅ 已实现 |
| 前端服务   | vault.ts 提供统一 API | ✅ 已实现 |

#### 3.4 命令面板 ✅ 已实现 (2026-03-19)

| 任务         | 描述                   | 状态      |
| ------------ | ---------------------- | --------- |
| 主机搜索     | 快速搜索和连接主机     | ✅ 已实现 |
| Snippet 执行 | 快速搜索和执行代码片段 | ✅ 已实现 |
| 命令历史     | 搜索历史命令           | ✅ 已实现 |
| 快捷操作     | 新建终端、分屏等       | ✅ 已实现 |
| 键盘导航     | ↑↓/Enter/Esc/Tab       | ✅ 已实现 |

#### 3.5 多工作区 ✅ 已实现 (2026-03-19)

| 任务         | 描述                   | 状态      |
| ------------ | ---------------------- | --------- |
| 工作区管理   | 创建、删除、切换工作区 | ✅ 已实现 |
| 工作区切换器 | 下拉菜单快速切换       | ✅ 已实现 |
| 布局保存     | 分屏和标签页布局       | ✅ 已实现 |
| 数据库支持   | workspaces 表          | ✅ 已实现 |

#### 3.6 跨设备同步 ✅ 已实现 (2026-03-19)

| 任务           | 描述                       | 状态                   |
| -------------- | -------------------------- | ---------------------- |
| 导出数据       | 导出到 JSON 文件           | ✅ 已实现              |
| 导入数据       | 从 JSON 文件导入           | ✅ 已实现              |
| Merge/Replace  | 两种导入模式               | ✅ 已实现              |
| 导入预览       | 预览导入内容               | ✅ 已实现              |
| Snippet 包支持 | 支持 snippet_packages 导入 | ✅ 已实现 (2026-03-19) |
| 设置导出       | 导出应用程序设置           | ✅ 已实现 (2026-03-19) |

### Phase 4 - 企业功能 ⚠️ 部分完成

#### 4.1 串口连接 ✅ 已实现 (2026-03-20)

| 任务     | 描述                               | 状态      |
| -------- | ---------------------------------- | --------- |
| 串口列表 | 枚举系统串口设备                   | ✅ 已实现 |
| 串口配置 | 波特率、数据位、停止位、校验、流控 | ✅ 已实现 |
| 串口终端 | 串口连接终端界面                   | ✅ 已实现 |
| 串口写入 | 支持回车发送和原始发送             | ✅ 已实现 |

#### 4.2 团队协作 📋 待开发

| 任务     | 描述                   | 状态      |
| -------- | ---------------------- | --------- |
| 团队共享 | 共享主机配置给团队成员 | 📋 待开发 |
| 权限管理 | 设置读写权限           | 📋 待开发 |

#### 4.3 SSH 证书认证 📋 待开发

| 任务     | 描述             | 状态      |
| -------- | ---------------- | --------- |
| 证书支持 | SSH 证书认证方式 | 📋 待开发 |
| 证书管理 | 颁发和管理证书   | 📋 待开发 |

#### 4.4 高级脚本 ✅ 已实现 (2026-03-23)

| 任务     | 描述                   | 状态                                  |
| -------- | ---------------------- | ------------------------------------- |
| 脚本调度 | 定时执行脚本任务       | ✅ 已实现 (manual/once/interval/cron) |
| 批量执行 | 批量向多台主机发送命令 | ✅ 已实现                             |
| 脚本输出 | 收集和分析脚本输出     | ✅ 已实现                             |

---

## 三、技术优化待办

## 三、技术优化待办

### 3.1 Rust 后端优化

| 任务            | 描述                                 | 状态                         |
| --------------- | ------------------------------------ | ---------------------------- |
| 编译警告清理    | cargo check 产生大量 unused 代码警告 | ✅ 已修复                    |
| 错误处理优化    | 完善错误类型和错误信息               | 📋 待优化                    |
| 连接池          | SSH 连接池管理                       | 📋 待优化                    |
| 并发支持        | 多连接并发管理                       | ✅ 已实现 (使用 tokio Mutex) |
| ssh_resize 实现 | PTY 大小调整 (使用 escape sequence)  | ✅ 已实现                    |

### 3.2 前端优化

| 任务       | 描述                                   | 状态                 |
| ---------- | -------------------------------------- | -------------------- |
| 主题系统   | 完善明暗主题切换                       | ✅ 已实现            |
| 终端配置   | 字体、颜色等终端配置 UI                | ✅ 已实现            |
| 搜索功能   | 终端内搜索 (xterm search addon 已集成) | ✅ 已测试            |
| 国际化完善 | 完善中英文翻译                         | ✅ 已实现 (en/cn/fr) |

### 3.3 xterm.js 插件增强

> 参考 `docs/xterm.md` 了解完整的 xterm.js API

| 任务           | 描述                                   | 状态                   | 推荐度     |
| -------------- | -------------------------------------- | ---------------------- | ---------- |
| SerializeAddon | 序列化终端内容，支持日志导出、会话录制 | ✅ 已实现 (2026-03-23) | ⭐⭐⭐⭐⭐ |
| ClipboardAddon | 改善剪贴板交互，支持多行选择复制       | ✅ 已实现 (2026-03-23) | ⭐⭐⭐⭐   |
| ProgressAddon  | 显示终端进度条 (OSC 9;4)               | ✅ 已实现 (2026-03-23) | ⭐⭐⭐     |
| WebGL 渲染     | 使用 WebGL 加速渲染                    | ✅ 已安装              | ⭐⭐⭐     |
| 连字字体       | 编程连字字体支持                       | ✅ 已安装              | ⭐⭐       |

### 3.4 已知问题

| 问题                   | 描述                                            | 状态                     |
| ---------------------- | ----------------------------------------------- | ------------------------ |
| SFTP 后端未实现        | 所有 SFTP 函数都是占位符                        | ✅ 已实现 (2026-03-19)   |
| SSH 密钥认证后端未完成 | create_and_authenticate 未使用 private_key 参数 | ✅ 已实现 (2026-03-19)   |
| 端口转发后端未实现     | UI 完整但无实际转发逻辑                         | ✅ 基础实现 (2026-03-19) |
| Rust 编译警告          | 大量 dead_code 和 unused_mut 警告               | ✅ 已修复                |

---

## 五、已完成的开发工作

### 2026-03-24 完成的工作 (第六批次)

1. **Terminal 容器完善** - 重写 `src/view/terminal/terminal-container.tsx`
   - xterm.js 完整初始化（所有插件）
   - SSH 连接：调用 `sshService.connect` + `startShell`
   - 本地终端：调用 `sshService.startLocalShell`
   - 串口连接：调用 `serialService.connect`
   - 数据监听：`sshService.onData` / `serialService.onData`
   - 命令历史导航（↑↓）
   - 终端大小调整（ResizeObserver + fitAddon）
   - 状态栏显示（连接/连接中/断开）
   - 新增 `src/service/terminal-emitter.ts` 用于命令面板写入终端
   - **修复 xterm.js v6 兼容性问题**：移除不兼容的 `CanvasAddon`，改用 `WebGLAddon`；移除废弃的 `setOption`；添加 `isMountedRef` 防止竞态条件

2. **存储与同步服务配置** - 更新 `src/components/settings-dialog/index.tsx`
   - 新增「Storage」Tab（替换原「Sync」Tab）
   - 存储模式切换卡片：Local（SQLite 本地）/ Service（远程服务）
   - 同步服务类型：WebDAV / S3 / Custom REST API
   - 服务端点、用户名、Token 配置表单
   - Token 明文切换显示
   - `AppSettings` 新增字段：`dataStorageMode`、`syncServiceType`、`syncServiceEndpoint`、`syncServiceUsername`、`syncServiceToken`

3. **SFTP 容器完善** - 重写 `src/view/sftp/sftp-container.tsx`
   - 完整的双栏文件浏览器（本地 + 远程）
   - 面包屑导航 + 后退/前进历史
   - 文件/目录图标区分（图片/代码/文本等）
   - 文件排序（名称/大小/修改时间）
   - 新建文件夹、删除、重命名对话框
   - 文件上传/下载功能（SFTP 后端已实现）
   - 空目录提示 + 加载状态

4. **Vaults 容器完善** - 重写 `src/view/vaults/vaults-container.tsx`
   - 连接 vault 后端：`vaultService.create/unlock/lock`
   - 加密存储：`vaultService.set/get/list/delete`
   - 密钥管理 UI：列表 + 详情面板
   - 复制到剪贴板、密码显示切换
   - 主密码修改功能
   - 主机凭证自动填充

5. **端口转发视图完善** - 重写 `src/view/port-forward/index.tsx`
   - 连接端口转发后端：`portForwardStart/Stop`
   - 三种转发类型：本地/远程/动态 (SOCKS)
   - 卡片式 UI 显示转发规则
   - 启动/停止/删除操作
   - 通过主机关联转发规则

6. **命令面板完善** - 更新 `src/components/command-palette/index.tsx`
   - Snippet 执行：通过 `terminalEmitter.writeCommand` 发送到活动终端
   - 命令历史执行：同样发送到活动终端
   - 变量替换支持（`${VAR}` 和 `$VAR` 格式）
   - 新增 `src/service/terminal-emitter.ts` 服务

### 2026-03-23 完成的工作 (第五批次)

1. **Logs 视图完善** - 更新 `src/view/app-logs/index.tsx` 和数据库
   - 连接日志数据库表和操作函数
   - 连接时自动记录日志
   - UI 显示连接历史

2. **Known Hosts 视图完善** - 更新 `src/view/known-hosts/index.tsx`
   - 主机指纹管理 UI
   - 数据库表和操作函数
   - 添加/删除/搜索功能

3. **Keychain 视图完善** - 更新 `src/view/keychain/index.tsx`
   - SSH 密钥管理 UI
   - 数据库 ssh_keys 表
   - 密钥 CRUD 操作

4. **xterm.js 插件增强** - 更新 `terminal-container.tsx`
   - SerializeAddon 集成（日志导出）
   - ClipboardAddon 集成（剪贴板改善）
   - ProgressAddon 集成（终端进度条）

5. **高级脚本功能** - 新增 `src/view/scripts/index.tsx` 和 `src/service/scripts.ts`
   - 脚本管理（创建/编辑/删除/启用）
   - 批量执行命令到多台主机
   - 脚本调度（manual/once/interval/cron）
   - 执行历史记录
   - 快速批量执行面板

6. **Rust 编译警告清理**
   - 修复所有 Rust 编译警告

### 2026-03-19 完成的工作 (第四批次)

1. **xterm.js API 文档** - 新增 `docs/xterm.md`
   - 完整的 Terminal API 文档
   - 已安装插件详解 (FitAddon, SearchAddon, WebLinksAddon 等)
   - VT 序列与 ANSI 转义码参考
   - 性能优化指南
   - 推荐添加的插件列表 (SerializeAddon, ClipboardAddon, ProgressAddon)

### 2026-03-19 完成的工作 (第三批次)

1. **命令面板完善** - 新增 `command-palette/index.tsx`
   - 主机快速搜索和连接
   - Snippet 快速搜索和执行
   - 命令历史搜索
   - 快捷操作（新建终端、分屏等）
   - Tab 切换分类（All/Hosts/Snippets/History/Actions）
   - 键盘导航支持（↑↓/Enter/Esc/Tab）

2. **多工作区** - 新增 `workspace-switcher/` 和 `store/workspace.ts`
   - WorkspaceStore 状态管理
   - WorkspaceSwitcher 下拉组件
   - 数据库表 `workspaces` 和 `workspace_layouts`
   - 创建、删除、切换工作区
   - 工作区布局保存和加载

3. **跨设备同步** - 新增 `service/sync.ts` 和设置面板同步 Tab
   - 导出数据到 JSON 文件
   - 从 JSON 文件导入数据
   - Merge/Replace 导入模式
   - 导入预览功能
   - 支持 hosts/groups/snippets 的导入

### 2026-03-19 完成的工作 (第二批次)

1. **命令快速补全** - 更新 `terminal-container.tsx`
   - 上下键历史命令导航
   - Enter 保存命令到历史
   - getCurrentLine/setCurrentLine 实现

2. **Agent 认证** - 更新 `terminal.rs` 和 `vault.rs`
   - SSH Agent 转发支持 (读取 SSH_AUTH_SOCK)
   - ClientHandler 实现 server_channel_open_agent_forward
   - 前端 authType: "agent" 选项

3. **Jump Host 主机链** - 新增 `ssh_connect_jump` 命令
   - JumpHostConfig 配置结构
   - channel_open_direct_tcpip 实现跳板连接
   - 前端 jumpHostId/jumpHostAuthType 字段

4. **Vault 加密存储** - 新增 `vault.rs` 和 `vault.ts`
   - AES-GCM + Argon2 加密
   - vault_create/vault_unlock/vault_lock 命令
   - vault_set/vault_get/vault_list/vault_delete 操作

### 2026-03-18 完成的工作

1. **命令历史 UI** - 新增 `CommandHistoryDialog` 组件
   - 展示命令历史列表
   - 搜索历史命令
   - 清除历史功能
   - 快捷键 Ctrl+J 打开

2. **SFTP 功能完善** - 更新 `sftp-container.tsx`
   - 集成后端 SFTP 服务
   - 文件上传/下载 UI
   - 目录导航
   - 文件刷新

3. **SSH 密钥认证 UI** - 更新 `host-dialog.tsx`
   - 添加密钥文件选择器
   - 使用 Tauri dialog 插件

4. **Snippet 变量支持** - 更新 `snippet-manager`
   - 解析脚本中的变量 `${VAR}` 或 `$VAR`
   - 执行时弹出变量输入对话框
   - 支持默认值

5. **端口转发 UI** - 新增 `port-forward/index.tsx`
   - 本地/远程/动态端口转发
   - 转发列表管理
   - 启用/停用转发
   - 集成到主机对话框

6. **国际化完善** - 更新 `demo.ts` 翻译文件
   - 英文翻译
   - 中文翻译
   - 法文翻译

7. **快捷键支持** - 更新 `layout/index.tsx`
   - Ctrl+J: 命令历史
   - Ctrl+T: 新建终端
   - Ctrl+N: 新建主机
   - Ctrl+B: 切换侧边栏

---

## 五、优先级排序建议

### 高优先级 (P0)

1. ~~SSH 密钥认证完善~~ - ⚠️ 前端已完成，后端需实现
2. ~~SFTP 文件传输~~ - 🔴 UI 已完成，后端需实现
3. ~~本地终端~~ - ✅ 已完成
4. ~~命令历史~~ - ✅ 已完成
5. 修复 Rust 编译警告

### 中优先级 (P1)

1. ~~端口转发~~ - ⚠️ UI 已完成，后端需实现
2. ~~分屏模式~~ - ✅ 已完成
3. ~~Snippet~~ - ✅ 已完成
4. ~~主题系统~~ - ✅ 已完成
5. ssh_resize 实现
6. 命令快速补全

### 低优先级 (P2)

1. Vault 加密 - 安全增强
2. 多工作区 - 项目隔离
3. 命令面板 - 快捷操作
4. 跨设备同步 - 云端同步

---

## 六、开发建议

### 近期开发路线

```
第一阶段：完善核心功能 (进行中)
├── 1. ⚠️ 修复 SSH 密钥认证后端 (使用 russh-keys)
├── 2. 🔴 实现 SFTP 后端功能 (使用 russh-sftp)
├── 3. 🔴 实现端口转发后端
└── 4. ✅ 本地终端支持

第二阶段：提升用户体验 (已基本完成)
├── 1. ✅ 分屏模式
├── 2. ✅ Snippet 功能
├── 3. ✅ 主题系统
└── 4. ✅ 端口转发 UI

第三阶段：高级功能 (待开始)
├── 1. Vault 加密
├── 2. 主机链
├── 3. Agent 转发
└── 4. 多工作区
```

### 待解决的技术问题

1. **Rust 后端编译** - `cargo check` 通过但有大量警告需清理
   - ClientHandler/SharedState/LocalPtySession 等 struct 未使用
   - 需清理 dead_code 或添加 #[allow(dead_code)]

2. **russh-sftp 集成**
   - Cargo.toml 已引入 `russh-sftp = "2.1.1"` 但未使用
   - 需要在 SSH 连接中创建 SFTP 子系统

3. **russh-keys 集成**
   - `russh-keys = "0.49.2"` 已引入
   - 需要实现 `authenticate_publickey` 方法

---

_文档创建时间：2026-03-18_
_最后更新：2026-03-24 - 完善视图集成，更新终端/SFTP/Vaults/端口转发/命令面板实现_
