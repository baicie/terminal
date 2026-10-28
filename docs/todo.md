# Terminal 项目待办事项

> 基于设计文档 `docs/design.md` 整理的待办事项
> 更新时间：2026-10-28（Phase 6.103：前端测试并发上限与自动化门禁收口；当前源码指纹以 evidence checker 输出为准，严格终端/人工输入复验待解锁 macOS 后采集）

> 最新完整证据仍来自 debug binary `4368d6c8…`，源码指纹为 `de8e49cb…`；当前工作树源码指纹为 `534405ec…`，证据门禁仍拒绝旧 binary/旧指纹，需解锁 macOS 后按当前源码重采。

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

| 任务       | 描述                                              | 状态      |
| ---------- | ------------------------------------------------- | --------- |
| 水平分屏   | 上下分割终端视图                                  | ✅ 已实现 |
| 垂直分屏   | 左右分割终端视图                                  | ✅ 已实现 |
| 双面板上限 | 每组最多两个 pane，串口禁用分屏，异常布局自动归一化 | ✅ 已实现 |
| 活动面板   | `activeTabId` 统一焦点、URL、标签样式和命令目标   | ✅ 已实现 |
| 分隔条     | 4px 显示/20px 命中区，Pointer/键盘/双击，20/80 约束 | ✅ 已实现 |
| 布局持久化 | 分屏方向和比例写回工作区，关闭后选择有效活动标签   | ✅ 已实现 |

---

### Phase 3 - 高级功能 ✅ 代码完成，实机待验证

> Agent forwarding 与 Jump Host certificate 已完成代码接线和自动化回归；真实服务与跨平台验证仍待执行。

#### 3.1 Agent 转发 ✅ 已实现

| 任务           | 描述                                   | 状态      |
| -------------- | -------------------------------------- | --------- |
| SSH Agent 支持 | 读取 SSH_AUTH_SOCK 连接本地 Agent      | ✅ 已实现 |
| Agent 转发     | 独立 opt-in、显式请求、连接级授权和专用 Channel 双向桥接 | ✅ 已实现 (2026-08-19) |
| 后端 Handler   | 实现 server_channel_open_agent_forward | ✅ 已实现 |
| 前端 UI        | Agent 认证选项 (authType: "agent")     | ✅ 已实现 |

#### 3.2 主机链 (Jump Host) ⚠️ 主入口已接线

| 任务               | 描述                           | 状态      |
| ------------------ | ------------------------------ | --------- |
| Jump Host 配置     | 主机配置 jumpHostId 字段       | ✅ 已实现 |
| Jump Host 选择器   | UI 下拉菜单选择跳板机          | ✅ 已实现 |
| Jump Host 认证覆盖 | 可选 jumpHostAuthType          | ✅ 已实现 |
| 后端连接逻辑       | direct-tcpip 流内建立目标 SSH 会话 | ✅ 已修复 (2026-08-09) |
| 前端连接入口       | SQLite 恢复配置并调用 `session_create_ssh_jump` | ✅ 已实现 |
| password/key/agent | 跳板端与目标端认证             | ✅ 已实现 |
| certificate        | 经 Jump Host 的跳板端/目标端证书认证 | ✅ 已实现 (2026-08-19) |
| 跨平台实机         | Windows/Linux 连接与断开矩阵    | ⚠️ 待实机 |

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

| 任务         | 描述                                               | 状态      |
| ------------ | -------------------------------------------------- | --------- |
| 工作区管理   | 创建、删除、切换工作区                              | ✅ 已实现 |
| 工作区切换器 | 顶栏下拉菜单快速切换                                | ✅ 已实现 |
| 布局保存     | 标签、分组、方向、活动 pane 和分屏比例               | ✅ 已实现 |
| 切换事务     | 保存当前布局、预载目标布局、成功提交，失败时回滚     | ✅ 已实现 |
| 数据库支持   | workspaces 表                                      | ✅ 已实现 |

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

#### 4.2 团队协作 ✅ 本地模式完成 (2026-03-25)

| 任务           | 描述                            | 状态                   |
| -------------- | ------------------------------- | ---------------------- |
| 用户 UUID 生成 | 首次启动生成本地 UUID           | ✅ 已实现 (2026-03-25) |
| 用户模式区分   | TeamStore + 导航动态显示        | ✅ 已实现 (2026-03-25) |
| 团队数据模型   | TypeScript 类型定义             | ✅ 已实现 (2026-03-25) |
| 团队存储服务   | SQLite 表和操作函数             | ✅ 已实现 (2026-03-25) |
| 团队协作视图   | TeamsView 基础 UI               | ✅ 已实现 (2026-03-25) |
| 团队详情页面   | Members/Shares/Audit Tabs       | ✅ 已实现 (2026-03-25) |
| 邀请机制 UI    | 链接/码/邮箱三种方式            | ✅ 已实现 (2026-03-25) |
| 本地导出功能   | 导出团队包为 JSON               | ✅ 已实现 (2026-03-25) |
| 本地导入功能   | 导入 JSON 并处理合并            | ✅ 已实现 (2026-03-25) |
| 审计日志       | 连接历史记录和展示              | ✅ 已实现 (2026-03-25) |
| Hosts 视图集成 | 共享主机导入/分享功能           | ✅ 已实现 (2026-03-25) |
| Snippets 分享  | SnippetManager + Hosts 视图展示 | ✅ 已实现 (2026-03-25) |
| 设置页面入口   | Team Tab 完善                   | ✅ 已实现 (2026-03-25) |
| 增量同步功能   | 基于时间戳的增量同步            | ✅ 已实现 (2026-05-03) |
| 冲突处理       | 询问用户选择保留版本            | ✅ 已实现 (2026-05-03) |
| 离线操作队列   | 离线操作记录和恢复              | ✅ 已实现 (2026-05-03) |
| 敏感数据加密   | 密码可选加密共享 (AES-256-GCM)  | ✅ 已实现 (2026-03-25) |
| NestJS 服务端  | REST API 服务端                 | ✅ 已实现 (2026-03-25) |
| Docker 部署    | docker-compose 配置             | ✅ 已实现 (2026-03-25) |
| 前端云端同步   | 前端连接 NestJS 服务端          | ✅ 已实现 (2026-03-25) |

#### 4.3 SSH 证书认证 ⚠️ 认证完成，证书签发待规划

| 任务     | 描述             | 状态      |
| -------- | ---------------- | --------- |
| 证书支持 | SSH 证书认证方式 | ✅ 已实现 (2026-03-26) |
| 证书管理 | 颁发和管理证书   | 📋 待开发 |

#### 4.4 高级脚本 ✅ 已实现 (2026-03-23)

| 任务     | 描述                   | 状态                                  |
| -------- | ---------------------- | ------------------------------------- |
| 脚本调度 | 定时执行脚本任务       | ✅ 已实现 (manual/once/interval/cron) |
| 批量执行 | 批量向多台主机发送命令 | ✅ 已实现                             |
| 脚本输出 | 收集和分析脚本输出     | ✅ 已实现                             |

---

## 三、技术优化待办

### 3.1 Rust 后端优化

| 任务            | 描述                                 | 状态                         |
| --------------- | ------------------------------------ | ---------------------------- |
| 编译警告清理    | cargo check 产生大量 unused 代码警告 | ✅ 已修复                    |
| 错误处理优化    | 完善错误类型和错误信息               | 📋 待优化                    |
| 连接池          | SSH 连接池管理                       | ✅ 已实现，Jump Host key 已隔离 |
| 并发支持        | 多连接并发管理                       | ✅ 已实现 (使用 tokio Mutex) |
| ssh_resize 实现 | 本地 PTY resize；SSH RFC 4254 `window-change` | ✅ 已实现                    |

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

### 2026-05-02 第三轮 (Phase 6.2 — 桌面化 + SFTP 队列 + 单测 + Rust 可观测性) ✅

> 在第二轮（首屏 gzip 242 KB / `index.js` 159 KB / 0 警告）之上，按序完成 t1–t4 四个细项。

#### t1 — Tauri 桌面 UX

- 系统托盘 (`src-tauri/src/tray.rs`)：图标 + 菜单 (Show / New Local / New SSH / Command Palette / Quit)，菜单 emit `tray://*` event → 前端 `useTrayEvents` 转 `shortcut:*` CustomEvent，复用既有调度
- 最小化到托盘 (`src-tauri/src/window_cmd.rs` + `lib.rs::on_window_event`)：用户偏好持久化到 SQLite，关闭按钮拦截后 `window.hide()`
- 原生通知 (`packages/frontend/src/service/notifications.ts`)：Tauri plugin → 浏览器 → in-app toast 三级回退；`notifyOnlyWhenUnfocused` 默认开
- 焦点感知 (`packages/frontend/src/hooks/use-window-focus.ts`)：监听 `tauri://focus` / `tauri://blur`，状态条失焦半透明 + tooltip
- 设置面板：`general-settings.tsx` 加 _Desktop UX_ section（3 个 Switch + i18n 三语）

#### t2 — SFTP 体验

- 后端分片 (`src-tauri/src/sftp.rs`)：`CHUNK_SIZE = 64 KiB`，每 100ms emit 一次 `sftp-progress`（带 `transfer_id`）；`SharedState.sftp_sessions` 改 `Arc<SftpSession>`，列表/上传可在同一 SSH session 并发
- 前端拖拽 (`packages/frontend/src/view/sftp/use-sftp-drop.ts`)：监听 Tauri webview drag-drop，拿到原生本地路径直接 `uploadPaths`
- 队列 store (`packages/frontend/src/store/transfer-queue.ts`)：Zustand 状态机（queued/running/done/error）+ 速率滑动窗口 + ETA
- 浮层 UI (`packages/frontend/src/view/sftp/transfer-panel.tsx`)：右下角悬浮，按状态分组，单条移除 + clear finished
- 兼容：`features/terminal/services/sftp.ts` 内部生成 `transferId`，与新后端兼容但不接队列（标 legacy）

#### t3 — 测试覆盖

- 新增 `service/shortcuts.test.ts`：`parseKeyboardEvent` 修饰键 + `matchShortcut` 默认/禁用 + `handleKeyboardEvent` editable 白名单
- 新增 `store/transfer-queue.test.ts`：enqueue 展开浮层、updateProgress 速率、finish 终态、clearFinished、togglePanel
- 新增 `hooks/use-window-focus.test.ts`：初始值 = `document.hasFocus()`、focus/blur 后切换、unmount 清理
- 踩坑：jsdom `document.hasFocus()` 默认 false；PowerShell `Select-Object -Last N` 与长输出会缓冲死，改 `Tee-Object -FilePath`

#### t4 — Rust 后端清理

- `cargo check` 警告：**14 → 0**
- 引入 `tracing` + `tracing-subscriber` + `tracing-log`，`init_tracing()` 兼容 `RUST_LOG`，桥接 russh / tauri 等 `log::*` 调用
- 全部 `eprintln!` / `log::info!` 迁移到 `tracing::*`，加结构化字段（`session_id` / `transfer_id` / `total_bytes` / `backend` 等）
- `state.rs` / `storage.rs` 顶部的 blanket `#![allow(dead_code)]` 全部移除：
  - `state.rs` 改为按字段加 allow + 注释，标注 _ownership-only_ 或 _reserved for future_
  - `storage.rs` 改为单条带 docstring 的模块级 allow，明确"整个模块是 stub"
  - `ClientHandler.agent_socket` 用 `#[cfg_attr(not(unix), allow(dead_code))]` 仅在非 Unix 平台 allow

#### 文件变更（本轮）

- 新增（Rust）：`src-tauri/src/{tray,window_cmd}.rs`
- 新增（前端）：`packages/frontend/src/service/{notifications,window-ux,sftp-transfer}.ts`、`packages/frontend/src/store/transfer-queue.ts`、`packages/frontend/src/hooks/{use-window-focus,use-tray-events}.ts`、`packages/frontend/src/view/sftp/{transfer-panel.tsx,use-sftp-drop.ts}`
- 新增（测试）：`packages/frontend/src/service/shortcuts.test.ts`、`packages/frontend/src/store/transfer-queue.test.ts`、`packages/frontend/src/hooks/use-window-focus.test.ts`
- 修改（Rust）：`src-tauri/Cargo.toml`、`src-tauri/src/{lib,state,storage,sftp,window_cmd}.rs`、`src-tauri/src/session/channel.rs`、`src-tauri/capabilities/default.json`、`src-tauri/tauri.conf.json`
- 修改（前端）：`packages/frontend/src/App.tsx`、`packages/frontend/src/layout/index.tsx`、`packages/frontend/src/components/settings-dialog/{index,general-settings}.tsx`、`packages/frontend/src/features/terminal/components/terminal-container/{container,session-status-bar}.tsx`、`packages/frontend/src/features/terminal/services/sftp.ts`、`packages/frontend/src/view/sftp/sftp-container.tsx`、`packages/frontend/src/locales/{cn,en,fr}/app.ts`

### 2026-05-02 第四轮 (Phase 6.3 — 文档待办对齐 + 存储命令接线) ✅

1. **`docs/project.md`**：P1/P2/P3 checklist 与当前代码一致；Phase 4「数据存储」改为 ⚠️ 后端已接线；新增 Phase 6.3 小节。
2. **`docs/issue.md`**：Issue #5 / #6 / #10、「数据存储服务后端」段落与 `session_resize` / Jump / Agent 现状对齐。
3. **Rust**：`lib.rs` `.manage(Arc<StorageManager>)`；`storage.rs` 移除整文件 `dead_code` allow，`storage_*` 走 `default` 后端；`S3` 占位字段与 `list_backends` 带目标化 allow。
4. **前端**：`storage-settings.tsx`、`storage-settings-dialog.tsx` 的 `storageInit` 增加 `bucket`（S3 测试连接必填）。

### 2026-05-03 第五轮 (Phase 6.4 — 代码质量拆分 + 命令补全 + 跨设备同步) ✅

#### 代码质量 — 大文件拆分

严格按 `AGENTS.md` 行数限制（视图 300 / 组件 400 / 工具 300）拆分 8 个文件：

| 原文件 | 拆分后 | 状态 |
| --- | --- | --- |
| `view/teams/index.tsx` (350 行) | `index.tsx` (253 行) + `team-list-sidebar.tsx` (85 行) + `disabled-teams-view.tsx` (46 行) | ✅ |
| `host-list/host-dialog.tsx` (422 行) | `host-dialog.tsx` (261 行) + `host-form-basic.tsx` (160 行) + `host-form-actions.tsx` (80 行) | ✅ |
| `view/keychain/index.tsx` (303 行) | `index.tsx` (270 行) + `use-key-form.ts` (237 行) | ✅ |
| `view/hosts/index.tsx` (264 行) | `index.tsx` (~165 行) + `render-list-body.tsx` (~90 行) | ✅ |
| `view/snippets/index.tsx` (266 行) | `index.tsx` (~190 行) + `use-script-form.ts` (~160 行) | ✅ |

**拆分原则：** 按职责拆分——侧边栏/内联视图拆为独立组件，表单状态提取为 hook，数据渲染拆为纯展示组件。

#### 命令补全 — Tab 键拦截 + 前缀匹配浮层

在 xterm `onData` 层拦截 Tab → 提取当前词 → 前缀匹配 SQLite 历史 → 显示浮层 → Tab/↑↓ 循环选择 → 替换当前词。

| 新文件 | 功能 |
| --- | --- |
| `hooks/use-command-completion.ts` | `extractCurrentWord()` / `findMatches()` / `getCursorScreenPosition()` / `applyCompletion()` |
| `components/terminal-completion/terminal-completion-overlay.tsx` | VS Code 风格浮动浮层（↑↓/Tab/Enter/Esc 导航） |
| 修改 `hooks/use-terminal.ts` | Tab 键拦截（`data === '\t'` 时调用 `onTabPress` 回调，不发往后端） |
| 修改 `terminal-container/container.tsx` | Tab 补全状态 + 浮层渲染 |

#### 跨设备同步 — 导出/导入/同步流程完善

| 改动 | 说明 |
| --- | --- |
| `service/sync.ts`：`importDataFromFile()` | 占位符替换为完整实现：按依赖顺序导入 groups/hosts/snippets/ssh_keys/known_hosts/workspaces，支持 merge/replace |
| `service/sync.ts`：新增 `syncToServer()` | 上传 `terminal-sync-{timestamp}.json` + `terminal-latest.json` 到存储服务 |
| `service/sync.ts`：新增 `downloadFromServer()` | 从存储服务下载 + 调用 `importDataFromFile()` 写入本地 DB |
| `service/sync.ts`：新增 `getLastSyncTime()` / `formatLastSyncTime()` | 从 localStorage 读取并格式化上次同步时间 |
| `storage-settings-dialog.tsx` | 新增「Sync Now」+「Restore from Server」按钮 + 同步状态指示器 |
| i18n 补键 | `settings.lastSync` / `never` / `restoreMode` / `restoreFromServer` / `restoring` 中英法三语 |

---

### 2026-05-03 第六轮 (Phase 6.5 — Agent 错误细化 + 命令补全修复 + 串口显示 + 云同步 UX + NestJS 部署文档) ✅

#### Agent 认证失败 UI 细化

后端 Rust 错误语义细化，前端按错误类型分发 14 种人类可读文案（中英法三语）：

| 文件 | 改动 |
| --- | --- |
| `session/ssh.rs` | `NotFound` 细分：OpenSSH 未安装 / Pageant 未运行 / 自定义路径无效；新增 `AddrNotAvailable` |
| `features/terminal/utils/readable-error.ts` | 新增 12 种错误分发规则 |
| `locales/{en,cn,fr}/app.ts` | 中英法三语补全新增 11 个 key |

#### 命令补全完善

| 文件 | 改动 |
| --- | --- |
| `container.tsx` | 修复 dead code：`rcItemsRef.current` 赋值重复行 |
| `use-terminal.ts` | `saveToHistory` 增加去重；`loadHistoryFromDb` 移除 `!hid` 早期返回，local session 现在也能加载全局历史 |
| `use-command-completion.test.ts` | 新增单元测试 |

#### Windows 串口端口显示增强

| 文件 | 改动 |
| --- | --- |
| `serial.rs::serial_list` | `port_type` 从原始 `{:?}` 改为用户友好文案：USB 显示厂商名+产品名+VID:PID；Bluetooth 显示 `Bluetooth`；Unknown 在 Windows 上显示 `Serial Port` |
| `docs/issue.md#22` | 添加 12 项回归测试检查清单 |

#### 云端同步 UX 完善

| 文件 | 改动 |
| --- | --- |
| `view/settings/storage-settings.tsx` | 新增 toast 通知；修复 namespace |
| `store/transfer-queue.test.ts` | 修复 7 处 TS 类型错误 |

#### NestJS Team Server 自托管部署文档

| 文件 | 改动 |
| --- | --- |
| `docs/team-server-deploy.md` | 新增完整部署指南（Docker Compose / Nginx / Caddy / 数据库维护 / 安全加固 / 故障排查） |
| `docs/project.md` | Phase 4 团队协作云端模式状态更新 |

---

### 2026-05-02 第二轮 (P0+P1+P2 全做完) ✅

> 在第一轮 UX/构建优化基线（gzip 418 KB / 首屏 ~290 KB）之上，继续做了 8 个细项。
> 最终首屏 **gzip 242 KB / brotli 210 KB**，首屏 raw 840 KB（第一轮 ~919 KB），主入口 `index.js` **159 KB**（vs 256 KB，省 38%）。

#### P0 — 警告 + 验证

1. **修复 `INEFFECTIVE_DYNAMIC_IMPORT`** ✅
   - 删除 `nav-config.tsx` 中死代码 case `/terminal`、`view/home/`、`service/recording.ts`、`store/terminal.ts`、`features/terminal/stores/`、`view/terminal/{terminal-container,terminal-write-context,terminal-keyboard-bar,terminal.module.scss}` 共 9 处死代码
   - `layout/index.tsx` 改为 `React.lazy` 直接加载真正的 `features/terminal/components/terminal-container/container.tsx`，xterm 体积彻底从首屏移走（~452 KB raw）
2. **修复 `Invalid input options exclude` warning** ✅
   - 从 `vite.config.ts` 拆出 `vitest.config.ts`，避免 vitest coverage 配置泄漏到 rolldown
3. **静态验证 SSH / 串口终端走同一修复路径** ✅
   - `useTerminal` hook 同时被 local / SSH / serial 复用，后端 emit 名 `local-data` / `ssh-data` / `serial-data` 对齐前端 listener；第一轮的「同步 onData + 数据缓冲」已由 Phase 6.17 的单一官方 `onData`/`onBinary` FIFO 取代

#### P1 — bundle 进一步缩小

4. **审计 `index.js` 大头并拆包** ✅
   - 5 个全局 dialog 改为 `React.lazy + open && <Suspense>`：`SettingsDialog` / `HostDialog` / `CommandPalette` / `NotificationPanel` / `SerialDialog`
   - 影响位置：`layout/index.tsx`、`top-toolbar/index.tsx`、`bottom-nav/index.tsx`
   - 主入口 `index.js` 从 256 KB → 159 KB（**↓ 38%**），首屏 gzip 从 259 → 242 KB
5. **Tailwind production purge 验证** ✅
   - Tailwind v4 vite 插件已自动 purge，CSS 仅 94 KB raw / **15.7 KB gzip**，无需手动配置

#### P2 — UI 增强

6. **终端搜索 UI（Cmd/Ctrl + F 浮层）** ✅
   - 新增 `features/terminal/components/terminal-container/terminal-search-overlay.tsx`
   - 通过 `term.attachCustomKeyEventHandler` 拦截 Cmd/Ctrl+F，避免被 xterm 吞掉
   - 支持 next / prev、case-sensitive、whole-word、regex 三个 toggle，复用 `SearchAddon`
   - 右键菜单「搜索…」入口；i18n 加 `terminal.search*` 键
7. **命令面板接入 `shortcutsService`** ✅
   - 新增 `hooks/use-global-shortcuts.ts`：单一 `keydown` listener → `shortcutsService.handleKeyboardEvent` → 派发 `shortcut:*` CustomEvent
   - 增强 `shortcutsService.parseKeyboardEvent`：正确处理 macOS Ctrl/Meta + 单字母大小写归一
   - `top-toolbar` 移除自写 `addEventListener('keydown')`，改订阅 `shortcut:command-palette` / `shortcut:new-ssh`
   - `layout` 订阅 `shortcut:new-tab` / `shortcut:new-local` / `shortcut:toggle-sidebar`
   - `command-palette` action 项改为派发 CustomEvent，统一调度
8. **移动端长按菜单** ✅ 新增 `terminal-mobile-menu.tsx`
   - `Sheet` 从底部弹出，等价于桌面右键菜单（复制 / 粘贴 / 全选 / 清屏 / 字号 / 搜索）
   - 触摸长按 ≥ 500ms 且无明显移动时触发，支持 `navigator.vibrate(20)` 触觉反馈

#### 文件变更（本轮）

- 新增：`hooks/use-global-shortcuts.ts`、`features/terminal/components/terminal-container/{terminal-search-overlay,terminal-mobile-menu}.tsx`、`vitest.config.ts`、`features/terminal/contexts/terminal-write-context.ts`
- 修改：`vite.config.ts`、`layout/index.tsx`、`top-toolbar/index.tsx`、`bottom-nav/index.tsx`、`features/terminal/components/terminal-container/{container,terminal-context-menu}.tsx`、`service/shortcuts.ts`、`components/command-palette/index.tsx`、`scripts/bundle-stats.mjs`、`locales/{cn,en,fr}/app.ts`
- 删除：`view/home/`、`service/recording.ts`、`store/terminal.ts`、`features/terminal/stores/`、`view/terminal/{terminal-container,terminal-write-context,terminal-keyboard-bar,terminal.module.scss}`、`router/nav-config.tsx` 中死代码 case

#### 收益对比

| 指标 | r0 原始 | r1 第一轮 | r2 第二轮 | 累计 |
| --- | --- | --- | --- | --- |
| 首屏 gzip | ~290 KB | 259 KB | **242 KB** | **↓ 17%** |
| `index.js` raw | ~290 KB | 256 KB | **159 KB** | **↓ 45%** |
| 首屏 raw | ~960 KB | ~919 KB | **840 KB** | ↓ 12% |
| 警告 | 2 | 2 | **0**（exclude 仅 vite info） | — |

---

### 2026-05-03 Phase 6.9 - SSH Key 生成 + 命令执行 + i18n 补全 + 文档完善 ✅

> 2026-05-03：实现 SSH 密钥生成后端；重构命令执行可靠性；补全三语种翻译；完善用户文档。

#### SSH 密钥生成

- **Rust 后端** (`commands.rs`)：新增 `key_generate` Tauri 命令，支持 Ed25519 / RSA 2048/4096 / ECDSA P-256/P-384/P-521，使用 `ssh_key` crate 生成私钥、公钥指纹（SHA-256）；新增 `KeyGenResult` 结构体和 `KeyGenerationFailed` 错误变体
- **前端** (`ssh.ts`)：`generateSSHKey` 改为调用 `invoke('key_generate')`，接通 GenerateKeyDialog UI

#### SSH 证书认证

- `authenticate_with_cert` (`ssh.rs`) 已完整实现；`Signer trait` 为未来扩展点（Issue #5 已标注）

#### 命令执行可靠性

- 前端 `execute()` 重构：移除 PTY shell hack，改用 `invoke('session_exec')` 调用后端 exec channel；捕获真实 exit code；默认超时 30s；消除竞态条件

#### i18n 三语种补全

- `fr/cmdPalette.ts`：新增 17 个缺失键（SFTP 会话、传输队列、工作区切换等）
- `fr/teams.ts`：修复 `enterInviteCode` 中的西班牙语拼写错误
- `fr/settings.ts`：新增 4 个缺失键（连接状态提示）
- `cn/snippets.ts`：新增 4 个缺失键（执行历史时间/持续时间）

#### 用户文档

- `README.md`：完全重写（项目介绍、功能、快捷键、项目结构、技术栈、快速开始）
- `package.json`：新增 `description` 字段

---

### 2026-08-09 Phase 6.10 - 跨平台 SSH / 串口 / 本地终端可靠性 ✅ 代码完成

- [x] SSH 主机密钥按 host/port 严格校验系统 `known_hosts`
- [x] Jump Host password/key/agent 在 `direct-tcpip` 流内建立目标 SSH 会话，连接池区分并保持跳板 transport
- [x] Windows OpenSSH Agent named pipe 与 `russh` 原生 Pageant 回退
- [x] Agent forwarding 专用 channel 双向桥接，移除普通 SSH 数据误写 Agent socket 的路径
- [x] 串口 blocking I/O、`write_all`、精确字节写入和断开/拔线清理
- [x] 本地 PTY 从用户主目录启动；PTY 初始化、shell 启动及控制 I/O 使用 blocking pool；EOF 后标记会话关闭
- [x] 移除冲突的系统级快捷键，释放 `Ctrl+Shift+V`，修复 `Shift+\` 真实事件匹配
- [x] 结构化 Tauri IPC 错误显示可读消息
- [x] Agent forwarding 增加独立配置、`channel.agent_forward(...)`、handler 授权与连接池模式隔离
- [x] 实现 Jump Host certificate 认证，跳板端与目标端分别传递证书、私钥和 passphrase
- [ ] Windows OpenSSH Agent / Pageant、Windows/Linux Jump Host、本地 PTY、串口硬件实机回归

自动验证：Rust 44 项测试、check、Clippy、fmt；前端 31 个测试文件、408 项测试、typecheck、production build；`git diff --check`。

---

### 2026-08-09 Phase 6.11 - 发布就绪 + Team Server 安全加固 ✅ 本机自动门禁完成

- [x] 新增统一 `pnpm verify`，覆盖前端、Team Server、Rust、构建预算和源码规模
- [x] 447 个前端/Team Server 生产 TS/TSX 文件全部满足 `AGENTS.md` 行数限制
- [x] 冻结锁文件安装可重复，生产依赖审计为 0 个已知漏洞
- [x] Team Server Token 摘要存储、旧记录迁移、Token 路由授权和重复注册冲突
- [x] CORS fail-closed、Helmet、限流、Swagger 生产默认关闭、1MB body limit 和 shutdown hooks
- [x] auth/invite/team/member/share/sync/audit DTO、路径 pipe、同步批次与审计分页上限
- [x] 修复跨团队成员、邀请、共享、同步、冲突和离线队列授权
- [x] 健康与就绪探针数据库故障返回 503；Compose healthcheck 使用 readiness
- [x] Prisma 异常不进入客户端、离线队列或日志；API Key 数据库故障不伪装成 401
- [x] 分享删除与审计 tombstone 在同一 Prisma 事务内提交
- [x] SQLite 失败日志不输出查询参数；新建主机 Save 恢复可用
- [x] Jump Host certificate 前后端 fail-closed，证书直连 IPC 使用 camelCase 并有双端测试
- [x] Team 敏感共享与离线队列 fail-closed：密文不降级、UPDATE 必须带 `baseVersion`、完成项清空 payload、原子 claim 使用 processing token、陈旧 PROCESSING 任务 15 分钟后恢复、终态失败不自动重试
- [x] S3 SigV4、脚本 timeout/retry/scheduler、Tauri dialog/fs capability 与 HTTP(S) CSP 回归测试通过
- [x] 最终验证：前端 408、Team Server 95、Rust 45 项测试全部通过
- [x] Docker Desktop + PostgreSQL 16.15 完成 Compose、迁移、真实 readiness、注册准入和关停恢复验收 (2026-08-19)
- [x] 为公开互联网部署增加注册准入机制：生产默认 closed，支持常量时间校验的 token 模式和显式 open 模式
- [ ] 完成 Phase 6.10 的 Windows/Linux/Pageant/Jump Host/PTY/串口硬件实机矩阵

---

### 2026-08-11 Phase 6.12 - v0.0.1-dev.0 多平台发布 ✅ 已完成

- [x] 定位空 Release：现有 CI 使用 `--no-bundle` 且只有 `contents: read`，不会上传安装包
- [x] 定位 Windows CI：五个 SSH 创建命令的 Future 借用连接池共享状态和 IPC `String` 参数，不满足 Tauri 的通用 `Send` 约束
- [x] 连接池与 SSH 会话创建异步 API 改为拥有 `Arc<Self>`、key 和 IPC `String` 参数，并增加 `Send + 'static` 编译期回归断言
- [x] 新增六目标 Release matrix：macOS/Windows/Linux x64 与 ARM64 原生 runner
- [x] 固定安装包命名，逐项非空校验并生成 `SHA256SUMS.txt`
- [x] Release YAML 解析和 `actionlint` 通过；Rust SSH 定向 7 项测试通过
- [x] 提交 `83cd4e8` 的 CI `31409070480` 全绿：macOS、Windows、Linux Tauri 编译及前端、Team Server、Rust、Docker、源码规模门禁通过
- [x] 远端 Windows x64/ARM64 构建与 NSIS 上传通过
- [x] 远端 macOS x64/ARM64 构建与 DMG 上传通过
- [x] 远端 Linux x64/ARM64 构建与 AppImage/DEB 上传通过
- [x] Release 工作流 `31431531040` 全绿；八个安装资产与 862-byte `SHA256SUMS.txt` 均非空，服务端 digest 与清单一致
- [x] Release 说明明确 macOS 未公证、Windows 未签名；未把构建成功写成跨平台硬件实机完成

---

### 2026-08-12 Phase 6.13 - 终端会话架构重构 ✅ 已完成

- [x] 参考 SideX / nyala-studio 的会话生命周期思路，按 `tabId` 建立独立的终端会话管理层
- [x] 新增 `TerminalSessionManager`，持有 session、状态、监听器和连接前输出缓冲
- [x] 新增 `TerminalSessionEvents`，按 local / SSH / serial 复用全局 Tauri 事件监听
- [x] `useTerminal` 改为绑定 xterm surface，路由切换不再关闭后端会话
- [x] `TerminalByUrl` 常驻主布局，支持标签切换、分屏和非终端路由隐藏终端层
- [x] 命令面板、Snippet、History 通过活动 `tabId` 定向投递命令
- [x] 新增桌面终端工具栏：查找、清屏、字号缩放、工具侧栏和全屏
- [x] 断连/退出时清理 session 映射，防止向失效会话写入
- [x] 新增 3 项会话管理器回归测试；typecheck、lint、源码规模门禁通过
- [ ] 使用 Tauri 桌面运行时完成本地 PTY、SSH、serial 的真实连接、切换、断开和重连回归

---

### 2026-08-12 Phase 6.14 - v0.0.1-dev.1 开发版发布 ✅ 已完成

- [x] 根包、Frontend、Team Server、Cargo 与 Tauri 配置版本统一为 `0.0.1-dev.1`
- [x] 发布准备提交 `412136d` 推送到 `feat/mvp`
- [x] 本机 `pnpm verify` 全绿：前端 411、Team Server 95、Rust 45 项测试及完整质量门禁通过
- [x] Push CI `31553345929` 与 PR CI `31553348495` 全绿后创建发布标签
- [x] 标签 `v0.0.1-dev.1` 指向 `412136d` 并已推送
- [x] Release 工作流 `31554163901` attempt 2 全绿，六个原生 runner 构建成功
- [x] 8 个安装包与 862-byte `SHA256SUMS.txt` 均非空，清单与服务端 digest 逐项一致
- [x] Release 保持 prerelease、非草稿，并明确 macOS 未公证、Windows 未签名

---

### 2026-08-17 Phase 6.15 - nyala-studio 终端工作台交互重构 ✅ 已完成

- [x] 参考本地 `nyala-studio` 的实例、分组和活动面板模型，沿用本项目 shadcn/ui 视觉与主题系统
- [x] 无标签启动时不加载终端入口；首个标签出现后按稳定 `tab.id` 常驻，路由切换只隐藏终端层
- [x] `activeTabId` 统一驱动活动 pane、焦点、标签选中态、URL `?tab=` 和命令投递目标
- [x] 命令面板、Snippet 与 History 严格单播到活动标签，禁止回退到错误会话
- [x] 每个分组限制为最多两个 pane，串口禁用分屏；旧的异常持久化布局自动归一化
- [x] 分屏比例限制为 20/80 并持久化；分隔条使用 4px 视觉宽度和 20px 命中区，支持 Pointer、键盘与双击复位
- [x] 标签使用 shadcn `ContextMenu`，支持重排、关闭、水平/垂直分屏、退出分屏与键盘导航
- [x] 合并重复状态条和工具栏为紧凑 pane header，保留连接状态、搜索、清屏、重连/断开、侧栏和更多菜单
- [x] 搜索、菜单和工具侧栏关闭后恢复 xterm 焦点；标签切换或点击 pane 后可直接输入
- [x] 移动端保留长按 Sheet 菜单与终端键盘栏，修复标准 Ctrl 控制码映射
- [x] 移动端终端路由提供 44px 会话栏，支持横向切换、关闭和新建；活动 pane 提供 `aria-current` 与 ring
- [x] 修复 `/terminal` 空 Outlet 透明覆盖工作台，终端路由下不再拦截 pane 点击与焦点
- [x] 移动工作台避让底部导航与安全区，底栏活动态跟随路由并在窄屏等分适配
- [x] 全屏终端通过 portal 脱离工作台堆叠上下文，键盘栏不再被底部导航截获
- [x] 全屏往返保持同一 xterm DOM 节点；非活动 pane 或离开终端路由自动退出全屏，Sheet/Dialog 层级可覆盖全屏
- [x] 工作区切换使用“保存当前布局 → 预载目标布局 → 提交/失败回滚”共享事务，并在顶栏挂载切换器
- [x] 自动化覆盖布局状态、标签/路由同步、活动 pane、分隔条、焦点、移动键盘、命令单播及工作区回滚
- [x] 完整前端 59 个测试文件、547 项测试及 lint/typecheck/build/源码行数门禁通过；首屏/总 gzip 237.66/524.17 KB 符合预算
- [x] 浏览器验证 1440×900、1024×768、390×844、360×800、639/640px 断点及深浅主题

验证边界：本轮没有修改 Rust、数据库 schema 或 Tauri capability；浏览器和前端自动化不能替代真实 SSH、本地 PTY、Windows/Linux、Pageant、Jump Host 与串口硬件实机矩阵。

---

### 2026-08-19 Phase 6.16 - SSH 高级认证与注册准入收口 ✅ 本机代码与容器验收完成

- [x] Host 增加独立 `agentForwarding` 设置，SQLite 新库/旧库迁移、CRUD、备份同步与所有 SSH IPC 路径完整传播，默认关闭
- [x] shell channel 在 opt-in 时显式调用 `channel.agent_forward(true)`；`ClientHandler` 未授权时拒绝服务端主动 Agent channel
- [x] 连接池 key 区分 forwarding 权限；Jump Host transport 固定禁用，仅最终目标连接按 Host 设置授权
- [x] 团队共享不委托 Agent forwarding 权限，导入共享主机强制关闭；备份导入仅接受布尔 `true` 或数值 `1`
- [x] Jump Host 跳板端和目标端支持 certificate，IPC 增加可选 `targetCertificate`，缺证书/私钥时在网络连接前 fail-closed
- [x] 交互终端、脚本/命令执行和 legacy SSH facade 均支持 Jump Host certificate，不再保留旧的前端拒绝路径
- [x] Team Server 新增 `REGISTRATION_MODE=closed|token|open`；生产缺省 closed，token 模式要求至少 32 字符并用 SHA-256 固定长度摘要常量时间比较
- [x] 注册拒绝发生在任何 Prisma 访问前；缺失/非精确 `NODE_ENV` 与非法注册模式拒绝启动，Compose 默认只绑定 `127.0.0.1`
- [x] 将 Prisma 配置链中的易受影响 `deepmerge-ts` 覆盖到 8.0.1；生产依赖审计为 0 个已知漏洞
- [x] `pnpm verify` 全绿：前端 63 个文件/561 项、Team Server 25 个文件/103 项、Rust 47 项单测 + 2 项集成测试；462 个生产源码文件通过规模门禁
- [x] `docker compose --env-file .env.example config --quiet` 通过
- [x] Docker Desktop + PostgreSQL 16.15 容器运行通过：2 个迁移、health/readiness、closed/token/open、非法环境 fail-closed、SIGTERM 与重启恢复
- [ ] 在真实 macOS/Linux Agent、Windows OpenSSH/Pageant 和 Jump Host certificate 服务中完成 SSH 运行验收

---

### 2026-08-19 至 2026-08-21 Phase 6.17 - 终端可靠性重建 🟡 macOS 本地核心链路完成，外部实机矩阵待验证

- [x] 参考 Nyaterm 的 callback ACK、高低水位和 PTY 背压协议，在本项目内独立实现输出泵与前端调度器
- [x] 移除 Tab/方向键/补全对 PTY 的破坏性拦截；文本 `onData`、输入、粘贴和 IME 原样进入单一 FIFO，`onBinary` 原始字节共用该 FIFO
- [x] 首次 `proposeDimensions()`、connecting resize latest-wins、PTY 默认回显/登录 shell和流式 UTF-8 解码
- [x] local/SSH 输出 1MiB pause、128KiB resume；xterm callback 后按 UTF-8 字节 ACK；硬上限错误可观察且禁止静默截断
- [x] ACK 控制改为原子累计 + `Notify`，移除无界控制队列；超额 ACK fail-closed，输出泵失败立即结束 local/SSH session
- [x] 自然 EOF、主动 close、重复 reconnect 的 generation 隔离与 session/meta/channel 清理；本地 child kill/wait/reap
- [x] TCP、认证、Jump Host 隧道、channel/PTY/shell、write/resize 阶段超时；renderer 生命周期修复；恢复并精确固定带 WKWebView 重叠按键补丁的 `@baicie/xterm@0.1.7`，保留官方 addons 与 typings shim
- [x] SSH writer 全队列绝对 deadline、过期命令无副作用、EOF 前 close/join writer、exec 端到端 deadline 与 TCP_NODELAY
- [x] SSH writer fatal completion 主动结束 reader、发布可见错误并触发生命周期清理；clean/fatal completion 与 bounded close 均有回归
- [x] 接通 `onBinary` 原始 `Uint8Array` → Tauri `Vec<u8>` IPC，并与文本输入共用有序 FIFO；单元/服务边界回归已覆盖
- [x] 兼容版 `@baicie/xterm@0.1.7` 事件级回归：真实打开 xterm 后验证 SGR mouse、DECSET 2004 bracketed paste，以及高位 X10/default mouse 字节经 `registerTerminalInput` 原样进入文本/raw FIFO（3 项）；该测试使用 jsdom synthetic DOM 事件，不替代 Tauri/PTY 实机验收；后续 Phase 6.27 已补充真实 Tauri/PTY 三 case 证据
- [x] macOS 真实 `portable-pty` 隔离 `/bin/sh -c` 自动化 smoke：默认回显、`read` 中文/emoji、shell 内 `stty size` 为 `31 97`、正常退出等待，所有失败路径均由 guard 回收
- [x] 前端输出单次 32 KiB、超大事件按 UTF-8 边界拆分；正向 ACK 刷新 no-progress watchdog，完全无 ACK 仍按 10 秒 fail-closed
- [x] RAF 超过 100ms 未触发时进入 fallback；受流控小批次同时竞速 microtask，后续批次在 xterm callback 内直接续写，让已启动的 parse slice 避免每批重复等待内部 timer，修复窗口遮挡/后台化造成的 ACK timeout 与 123.989 秒慢跑
- [x] smoke 自身 `waitForTerminalSmokeFrame()` 使用 RAF/100ms timeout 竞速；修复仅等待 RAF 导致运行卡死并由 Rust watchdog 报 `stage rust-watchdog: terminal smoke timed out` 的第二层缺口，相关 3 项回归全绿
- [x] 依赖契约先 RED 后 GREEN：精确要求 `@baicie/xterm@0.1.7`，禁止直接依赖上游 core；lockfile 只保留修复版核心包，运行时/CSS import 与类型 shim 对齐
- [x] 恢复修复版 core 后完整 `pnpm verify`：前端 79 个文件/675 项、Team Server 25 个文件/103 项、Rust 112+2 项及 lint/typecheck/build/bundle/fmt/Clippy/478 文件规模门禁全绿；首屏/总 gzip 为 108.16/545.92 KB
- [x] Tauri `Terminal Dev` 基础本地 PTY smoke：登录 zsh、普通命令、Unicode、Ctrl+C、`stty size=45 125`；旧输出策略真实复现 8 MiB ACK timeout
- [x] 标准 Tauri/xterm 压力 smoke：shell 精确生成 8,388,608 字节，`LOAD_END` 与后续 `AFTER_LOAD_OK` 可见，resize 后 `stty size=31 97`；移除本项目临时 smoke 日志后的三次历史运行耗时 542/562/555 ms，不把尾标记验证表述为 parser 独立逐字节计数
- [x] 恢复 `@baicie/xterm@0.1.7` 后重新构建 Tauri 调试二进制并复跑标准 smoke：8 MiB、尾标记、后续命令、97×31 resize 全通过，耗时 562 ms；不把该自动化结果表述为物理重叠按键通过
- [x] 修复 fallback 排空后新到无字节计数尾批次重新等待 RAF/timer 的边界；新增 RED/GREEN 回归，前端全量 93 个测试文件/801 项通过
- [x] 收窄 Rust 直接依赖：移除未使用 `ssh-rs`/`russh-keys`，为 `ssh-key` 显式固定所需 features；未执行 `cargo clean`
- [x] 用真实 Tauri/xterm/PTY 端到端流量验证 SGR mouse、bracketed paste 和 raw X10 原始输入字节；2026-10-10 三 case 精确回读，证据见 `docs/verification/2026-10-10-macos-raw-input.json`
- [ ] 在 macOS WKWebView 用物理键盘多轮近同时按 `a/s/d`，精确检查不丢不重；继续完成快速连续输入、key rollover、CapsLock、Option/dead key、中文 IME 桌面矩阵（`cat`/历史/Tab/vim/nano/PTY resize/Ctrl+C 已有自动化覆盖，仍需人工确认）
- [x] 用可用 SSH 服务完成 macOS 密码/key/agent/cert/Jump 初连与五种认证路径断线重连回归；当前工作树最新证据见 `docs/verification/2026-10-11-macos-ssh-matrix-current.json`
- [ ] Windows/Linux/Pageant/串口仍按跨平台实机矩阵验收

### 2026-08-22 Phase 6.19 - Host Profile、会话状态、动态标题与物理输入资格门禁 🔄

- [x] 将 Host 的 `startupCommand` / `environment` 接入 local、SSH、Jump Host 的交互会话创建；重连沿用同一份 Host 配置
- [x] 本地 PTY 在子进程 spawn 前注入环境，SSH 在 PTY 与 shell request 之间发送 RFC 4254 environment request
- [x] startup command 只在 PTY/SSH shell 建立后发送，并为 profile 输入增加数量、控制字符和长度校验
- [x] 增加 profile IPC、SSH request 顺序和 launcher payload 回归；Rust profile 定向测试、前端 815 项测试通过
- [x] 将 `TerminalSessionManager` 的连接状态投影到所属 `Tab.connectionStatus`，标签栏显示连接中/已连接/断开状态点并保持原有键盘可访问性
- [x] 增加容器与标签栏状态投影回归，定向测试 17 项通过
- [x] 工作区与主机恢复并行加载，布局查询在 workspace id 确定后立即启动，避免首屏恢复时间被独立 SQLite 读路径串行叠加；新增并行启动回归
- [x] 接入 xterm OSC 0/2 标题事件；标题规范化为单行、最多 160 字符并投影到标签栏，恢复布局时丢弃进程内动态标题
- [x] 动态标题与 xterm 订阅回归、标题工具函数回归；全量前端 97 个测试文件/822 项通过
- [x] 修复标准 Tauri/xterm smoke 的 Unicode 阶段超时：隔离 SSH shell 显式设置 `LANG/LC_CTYPE=en_US.UTF-8`，最新调试包完成 8 MiB、10 次会话、97×31 resize 和资源回收（约 6 秒）
- [x] 修复重连 smoke 只重启监听 daemon、未断开独立 `sshd-session` 进程组的问题；localhost OpenSSH 真实断线后建立不同 session，10 轮共 11 个唯一 session，旧输出拒绝且资源全部回收（约 6.7 秒）
- [x] smoke 夹具对 PID/PPID/PGID 严格校验并 fail-closed；session 与 daemon 先 `SIGTERM`，宽限期后分别升级 `SIGKILL`，Node 脚本回归 23 项通过
- [ ] 在 Tauri WKWebView 探针页完成至少 30 轮物理 `a/s/d` 重叠按键，并记录 expected/received hex
- [ ] 在 localhost public-key 重连基线之上继续完成真实 SSH password/key/agent/cert/Jump 认证矩阵，以及 Windows/Linux/Pageant/串口实机矩阵
- [x] 增加 Shell Integration v1：通过 `term.parser.registerOscHandler` 监听 OSC 133/7，投影命令阶段/退出码与当前目录，非法 payload 安全忽略；不改写输入、不注入 shell 配置
- [x] 修复主终端初始化误用 OSC API 的崩溃，以及 Tauri style nonce/hash 使 WebKit 拒绝 xterm 动态样式的问题；真实 debug App 主终端 Connected 且 Web Inspector 零错误
- [ ] 为常见 bash/zsh/fish 提供用户显式开启的 Shell Integration 注入配置，并完成真实 shell/vim/tmux/SSH 验收

---

### 2026-08-28 Phase 6.20 - 真实 SSH 认证矩阵与物理键盘探针自动化 ✅ macOS 实机验收完成

> 目标：把「打开应用后 10 秒内进入可靠终端」变成有门禁、有证据的验收；用真实 SSH 服务覆盖全部认证方式与断线重连；为物理键盘资格门禁建立可重复的自动化。

- [x] smoke 配置扩展 `authMode`（key/password/agent/cert）与可选 `jump` 块：前端 `terminal-smoke-contract.ts`、Rust `terminal_smoke.rs` 双端严格校验（未知字段拒绝、按模式校验凭据组合、证书与私钥格式、jump 仅限 key 模式），`terminal-smoke-round-request.ts` 按模式构建 Host，前端与 Rust 定向测试覆盖
- [x] `firstConnectionMs` 进入结果契约：前端采集 Rust `terminal_smoke_connected` 的进程时钟毫秒，Rust/runner 双端门禁「首次连接 < 10 秒」，失败结果固定为 0
- [x] sshd fixture 支持 cert 模式（本地 CA 签发、`TrustedUserCAKeys`、证书内嵌 `clear/permit-pty/force-command/source-address` 隔离策略——macOS sshd 对证书认证不套用 authorized_keys `command=` 选项）与 jump 角色（`AllowTcpForwarding yes` + `PermitOpen` 只放行目标端口、`no-pty`）；就绪探针用真实 `ssh -o CertificateFile` 证明证书认证
- [x] 密码认证使用全新 `terminal-smoke-password-sshd.mjs`：Debian OpenSSH 容器（真实 shadow 密码、`AuthenticationMethods password`、ForceCommand 隔离 shell、SSH banner 就绪探测、restart/stop）
- [x] agent 认证启动隔离 `ssh-agent` 并注入 `SSH_AUTH_SOCK`；jump 用例合成 target+jump 双实例连接配置
- [x] `smoke:ssh-matrix` 一次构建复用同一 debug 二进制跑 7 个用例；**本机真实验收全绿**（详见 issue.md Issue #57）
- [x] 物理键盘探针自动化：Rust `input_probe` 门控模块（env 显式开启、绝对路径、checkpoint/结果原子写入与严格校验），前端 `automation-root`（本地 PTY + 探针协议 + 每轮 checkpoint + 最终结果），`smoke:input-probe` 驱动（CGEvent 重叠按键注入器、Accessibility 权限检查、osascript 激活、manual 引导模式、checkpoint-only 模式）
- [x] Linux 可移植：sshd fixture 与 runner 放开 linux、`TERMINAL_SMOKE_TMP` 规避 /tmp StrictModes；新增 `.github/workflows/real-machine-matrix.yml`（macOS 全矩阵 + WKWebView 探针协议验证；Linux Xvfb 下 key/reconnect smoke；Windows 保持人工清单）
- [x] 全量门禁：前端 859 项、Team Server 103 项、Rust 164 单测 + 3 集成、Node smoke 脚本 36 项测试全部通过
- [x] 30 轮真实 CGEvent 重叠 `a/s/d` 注入：2026-09-22 严格单次注入、全部 hex 匹配并恢复输入源；见 Phase 6.24 / Issue #58
- [x] 在 Linux runner 首次 dispatch 执行 real-machine 工作流（run 33183284820 全绿；首跑 run 33181335600 暴露的两处问题已修复，详见 Phase 6.21）
- [ ] Windows OpenSSH/Pageant/PTY 实机按 issue.md Issue #21/#22/#39 人工清单

---

### 2026-08-28 Phase 6.21 - 跨平台实机矩阵 CI 收口 ✅ macOS/Linux runner 全矩阵通过

> 目标：让「真实 SSH 认证矩阵 + 断线重连 + WKWebView 探针协议」在 GitHub 原生 runner 上可重复执行并全绿。

- [x] 基线复验：`pnpm verify` 全绿（前端 859、Team Server 103、Rust 164 单测 + 3 集成、Node smoke 脚本 36 项、507 文件规模门禁）
- [x] 修复矩阵 runner import 副作用：`run-terminal-smoke-matrix.mjs` 底部无条件 `main()` 会在测试导入时启动整场矩阵，补 `isDirectRun` 守卫
- [x] 矩阵 runner 支持逗号分隔用例过滤（`selectCases` 导出 + 3 项新单测），按 runner 能力拆分矩阵
- [x] 工作流拆分：macOS runner 无 Docker，password/password-reconnect 移至 Linux job 的 Debian OpenSSH 容器执行；Linux job 补 `libudev-dev`/`pkg-config` 修复 `libudev-sys` 构建失败
- [x] real-machine 工作流 run `33183284820` 全绿：macOS `key` 6955ms / `key-reconnect` 4211ms（11 sessions）/ `agent` 3221ms / `cert` 3481ms / `jump` 3592ms；Linux `password` 1048ms / `password-reconnect` 1047ms（11 sessions）；全部用例首次连接 < 10 秒门禁、10 轮隔离会话、8 MiB 输出与资源回收
- [x] WKWebView 探针协议双端验证：GitHub macOS runner 与本机 debug App（checkpoint-only）均确认 `input_probe_ready` awaiting-input checkpoint 正常发布
- [x] 30 轮原生 CGEvent 重叠 `a/s/d`（2026-09-22，严格零重发）；人工物理键入另列 Phase 6.24 待验收

### 2026-09-22 Phase 6.24 - 输入探针前置条件与严格验收 ✅ ASCII CGEvent 通过，人工/IME 待验收

- [x] 定位 IME 提交与 shell 回车的区别；记录 keyCode、DOM 输入类型、xterm onData/onBinary 与焦点 target
- [x] 增加 `--input-source ascii` 临时切换与恢复校验；默认保留当前输入源并拒绝不适用的 ASCII 重叠用例
- [x] 修复空白区域点击丢焦点；禁止整轮自动重发掩盖丢键；顶层成功必须逐轮 hex 匹配
- [x] 应用提前退出后取消 checkpoint 轮询；输入源选择、恢复失败、丢轮和结果校验回归通过
- [x] 最终代码下严格 30 轮 CGEvent：每轮只注入一次、回读全部为 `617364`，总耗时 111547ms，原输入源恢复；详见 `docs/verification/2026-09-22-macos-input-probe.json`
- [x] Node 24.16.0 下前端 104 文件/888 项、Team Server 103 项、Rust 181+3 项、Node 脚本 56 项，以及 lint/typecheck/build budget/fmt/Clippy/511 文件规模与差异门禁通过
- [x] 2026-10-09 当前源码下 macOS `smoke:ssh-matrix` 7/7 全绿：首次连接 972–2171ms，key/password 重连 11 个唯一 session；逐用例记录见 `docs/verification/2026-10-09-macos-ssh-matrix.json`
- [x] 2026-10-10 当前源码下 macOS `smoke:ssh-matrix` 7/7 全绿：首次连接 866–2035ms，key/password 重连各 11 个唯一 session；历史逐用例记录见 `docs/verification/2026-10-10-macos-ssh-matrix.json`
- [x] 2026-10-11 当前工作树复跑 macOS `smoke:ssh-matrix` 10/10 全绿：首次连接 925–4410ms，key/password/agent/cert/Jump 重连各 11 个唯一 session；逐用例记录见 `docs/verification/2026-10-11-macos-ssh-matrix-current.json`
- [x] 2026-10-09 macOS 正式 debug bundle 本地冷启动 AX readiness 三次观测 4477–5840ms，均低于 10 秒；记录见 `docs/verification/2026-10-09-macos-cold-start.json`，严格进程 stopwatch 与远程 SSH 冷启动仍另行验收
- [x] 2026-10-10 SSH host-key direct/jump preflight 统一 8 秒绝对 deadline；网络与 `known_hosts` 检查共用预算，超时进入可重试 gate error，未知/变更 key 信任流程不变
- [x] 新增 macOS 进程级 cold-start stopwatch（`spawn` → 三项 AX-visible readiness；shell 交互由本地 PTY smoke 证明），native helper 与 11 项 Node 回归已纳入 `pnpm verify scripts`；Node 24.16.0 历史真实 `spawnToReadyMs=4963` 基线见 Phase 6.29，历史复跑曾为 4885ms；当前四次复测为 5648/4920/4647/4595ms
- [ ] 人工物理键入、中文 IME、Option/dead key 及 Windows/串口实机矩阵

  2026-10-09：已修复组合态 Escape 不应写入 PTY 的 xterm core 分支，并通过 8 项回归；自动 CGEvent 在 Apple Pinyin 下仍只产生普通 `insertText`，中文 IME 需人工物理键盘验收。

### 2026-10-10 Phase 6.26 - xterm 输入协议事件级回归 ✅ 前端桥接通过（真实 Tauri/PTY 回读见 Phase 6.27）

- [x] 真实打开兼容版 `@baicie/xterm@0.1.7`，启用 SGR mouse 后验证 `onData` 精确报告经 `registerTerminalInput` 进入文本 FIFO
- [x] 启用 DECSET 2004 后验证 `term.paste()` 发送 bracketed paste 起止序列，并保留换行规范化行为
- [x] 启用 X10/default mouse 后在高位坐标触发 `onBinary`，验证 `Uint8Array` raw bytes 未经文本解码或重写
- [x] Node 24.16.0 下相关 29 项定向测试、前端 typecheck、该测试文件 lint 通过；全量 `pnpm verify all` 为前端 105 文件/891 项、Team Server 103 项、Rust 181+3 项、Node 63 项全部通过
- [x] 真实 Tauri IPC/PTY 回读：2026-10-10 SGR mouse、bracketed paste、raw X10 三 case 均精确通过；记录见 `docs/verification/2026-10-10-macos-raw-input.json`
- [ ] 非 UTF-8 原始输入、物理鼠标/系统粘贴及连续 resize 实机验收

### 2026-10-10 Phase 6.27 - 真实 Tauri/PTY raw 输入探针 ✅ 三个协议 case 实机通过，人工交互仍待验收

- [x] 新增显式 `TERMINAL_RAW_INPUT_PROBE=1` gate、绝对结果路径、固定 case/hex 契约和原子结果写入；默认产品启动不启用探针
- [x] 新增 `smoke:raw-input` runner，仅允许 macOS，使用真实 Tauri/WKWebView + local PTY，覆盖 SGR mouse、bracketed paste 和高位 X10/default mouse raw bytes
- [x] 新增 Rust 2 项、前端 protocol/bootstrap 11 项、Node runner 4 项定向回归，并纳入 `node scripts/verify.mjs scripts` / Rust 全量测试
- [x] Node 24.16.0 下当前门禁：前端 109 文件/925 项、Team Server 103 项、Rust 189+3 项、Node 脚本 114 项及相关质量门禁通过；本轮新增定向门禁另行复验通过
- [x] 2026-10-11 本地 `smoke:terminal` 初次分支通过：8 MiB 输出、10 轮会话、连续四步 resize 精确回读（132×43→90×30→120×40→97×31）、资源回收全绿；Node 24.16.0 下首次连接 1612ms，总耗时 7639ms；记录见 `docs/verification/2026-10-10-macos-terminal-smoke.json`
- [x] 2026-10-11 本地 `smoke:terminal:reconnect` 通过：重连后 11 个唯一 session、旧输出拒绝、连续四步 resize 精确回读、资源回收全绿；Node 24.16.0 下首次连接 1441ms，总耗时 8586ms；记录见 `docs/verification/2026-10-10-macos-terminal-reconnect-smoke.json`
- [x] 已在可用 GUI/Accessibility/WKWebView 环境逐 case 执行并保存成功证据；此前锁屏记录保留为失败边界
- [ ] 物理鼠标、系统粘贴、中文 IME、Option/dead key 和 Windows/Pageant/PTY/串口仍不计入通过；连续 resize 已由 macOS Tauri/PTY smoke 自动化覆盖，仍需人工交互矩阵复验

### 2026-10-10 Phase 6.28 - 启动兜底与重叠会话生命周期 🟡 自动化完成，实机边界保持不变

> 目标：在工作区恢复或连接启动变慢时仍尽快给用户一个可输入的本地终端，并确保迟到的 session 不污染用户已创建的 tab 或后续生命周期。

- [x] 启动恢复超过 2 秒且当前仍无 tab 时创建临时本地 tab（`startupFallback: true`）；组件卸载时取消计时器。
- [x] 修复无 saved layout 时 fallback 的持久化窗口：recovery 订阅建立后将当前 tab 纳入 journal/debounce，落盘时去除 `startupFallback` 进程态标记；workspace-recovery 回归覆盖该路径。
- [x] 迟到的 workspace/layout 恢复只允许替换全是临时 fallback 的 tab；用户已创建的本地或远程 tab 不会被恢复结果覆盖。
- [x] `TerminalSessionManager.close()` 等待 record 上所有重叠的 start promise 及 reconnect promise，再完成 backend close 和生命周期退休；迟到 session 继续由 generation/closed 守卫回收。
- [x] connection attempt id 在监听注册前创建并可取消；关闭或 generation retirement 时 best-effort cancel，迟到监听不会启动已退休的远程 session。
- [x] lifecycle buffer 溢出只标记发生溢出的 session，后续新 session 不继承旧的 overflow error；有界集合和 retire 路径保持可回收。
- [x] App、workspace-recovery、session manager 与 lifecycle buffer 定向回归覆盖兜底、迟到恢复、重叠启动关闭、取消竞态和 session-local overflow；完整门禁结果仍以当前 `pnpm verify all` 输出为准。
- [x] 当前工作树取得严格 `spawn → AX readiness` cold-start 结果：native ApplicationServices helper 四次为 4716/4649/4537/4566ms；锁屏/System Events 失败边界保留在 `docs/verification/2026-10-10-macos-cold-start-blocked.json`，当前证据见 `docs/verification/2026-10-11-macos-cold-start-current.json`
- [x] 取得 `sgr-mouse`、`bracketed-paste`、`raw-x10` 三个 raw-input case 的真实 Tauri/WKWebView/PTY 成功结果；记录见 `docs/verification/2026-10-10-macos-raw-input.json`，此前锁屏超时记录不计为通过。

### 2026-10-11 Phase 6.30 - 远程 shell prompt marker round-trip 🟡 实现探针通过，发布/人工边界待验收

- [x] 新增 `scripts/macos-ax-probe.swift`：使用 ApplicationServices `AXUIElementCreateApplication` 按 PID 遍历全部窗口和有限深度子树，输出四位 readiness 协议。
- [x] `smoke:cold-start` 默认在应用 spawn 前编译并使用 native helper；新增 `--ax-probe osascript` 显式 legacy fallback，编译失败、AX 输出异常和超时均 fail-closed。
- [x] Node 24.16.0 下 cold-start 脚本 11 项回归通过；Swift 6.1.2 / macOS 15.7.7 arm64 helper 编译通过。
- [x] 用 native helper 取得当前工作树有效 `spawn → AX readiness` 数值：4716/4649/4537/4566ms；证据见 `docs/verification/2026-10-11-macos-cold-start-current.json`
- [x] 当前 debug binary 在 Node 24.16.0 下重跑 bash startup marker + prompt marker round-trip 为 3330ms；独立证据见 `docs/verification/2026-10-11-macos-remote-shell-prompt-rerun.json`
- [x] prompt marker 经过 OSC 133 `prompt-start`、`xterm.input()`、Tauri IPC、SSH PTY 和 terminal output；remote AX flags 仅作诊断
- [x] 在 Node 24.16.x 支持环境重跑并纳入发布门禁；xterm canvas prompt、macOS 人工物理键盘与中文 IME 仍不由自动 marker 冒充通过

### 2026-10-11 Phase 6.31 - 本地 shell 交互矩阵 ✅ 自动化通过，人工/跨平台边界待验收

> 目标：在真实 Tauri/WKWebView、xterm 输入链路和 local PTY 上验证日常 shell 的 EOF、历史回放与 Tab 补全，不把自动输入冒充物理键盘或 IME 结果。

- [x] 新增独立 `TERMINAL_SHELL_PROBE=1` gate、绝对结果路径、固定 case/trace/input 结果契约和原子 JSON 发布；普通产品启动默认不启用探针。
- [x] 新增 `smoke:shell-probe` 与 `smoke:shell-probe:matrix`，覆盖 `cat-eof`、`readline-history`、`readline-tab`；输入统一经 `term.input(data, true)` → xterm `onData` → session FIFO → local PTY。
- [x] 修复 canonical PTY 的 `cat` EOF 语义：先提交 `cat-eof-probe\r`，再在空读边界发送 EOT；shell 侧命令替换去除单个尾换行后精确比较。
- [x] 2026-10-16 macOS 15.7.7 arm64 当前工作树 debug binary 七个 case 在 bash 与 zsh 上 14/14 全绿；同七个 case 经真实 loopback sshd 默认 `/bin/sh` fixture 为 7/7；当前证据见 `docs/verification/2026-10-11-macos-shell-interaction-current.json`，旧二进制结果保留在 `docs/verification/2026-10-11-macos-shell-interaction-probe.json`。
- [x] 新增前端 protocol、Node runner/matrix、Rust state 定向测试；当前门禁基线为前端 117 文件/975 项、Team Server 25 文件/103 项、Rust 194+3、Node 脚本 141 项。
- [x] 修复 `vim-edit` 的 step 标记死锁（改由 ready 驱动编辑按键）与 `ctrl-c-interrupt` 在 bash 下的误判（移除受 shell 列表语义影响的尾部标记，并要求结果包含原始 `03` 字节）。
- [x] 新增 `nano-edit` case，并修复 `result.ts` 与 `protocol.ts` case 列表漂移导致新 case 被静默拒绝的问题（改为导出 `SHELL_PROBE_CASES` 并加同步测试）。
- [x] 新增 `pty-resize` case，用 `stty size` 逐档回读本地 PTY 真实几何（132x43/90x30/120x40/97x31），补上此前只有 SSH smoke 覆盖远端 resize 的空缺。
- [ ] 物理键盘、中文 IME、Option/dead key 及 Windows OpenSSH Agent/Pageant/PTY、串口硬件仍按实机矩阵验收；自动化 `term.input()` 不计入人工通过。

### 2026-10-11 Phase 6.32 - 五种 SSH 认证路径初连与断线重连矩阵 ✅ macOS 自动化通过，人工/跨平台边界待验收

> 目标：用真实 localhost OpenSSH 服务覆盖 password、key、agent、cert、Jump Host 五种认证路径的首次连接、断线重连、输出隔离、resize、资源回收和 10 秒启动门禁。

- [x] 新增 `agent-reconnect`、`cert-reconnect`、`jump-reconnect` 三个真实重连 case；Jump Host 按“先重启跳板、再重启目标”顺序重建 direct-tcpip transport，避免复用旧路径。
- [x] 2026-10-17 当前工作树 macOS 15.7.7 arm64 / Node 24.16.0 / Docker 29.7.2 下 `smoke:ssh-matrix --reuse-binary` 13/13 全绿：首次连接 1048–9629ms，覆盖 key/password/agent/cert/Jump、重连、5 秒与 20 秒 outage、首连 outage；证据见 `docs/verification/2026-10-11-macos-ssh-matrix-current.json`。
- [x] 每个 case 覆盖 10 轮隔离会话、8 MiB 输出、97×31 resize、旧输出拒绝和资源回收；失败时会清理目标及跳板 fixture。
- [x] 逐用例耗时、二进制 SHA-256、覆盖范围和限制见 [`2026-10-11-macos-ssh-matrix-current.json`](verification/2026-10-11-macos-ssh-matrix-current.json)。
- [x] 修复 `.github/workflows/real-machine-matrix.yml` 对历史 `main` 缺失 `.node-version` 的依赖，macOS/Linux runner 显式固定 Node 24.16.0；real-machine run `38997341490` 已复验。
- [x] 将 `cat-eof`、readline history、readline Tab 的真实 Tauri/WKWebView + local PTY shell 矩阵接入 macOS real-machine job；real-machine run `38997341490` 已通过。
- [x] 将最终 debug binary 的远程 SSH startup marker + OSC 133 prompt marker cold-start 接入 macOS real-machine job；real-machine run `38997341490` 已通过。
- [ ] Windows OpenSSH Agent/Pageant、Windows/Linux 本地 PTY、串口硬件以及 macOS 物理键盘、中文 IME、Option/dead key、vim/nano 仍待实机验收；当前没有对应设备，不能由 CI 或自动输入替代。

- [x] 2026-10-13 当前门禁复验：前端 961、Team Server 103、Rust 193+3、Node 133，`pnpm verify` 全绿；release binary 本地冷启动 4973ms、远程 prompt marker 3627ms，证据见 `docs/verification/2026-10-13-macos-release-cold-start-rerun.json`。

### 2026-10-11 Phase 6.39 - 在含新改动的 debug bundle 上重测并刷新证据 ✅ 通过

> 目标：Phase 6.38 只刷新了 release 侧证据；debug 侧四份「current」证据仍引用 `6d66a062…`，而磁盘上的 debug 二进制早已是别的产物，其中包含的启动/唤醒/面板改动同样未被证明。

- [x] 核对发现：证据一致性门禁只校验**同一 profile 内部**哈希一致，不校验与磁盘二进制的对应关系，因此四份过时的 debug「current」证据一直被放行。
- [x] `pnpm tauri build --debug --no-bundle` 重建后在同一二进制 `4513f1e4…` 上重测：本地冷启动重复三次 4382–4522ms，远程 prompt round-trip 2298ms，SSH 矩阵 10/10 全绿（首次连接 1022–1785ms），shell 交互三 case 332/280/400ms 全绿。
- [x] 过程中 SSH matrix runner 会重新链接 debug 二进制，因此先跑矩阵、再在该最终二进制上重测冷启动/远程/shell 三项，并从 runner 输出中核对 `binarySha256` 确为同一产物后才写入证据，避免引用不同构建的数字。
- [x] 四份 debug「current」证据（冷启动、远程 prompt、shell 交互、SSH 矩阵）全部刷新到同一二进制哈希。
- [x] 补上门禁缺口：`check-verification-evidence` 之前只校验同一 profile 内部哈希一致。release profile 现在与磁盘真实二进制比对，不一致或未构建都 fail-closed；debug profile 改为与「已复核哈希」比对，因为 `pnpm verify` 自身会跑 cargo 并把 `target/debug/terminal` 重新链接成前端未内嵌的裸 cargo 产物，磁盘上的 debug 产物在同一门禁内永远不可能匹配 `tauri build --debug` 的证据。新增 2 项回归（证据描述的二进制已不在磁盘、profile 二进制未构建）。
- [x] 修复自查发现的实现 bug：`files` 是 `[file, profile]` 二元组，却被当作字符串用作 `hashesByFile` 的键，导致整段检查被静默跳过——正是新门禁最初「测试通过但实际没跑」的原因，靠逐层打印实测值才定位到。

### 2026-10-12 Phase 6.51 - 新增真实断线场景：跨多次退避阶梯的重连不再是空白 ✅ 通过

> 目标：现有 5 个 reconnect case 都只是把 sshd 重启一下，几十毫秒内又可达，因此**第一次重连尝试必然成功**——退避阶梯从未被端到端验证过。

- [x] 定位覆盖缺口：`restart()` 停掉再启动 sshd 并等待就绪，实测毫秒级恢复。而休眠、VPN 切换、NAT 超时的真实形态是**服务端长时间不可达**，客户端必须走过 500ms/1s/2s/4s 的指数退避。这条路径此前没有任何真实二进制覆盖。
- [x] `terminal-smoke-sshd.mjs` 新增 `interrupt({ holdMs })`：停掉 daemon 后保持不可达 `holdMs` 再拉起。`restart` 与 `interrupt` 都替换 daemon handle，因此串行化避免并发操作同一 handle。
- [x] 矩阵新增 `key-outage-reconnect`（holdMs=5000），runner 通过 `outageHoldMs` 透传；前端无需改动——`use-terminal-smoke-round` 已经在 `reconnecting` 期间等待而非直接失败，本来就能容忍多次重试。
- [x] 新增测试「interrupt keeps the host unreachable across several reconnect attempts」，还原实现前确实转 RED（`fixture.interrupt is not a function`）。
- [x] **真实二进制验证**：`key-outage-reconnect` 总耗时 13169ms / 14188ms，而同一二进制上普通 `key-reconnect` 为 7290ms，差值约 6.9 秒 ≈ 5 秒中断窗口加退避阶梯。若客户端第一次重连就成功，不可能多出这段时间——这是阶梯确实被走完的可测量证据。
- [x] 完整矩阵扩展为 **11/11 全绿**，六个 reconnect case 均为 11 个唯一 session 对 10 个。
- [x] **明确并验证长中断边界**：自动重连预算为 500ms/1s/2s/4s/8s ≈ **15.5 秒**。`key-outage-reconnect` 的 5 秒中断验证阶梯内恢复；`key-outage-wake-reconnect` 在当前 instrumented binary 上保持主机不可达 20 秒，确认超预算后落到 `status: 'error'` + `retryable: true`，由 host-wake smoke 控制通道合成恢复并通过重连，最终 `hostWakeSynthesized=true`、11 个唯一 session。真实合盖睡眠、VPN/蜂窝切换仍需 macOS 实机。
- [ ] 真实合盖唤醒与网络切换仍缺实机覆盖；自动化 host-wake case 不能替代人工验收。

### 2026-10-12 Phase 6.50 - 关闭证据门禁盲区：源码指纹让「改了没重测」可被直接发现 ✅ 通过

> 目标：把 Issue #75 从「已记录的人工流程」升级为门禁自动拦截。

- [x] `computeSourceFingerprint()` 对验收场景实际触及的源码做内容哈希（`packages/frontend/src`、`src-tauri/src`、三个 package/lock 文件）。**刻意排除 docs 与证据文件**——一个会因为改个错别字就移动的指纹，只会训练人忽略这道门禁，而不是让人去重测。
- [x] 门禁新增比对：debug 证据的 `source.fingerprint` 与当前树不一致即失败，并给出可执行诊断。未记录指纹的文件跳过该项，不一刀切否定既有证据。
- [x] 新增 2 项测试，还原实现前确实转 RED；门禁脚本测试 125 → 127。
- [x] 端到端验证：向 `packages/frontend/src/store/app.ts` 追加一行注释 → 门禁 EXIT=1 并报出 4 条 problem，指纹 `23a7cca0…` → `ad8cdc6f…`；恢复后通过。
- [x] 负向验证：只改 `docs/todo.md` 时门禁保持通过，确认无噪声误报。
- [x] 四份 debug 证据补录指纹；`pnpm verify` 全绿（前端 958、Team Server 103、Rust 191+3、Node 脚本 127、526 文件行数、6 份证据一致性）。

### 2026-10-13 Phase 6.52 - 手动 IME 输入源资格门禁与远端矩阵补齐 🟡 自动化契约通过，实机仍待验收

> 目标：让手动中文 IME 验收在开始输入前确认使用的是真实非 ASCII keyboard input method，并让远端 SSH workflow 与本地 12/12 证据覆盖一致。

- [x] `run-input-probe.mjs --inject manual --scenario ime-*` 复用原生 TIS helper；拒绝 ASCII layout，接受 `TISTypeKeyboardInputMethod`/`TISTypeKeyboardInputMode`，逐轮检测输入源未漂移，并记录 source id/type/asciiCapable。
- [x] 新增 ASCII 输入源拒绝、有效非 ASCII 输入源记录与 composition 证据回归；输入探针与 source 定向测试 19/19 通过。
- [x] macOS real-machine job 补齐 `key-outage-reconnect` 与 `key-outage-wake-reconnect`，Linux job 保留两项 password case，工作流契约测试通过，合计声明 12 个 SSH case。
- [ ] 修改后的 workflow 尚未重新 dispatch；真人物理键盘 30 轮、中文 IME/Option/dead key、合盖睡眠/VPN 切换和 Windows/Pageant/PTY/串口仍保持未验证。

### 2026-10-13 Phase 6.53 - 非 Tauri 启动探针安全降级 ✅ 自动化通过

> 目标：浏览器开发预览没有 Tauri IPC 时，启动流程仍能进入可诊断的终端界面，不因远程 prompt 探针调用不存在的命令而触发 StartupError。

- [x] `loadRemotePromptProbeConfig()` 增加 Tauri runtime guard；非 Tauri 环境直接返回空配置，桌面运行时仍通过 `remote_prompt_probe_config` 加载并校验配置。
- [x] 新增远程 prompt probe 回归，覆盖非 Tauri 不调用 IPC、Tauri 正常加载及既有配置字段/控制字符校验；定向测试 4/4 通过，typecheck 通过。
- [ ] 该修复不替代 macOS 物理键盘/中文 IME、真实合盖唤醒、VPN/蜂窝切换或 Windows/Pageant/PTY/串口实机验收。

### 2026-10-13 Phase 6.55 - shell 交互探针覆盖真实 SSH 传输 ✅ 自动化通过

> 目标：把行编辑、PTY 几何与 Ctrl+C 从「只在本地 PTY 上成立」提升为「在真实 SSH 会话上也成立」。

- [x] 定位真实空缺：SSH 矩阵覆盖吞吐、Unicode、resize 与重连，但从未在 SSH 会话上跑过交互 case。PTY 请求、窗口尺寸传播与信号投递是 PTY 与 SSH channel 差异最大的地方，只跑本地 PTY 等于把这块留白。
- [x] `run-terminal-shell-probe.mjs` 新增 `--transport ssh`，复用 smoke 矩阵**同一个** loopback sshd fixture 与同一份 Rust 校验（`terminal_smoke::read_ssh_config`），而不是另写假服务器——这些 case 要证明的正是真实 server 行为。
- [x] Rust `shell_probe_config` 增加可选 `ssh` 目标；前端在有目标时构造 remote request（`expectedHostKey` + key 认证），无目标时保持原 local PTY 路径。
- [x] 修掉一处真实的规则漂移：前端最初手写的 SSH 校验漏了「key 模式禁止 certificate」，而 Rust 侧是拒绝的。改为直接复用 `parseTerminalSmokeSshConfig`，一处规则一个来源，同时把探针 bundle 压回预算内（首次实现超出 gzip 预算 0.04 KB）。
- [x] `--transport ssh` 明确拒绝与 `--shells` 组合：SSH 的登录 shell 属于 fixture 而非本进程，强行指定只会把测量结果标错传输。
- [x] 定位并修掉参数解析缺陷：`--transport ssh` 的值此前会被位置参数过滤器当成 case 名，报成「unknown shell probe case 'ssh'」。新增回归锁定。
- [x] Node runner 测试：SSH 传输必须把 fixture 的真实连接信息交给应用（静默退回本地 PTY 会为错误的传输报通过）、不得泄漏 `TERMINAL_DEFAULT_SHELL`、必须拆除 fixture；不支持的传输在 spawn 前就失败。
- [x] real-machine workflow 的 macOS job 新增 `--transport ssh` 步骤，并有契约测试锁定。
- [x] macOS 15.7.7 arm64 同一 debug 二进制 `c04caea6…`：本地 14/14（bash+zsh）、真实 SSH 7/7、`smoke:ssh-matrix` 12/12 全绿；冷启动 3640/3228/3401ms，远程 prompt marker 1683ms。
- [x] `pnpm verify` 全绿：前端 977、Team Server 103、Rust 194+3、Node 146、527 文件行数门禁、6 份证据一致性门禁、bundle 预算。
- [ ] 真人物理键盘 30 轮、中文 IME/Option/dead key、合盖睡眠/VPN/蜂窝切换，以及 Windows/Pageant/PTY/串口硬件仍待实机。

### 2026-10-13 Phase 6.54 - pending output 上限与 Linux 远程冷启动契约 ✅ 自动化通过

> 目标：避免连接竞态期间未知 session 的输出缓冲无限增长，并让 Linux 的远程 prompt 证据与 macOS workflow 共享同一可验证契约。

- [x] `TerminalSessionOutputBuffer` 对未激活 session 增加 1024 个 session 的全局上限；无后端 ACK 流控的最旧 pending session 会被驱逐，带 ACK 的输出不静默丢弃，仍交由生命周期回收。
- [x] `run-remote-cold-start-stopwatch.mjs` 导出跨平台 `appConfigDirectory()`，支持 macOS Application Support、Linux XDG_CONFIG_HOME 和 Windows APPDATA；Linux marker-only readiness 明确报告 `axProbe: none`。
- [x] real-machine workflow 增加 Linux shell interaction matrix 与远程 SSH prompt cold-start 步骤；Node 24 下新增/修复契约测试全部通过。
- [x] 2026-10-16 real-machine run `38819241300`：macOS SSH/shell/remote prompt/WKWebView checkpoint 全绿，Windows PowerShell/cmd ConPTY 全绿；Linux SSH/password 与 bash/zsh shell 通过。fish 因暂无独立 dialect 保持待验收。
- [x] 历史构建 `9cb3125b…` 的完整门禁通过：前端 963、Team Server 103、Rust 193+3、Node 140；macOS SSH 12/12、shell 333/246/406ms、冷启动 3676–4503ms、远程 prompt 1493–5647ms 均来自同一 instrumented debug binary `8f097da8…`。当前证据以本节顶部列出的 `4368d6c8…` / `de8e49cb…` 为准。
- [ ] 真人物理键盘 30 轮、中文 IME/Option/dead key/vim/nano、合盖睡眠/VPN/蜂窝切换和 Windows/Pageant/PTY/串口仍待实机；当前没有对应设备。

### 2026-10-13 Phase 6.57 - 应用退出期间 session 注册与 SSH handshake 取消 ✅ 自动化通过

> 目标：退出窗口关闭期间不允许迟到的建链重新登记，也不让未发布的 SSH handshake 继续运行。

- [x] `SessionManager` 注册与 `close_all()` 共用关闭 gate；退出开始后迟到 session 立即 close，不进入 sessions、metadata 或 channel registry。
- [x] Local/SSH 创建命令检查注册结果，退出竞态返回 `connection_cancelled`，避免前端把已关闭窗口上的 session 当作 connected。
- [x] 退出入口取消所有 process-local SSH connection attempts，再执行统一资源清理；覆盖 password/key/agent/cert/jump 的未发布握手。
- [x] Rust 回归覆盖 shutdown 后迟到注册关闭、registry 保持为空，以及 active handshake 全量取消；定向 `cargo test` 通过。
- [ ] 真实 macOS 窗口关闭、系统退出、合盖唤醒和跨平台退出行为仍需发布矩阵实机观测。

### 2026-10-13 Phase 6.58 - 显式关闭与应用 shutdown 生命周期 ✅ 自动化通过

> 目标：应用退出时等待所有已开始的 session close，避免显式关闭先从 registry 移除后被全局 shutdown 漏掉。

- [x] `SessionManager::remove_session()` 与 registry 摘除、`session.close()` 共用 lifecycle gate；shutdown 不会在显式 close 完成前返回。
- [x] 新增有界 timeout 回归，先确认无锁实现会提前返回，再释放阻塞 close 并验证 shutdown 完成。
- [x] 应用级退出 cleanup 总预算调整为 10 秒，覆盖 SSH/local 关闭路径的有界释放。
- [x] Rust 全量 198 单测 + 3 集成测试、Clippy `-D warnings`、fmt 与同一 debug binary 的真实 SSH/shell/cold-start 复验通过。
- [ ] 真实 macOS 窗口关闭、系统退出、合盖唤醒、VPN/蜂窝切换和 Windows/Linux/串口实机仍需发布矩阵观测。

### 2026-10-14 Phase 6.59 - 人工输入验收入口资格与超时加固 ✅ 自动化通过

> 目标：让人工键盘/IME 验收在开始前拒绝错误输入源，并给慢速人工输入足够的有界时间。

- [x] `--inject manual --scenario overlap` 现在通过原生 TIS helper 检查当前输入源必须为 ASCII；非 ASCII 输入源在发送任何轮次前失败并保留明确原因。
- [x] overlap 指引明确要求近同时按下并保持 `a/s/d` 后再释放，避免普通串行输入被误当作重叠按键验收。
- [x] 前端探针超时按轮数扩展到每轮 2 分钟预算加启动余量，与 Node 驱动的人工 checkpoint/result 等待窗口一致。
- [x] smoke/input/raw shell runner 统一解析 Windows 的 `terminal.exe` 与 `pnpm.cmd`；跨平台名称单测通过，但 Windows ConPTY、Agent/Pageant 和串口仍无实机证据。
- [x] 修复 `runMatrixCases()` 超时清理计时器被 `unref()` 导致 Node 事件循环提前退出的问题；永不结束的 case 现在会按预算产出失败行并继续后续 case，smoke 超时回归 36/36 通过。
- [x] 修复 Windows shell probe dialect 半成品造成的编译失败（`dialect.ts` 未导入 `createShellProbeInterruptCommand`、`result.ts` 从错误的模块取 dialect 符号）导致的启动白屏；抽出 `dialect-cases.ts` 叶子模块避开 `protocol -> result -> dialect -> protocol` 循环依赖，typecheck 与 28 项 shell probe 测试通过。见 Issue #82。
- [x] 修复 POSIX `cat-eof` 探针缺少 Ctrl+D 导致 `captured=$(cat)` 永久阻塞到超时；POSIX 发送 Ctrl+D、PowerShell/cmd 不发送，三项测试锁定该差异。见 Issue #83。
- [x] 启动失败界面改为按需动态 import，使 i18next 运行时与全部 locale 离开首屏包：initial gzip 从 182.06KB 降到 118.98KB（约 63KB），直接缩短打开应用到首个终端的关键路径。
- [x] 在源码指纹 `71cfb143…` 的 instrumented 二进制 `da6202f8…` 上复验四个证据场景：SSH 矩阵 12/12、本地 shell 14/14、真实 SSH shell 7/7、冷启动 4424/3430/3454/3436ms、远程 prompt marker 1619ms，证据一致性门禁通过。
- [x] 在源码指纹 `bc577a5d…` 的 instrumented 二进制 `23c7af6b…` 上复验四个证据场景：SSH 矩阵 12/12、本地 shell 14/14、真实 SSH shell 7/7、冷启动 5167/5671/5089ms、远程 prompt marker 3330ms，证据一致性门禁通过。
- [x] Node 输入探针与场景契约测试 26/26 通过；这些测试验证资格门禁和清理契约，不构成人工实机通过证据。
- [ ] 真人物理键盘 30 轮、中文 IME composition、Option/dead key、合盖睡眠/VPN/蜂窝切换仍待实机。
- [x] 跨平台 CI 补上 Windows shell dialect：新增 `windows-shell-matrix` job 在 `windows-latest` 真实 ConPTY 上跑 PowerShell 与 cmd，`--shells` 接入 `SUPPORTED_WINDOWS_SHELLS`，workflow 契约测试比对用例过滤串与 `DIALECT_CASES`。见 Issue #85。
- [x] 单用例 shell probe runner 在构建前拒绝 Windows dialect 不支持的 case，避免把参数错误拖成 Tauri 探针超时；Node 回归覆盖 PowerShell 请求 `vim-edit` 的 fail-fast。
- [x] 修掉两个会让验收结论失真的真实缺陷：`selectShellProbeCases` 残留分支引用作用域外的 `shells`（触发即 `ReferenceError`）；`terminal-smoke-sshd` 的 `interrupt()` 把等待定时器 `unref()` 导致事件循环提前退出、13 个用例被连带取消。Node 脚本由 147 恢复为 160/160。
- [ ] Windows shell dialect 的 CI job 尚未在远端 runner 上 dispatch 成功，取得 runner 输出前不得声称已验证。
- [x] 补上输入队列上限的缺失覆盖：`TerminalSessionIo` 的 1 MiB  ceilings 对文本与原始输入（粘贴/IME 路径）都生效，超限时报 `input queue exceeded` 并断开，此前两条路径都没有任何测试。区分力已验证——把上限放大 1000 倍后两项都变红。
- [x] 在新 instrumented 二进制 `c35ae453…`（源码指纹 `5e8a6de1…`）上重新采集全部四类 macOS 证据：冷启动四次 6540/4819/4497/4909ms、远程 prompt marker 3483ms、SSH 矩阵 12/12、shell 交互 bash+zsh 14/14 与真实 sshd 7/7。证据一致性门禁通过；已审哈希与理由一并更新。
- [~] 证据重采集中 `jump` 曾因主机负载失败一次（报错 10 秒未连接，但 READY 标记与 connected 状态均已出现，且该轮全部用例耗时约为平时两倍）；单独重跑与干净全矩阵重跑均通过，判定为负载而非回归，两次运行都保留在证据文件中。
- [x] 锁定 `use-terminal` 溢出恢复守卫在真实时序下的行为：溢出发生在 xterm 写入进行中时，`reset()` 必须等陈旧写入回调清掉 `writeInFlight` 才能排空新会话输出，否则两个并发 `xterm.write()` 会交错损坏字节流。实现正确、源码零改动；把清除语句加回去会让新测试与既有测试同时变红。见 Issue #87。
- [x] 修复事件监听注册失败时的通道监听泄漏：`terminal-error` 监听注册失败时，`ensure()` 只删缓存不撤销已注册的 data/close/exit 监听，重试后新旧并存导致**每一段输出都重复渲染且无任何报错**。修复在 catch 中先 await 通道 promise 再撤销；新增 3 项测试，含 tab type 相互隔离。见 Issue #88。
- [x] 修复串口读取跨块 UTF-8 字符损坏：读循环此前对每块 `read()` 结果直接 `from_utf8_lossy`，三字节中文字符在读边界被切开时变成 `��`，表现为只在非 ASCII 输出上偶发的乱码。改为复用 SSH 路径已有的 `Utf8StreamDecoder`，不另写一份。新增 3 项测试经由与读循环相同的转换路径驱动；把转换改回逐块有损后测试确实变红（输出 `��` 而非 `中`）。见 Issue #89。

- [x] 修复串口断连不等待读线程退出：`serial_disconnect` 此前只置位 stop 标志就返回，而阻塞读循环仍有端口克隆句柄，命令返回时设备通常还没释放；紧接着重连同一设备会和读线程退出赛跑，失败一侧报 `Failed to open serial port ...`（macOS/Linux 上通常是 device busy 一类）。改为给 `SerialSession` 加 `closed` 信号量，读循环丢弃端口克隆后才放行，断连等待该信号后才返回，因此命令返回即代表设备已释放。选 `Semaphore` 而非 `Notify`，避免断连早于读循环启动时错过一次性唤醒而永久挂起。新增测试断言的是释放时序而非标志本身；把辅助函数改回只置位标志后测试确实变红。见 Issue #90。

- [x] 修复串口拔线时吞掉最后一段输出：#89 引入流式解码器后，不完整尾部会留在 `pending` 里等下一块补齐，但循环退出（EOF／读错误／stop 置位）时没有冲刷，设备在多字节字符中途被拔掉就会让已收到的最后几个字节无声消失。把读循环提取为 `run_serial_read_loop` 并返回残留尾巴，调用处在正常输出之后把它作为最后一条 `serial-data` 发出，与 SSH 路径在 EOF 时的 `finish()` 行为对齐。提取后读循环首次可用脚本化假读器直接驱动测试，不必再靠「辅助函数与读循环写得像」间接保证一致。把 `finish()` 换成空串后新测试确实变红（`"ok"` ≠ `"ok\u{fffd}"`）。见 Issue #91。

- [x] 修复串口断连不等待在途写入：`serial_write` 从 session 表克隆出端口 `Arc` 后就释放了 session 锁，再进 blocking 写，因此 #90「断连返回即设备已释放」的保证存在漏洞——断连可能排在写入前面、等完读循环就返回，而那个写还开着设备，症状与 #10 完全一样。给 `SerialSession` 增加 `write_gate: RwLock`，写侧在克隆端口前拿读锁并跨越整个 blocking 写，断连在等完读循环后拿写锁排空。测试先后返工两次才具备区分力：最初版本即使移除整个修复仍然全绿，因为它测的是 `RwLock` 自身语义而非本项目代码；提取 `drain_in_flight_writes` 并让 `serial_disconnect` 实际调用后才真正变红。见 Issue #92。

- [x] Windows shell matrix job 的用例清单改为从 dialect 表派生：workflow 里 `--shells powershell cat-eof,pty-resize,ctrl-c-interrupt` 与 `--shells cmd cat-eof,ctrl-c-interrupt` 是 `DIALECT_CASES` 的人工镜像，而 probe runner 会 fail-fast 拒绝 dialect 未声明的用例，所以两者一旦漂移就会在 runner 上失败而不是在本地暴露。原契约测试同样把这两串硬编码在正则里，加了 case 也不会红。新增测试直接从 `dialect-cases.ts` 解析出每个 dialect 声明的用例再比对 workflow；给 cmd 加一个 `pty-resize` 而不改 workflow 后确实变红。顺带发现同一份 POSIX 清单实际被人工复述了三次（dialect 表、runner 的 `CASES`、workflow 的 macOS/Linux 步骤），测试同时比对 runner 与 dialect 表，从 runner 删掉 `nano-edit` 也会变红。见 Issue #93。

- [x] 删除 `SharedState` 中三个从未被写入的 session map（`local_sessions`、`shell_channels`、`agent_channels`）及 `LocalPtySession`、`AgentChannel`：全仓库对它们的引用只有声明、初始化、shutdown 里的 `clear()` 和一个把 `local_sessions` 当任意 mutex 用的测试，字段还挂着 `#[allow(dead_code)]`。本地 PTY 早在 `abc2966` 就迁到 `session::manager` 注册表，那条路径才真正 kill 子进程。留着会让维护者以为 shutdown 负责清理本地终端，查错地方。顺带补上此前零覆盖的串口退出路径测试（`app_exit_signals_every_serial_session_to_stop`），用 22 方法的假 `SerialPort` 构造真实 session；把 stop 置位去掉后测试确实变红。见 Issue #94。

- [x] bash 注入移除 `DEBUG` trap（#96）：`trap ... DEBUG` 在 bash 里是整体替换而不是叠加，会静默顶掉用户 `.bashrc` 自带的 DEBUG trap；注入在前时用户钩子消失，注入在后时 `133;B` 消失，两种都不报错。拿装了自有 trap 的真实 bash 对照验证两种顺序都会静默替换，`trap -p DEBUG` 串联方案也试过，后续任一次 `trap ... DEBUG` 会冲掉整条链。改为只用 `PROMPT_COMMAND` 发 `133;D;$?`/`133;A`/OSC 7；`133;B` 只写入无消费者的 phase 字段，因此放弃它。实测用户 trap、`133;D;0`、`133;D;1`、`133;A` 与 OSC 7 同时存在，无续行提示符污染；zsh 的 `add-zsh-hook` 本就叠加，用户 precmd 与 `133;B` 共存。测试断言片段不含 `trap `。bash 下 `command-start`/`command-output` 不再产生。
- [x] Shell Integration 注入落地（#95 的注入环）：解析器、`ShellIntegrationState`、每个终端的监听和 `container.tsx` 的转发早已接好，`use-remote-prompt-probe` 还把 `prompt-start` 当作远程首屏提示符的确定性信号，但没有任何 shell 发出 OSC 133/7，整条链路永远不触发。本地 PTY 启动时按**实际启动的** shell 注入单行片段：bash 只前插 `PROMPT_COMMAND` 发 `133;D;$?`/`133;A`/OSC 7（不再用 `DEBUG` trap 发 `133;B`，见 #96），zsh 用 `add-zsh-hook` 追加 `precmd`/`preexec`，两者都发 `133;D;$?`/`133;A`/OSC 7 且**不改 `PS1`**；fish/sh/cmd 不注入，`TERMINAL_SHELL_INTEGRATION=0` 可关。把 Rust 实际产生的字符串喂给真实 PTY 验证：bash 与 zsh 都拿到完整序列，`(exit 42)` 得到 `133;D;42`。zsh 第一版把 `preexec` 写成引号字符串，实机直接报 `function definition file not found`。测试还抓到 `CommandBuilder::get_shell()` 返回的是用户 login shell 而非传入的 shell。注入开启后本地矩阵 14/14、默认 `/bin/sh` 的真实 SSH shell 7/7、SSH 矩阵 13/13 全绿。fish、tmux、非 loopback 用户 SSH、Windows 仍待验收。

### 2026-10-11 Phase 6.49 - 启动设置读取失败不再静默重置用户偏好 ✅ 自动化通过

> 目标：沿「静默失败」这一在本项目反复出现的失效模式做系统排查，而非逐个碰巧发现。

- [x] 排查结论：启动主流程本身是健全的。`startTerminalApp` 失败会渲染带重试的 `StartupError`；workspace recovery 有 `[1000, 2000, 4000]` 有界重试；即使恢复彻底失败，`STARTUP_TERMINAL_FALLBACK_MS = 2000` 的兜底也会补一个本地终端标签，10 秒进入终端的目标不会被数据库故障击穿。`loadHosts` 对「非 Tauri 上下文」设 `dbAvailable:false` 但对真实 DB 错误**重新抛出**，交给 recovery 处理，语义正确。
- [x] 确认的真实缺陷：`hydrateFromDatabase()` 是主题、语言与全部持久化偏好的**唯一**来源，但它 `catch` 后只 `console.error` 并静默返回 `void`。数据库不可用时，应用看起来一切正常，用户的设置却整体回落到默认值，界面上没有任何解释——正是本项目反复出现的静默失效形态。
- [x] 修复：改为返回 `boolean`（成功 `true`、失败 `false`），`App.tsx` 在失败时通过 toast 显示 `startup.settingsRestoreFailed`，并补齐 en/cn/fr 三语文案。返回布尔值本身不足以让用户知情，因此必须同时接上可见提示。
- [x] 新增 `packages/frontend/src/store/app-hydration.test.ts`（2 项）。还原修复后失败用例确实转 RED（`undefined` vs `false`），确认有区分力。
- [x] 连带修正：`App.test.tsx` 的 `useTranslation` mock 只返回 `i18n`，新增的 `t` 调用在 8 个用例中产生 unhandled rejection。这些用例本身「全部通过」，是 vitest 的 `Errors` 计数与退出码拦住了它——若只看 `Tests 958 passed` 会误判为通过。
- [x] `pnpm verify` 全绿：前端 958 项 / 115 文件、Team Server 103、Rust 191+3、Node 脚本 125、526 文件行数门禁、6 份证据一致性门禁；typecheck 与 lint 干净；`git diff --check` 干净。
- [x] **用真实二进制复验本轮改动**（单测不足以覆盖启动路径）：在含设置水合改动的 instrumented 二进制 `554d8598…` 上重跑全部四个 debug 场景——SSH 矩阵 10/10 全绿（首次连接 899–2176ms）、本地冷启动 3582/3253/3409ms、远程 prompt 1583ms、shell 交互 335/227/370ms。证据 pin 与门禁测试夹具同步更新。
- [x] 顺带记录一个门禁盲区：debug profile 只比对 reviewed hash、不比对磁盘二进制（因为 `pnpm verify` 的 cargo 会重新链接 debug 产物），因此「改完前端但证据未复测」不会被门禁发现。本轮是靠人工比对 `shasum` 与 pin 发现的，不是门禁抓到的。
- [x] 该盲区已由 Phase 6.50 关闭（源码指纹比对）。release profile 始终受磁盘比对保护，不受影响。

### 2026-10-11 Phase 6.48 - listener 抛错不再杀死重连循环或静默丢弃输出 ✅ 自动化通过

> 目标：审计断线重连与会话生命周期，找出此前未被覆盖的逃逸路径。

- [x] 审计 `terminal-session-manager*` 全链路（start / reconnect / lifecycle / io / audience / wake-recovery）后定位到一个 Critical 缺陷：`TerminalSessionAudience` 直接调用 listener 回调且无异常隔离。
- [x] 后果一（重连循环被杀死）：状态在 `TerminalSessionReconnect.run()` 的 promise 链内部发布，`launch()` 用 `void promise.finally()` 挂载且无 catch。任一 listener 在 `reconnecting` 快照上抛错即让重试 promise reject，**整个 attempt 预算被放弃**——不再重试、不进 error 状态、无 unhandled rejection 提示，面板永久停在 `reconnecting`。
- [x] 后果二（输出静默丢弃）：drain 循环在交付前已把 chunk shift 出 buffer，listener 抛错会中止循环，该 chunk 及其后所有缓冲 chunk 一起消失且无报错。
- [x] 修复：新增 `notifyState()` 按 listener 隔离 `onState` 异常，`onOutput` 同样包裹；抛错的 listener 保留 delivery 记录，detach 时仍按既有 reclaim 路径按序重投，不丢数据。
- [x] 新增 2 项测试 `keeps the retry loop alive when one pane listener throws`、`keeps draining output when one listener throws`；逐个还原修复确认均转 RED，具备区分力。
- [x] **主动撤销一段无效改动**：我最初还加了 `launch()` 的 `promise.catch` 兜底并配了测试，但该测试无法转 RED——核对 `sleep` / `start` / `closeTerminalBackend` 三条路径后发现它们均已被覆盖，修复 audience 源头后该 catch 已不可达。保留即为提交测不到的死代码，故连测试一并撤销，只留源头修复。
- [x] 前端 956 项 / 114 文件全绿（原 954 + 新增 2）。
- [x] 范围边界：listener **返回 rejected promise** 仍会形成 unhandled rejection（回调返回值无人 await）。当前所有 `onState` / `onOutput` 实现均为同步，尚非实际缺陷，已在 Issue #73 记录。
- [x] `pnpm verify` 全绿、EXIT=0：前端 956 项 / 114 文件、Team Server 103 项、Rust 191 单测 + 3 集成测试、Node 脚本 125 项、526 个生产源码文件行数门禁、6 份证据一致性门禁；`git diff --check` 干净。

### 2026-10-11 Phase 6.47 - matrix runner 增加 case 级超时，单个卡死不再取消整轮验收 ✅ 通过

> 目标：修掉「一个 case 卡住 = 整轮验收静默消失」的隐患。

- [x] 定位：`run-terminal-smoke-matrix.mjs` 直接 `await runTerminalSmoke()`，没有任何外层时限。上一轮 6 分钟挂死虽已由 Issue #71 修掉根因，但只要未来任一 fixture、端口或子进程再出现不 settle，**该 case 之后的所有验收 case 都会被静默取消，整轮不产出任何结论**——而这恰恰是发布门禁最不能接受的失败模式。
- [x] 抽出 `runMatrixCases()`，用 `Promise.race` 为每个 case 施加 `CASE_TIMEOUT_MS`（300s，约为实测最慢 case `jump-reconnect` 8.4s 的 35 倍）。超时的 case 记为 `FAILED — terminal smoke case timed out after N ms`，其余 case 继续产出证据。
- [x] 通过 `onProgress` 回调保持原有终端输出逐字不变，`binarySha256` 仍在全部 case 跑完后统一附加。
- [x] 新增测试「a case that never settles is reported as failed instead of hanging the matrix」：第一个 case 返回永不 settle 的 promise，断言它被判失败、第二个 case 仍正常执行；旧实现下该用例会永久挂起。Node 脚本测试从 123 增至 124。
- [x] 排查同类隐患：`run-terminal-smoke.mjs` 的 `waitForClose` 存在完全相同的「只监听 `close`」模式，而该 runner 同样会在超时后升级到 SIGKILL。已一并改为同时监听 `exit` 并新增测试锁定（Node 脚本测试 124 → 125）。真实 `key` case 复跑通过，确认改为在 `exit` 结算不会截断 stdout 读取或影响结果。
- [x] 真实 runner 回归：`node scripts/run-terminal-smoke-matrix.mjs key,jump-reconnect` 在 `0320ce3b…` 上两 case 全绿且输出格式不变；另以 100ms 预算实测超时路径返回 `{ok:false, error:"terminal smoke case timed out after 100 ms"}`。
- [x] `pnpm verify` 全绿（前端 954、Team Server 103、Rust 191+3、Node 脚本 125、526 文件行数门禁、6 份证据一致性门禁）；`git diff --check` 干净。

### 2026-10-13 Phase 6.52 - case 超时传播取消并完成有界清理 ✅ 通过

> 目标：矩阵 case 超时后不留下继续运行的 Tauri app、SSH daemon 或重连轮询，避免资源与下一 case 重叠。

- [x] `runMatrixCases()` 为每个 case 创建 `AbortController`；超时先发出取消，再等待 case promise 完成或 5 秒清理宽限，随后才开始下一个 case。
- [x] `runTerminalSmoke()` 接收取消信号；应用等待、重连 checkpoint 和 fixture 的 finally 清理均响应取消。应用停止按 `SIGTERM` → 3 秒 `SIGKILL`，并保留原始超时诊断。
- [x] 新增「超时收到 abort 且清理完成后才进入下一 case」「取消 app 仍停止 SSH fixture」及「fixture 启动晚到时仍会清理」回归；`node --test scripts/run-terminal-smoke.test.mjs` 35/35 通过，`node --check` 与 `git diff --check` 通过。
- [ ] 真实 macOS 人工物理键盘/IME、合盖睡眠/VPN 切换、Windows Agent/Pageant/PTY 与串口硬件仍未验收。

### 2026-10-11 Phase 6.46 - 修复密码 fixture 强制重建镜像与被杀后永不 settle，SSH 矩阵首次 10/10 ✅ 通过

> 目标：解除 `password` / `password-reconnect` 两个 case 的长期 notRun，并修掉 Docker build 超时后整个 runner 永久挂死的缺陷。

- [x] 定位两个独立缺陷。其一：`startTerminalSmokePasswordSshd` 每次都无条件 `docker build`，而 build 必然重新解析 `FROM debian:bookworm-slim`；本机 Docker daemon 无法回源 registry（`docker pull` 超过 5 分钟无输出，宿主 `curl` 直连 registry 正常返回 401），所以即便本地已有可用镜像 `terminal-smoke-password-sshd:latest` 也必然失败。其二：`waitForClose` 只监听 `close`，而被 SIGKILL 的 `docker build` 会让 BuildKit 孙进程继续持有 stdio 管道，`close` 永不触发——这正是上一轮观察到的「child 已消失但 Node promise 不结束」，本轮稳定复现（进程空转 6 分钟、主线程停在 kevent）。
- [x] 新增 `ensurePasswordSshdImage()`：先 `docker image inspect`，仅在镜像缺失时才 build，使密码验收在离线环境下依然可跑。
- [x] `waitForClose` 同时监听 `exit` 与 `close`，任一到达即 settle，被强杀的构建不再挂死 runner。
- [x] 新增 `scripts/terminal-smoke-password-sshd.test.mjs`（3 项，此前该关键 fixture 完全没有测试）并接入 `pnpm verify`：分别锁定「被杀后仍会 settle」「镜像存在时不重建」「镜像缺失时才构建」。在旧实现下第一个用例会永久挂起、第二个会因多余 build 调用失败，确认有区分力。
- [x] **SSH 认证矩阵首次达到 10/10 全绿**：release 二进制 `ab209317…` 上 password 887ms/4659ms、password-reconnect 881ms/5316ms，首次连接 881–1791ms；debug 二进制 `0320ce3b…` 上同样 10/10 全绿。
- [x] 四个 debug 场景在同一 instrumented 二进制 `0320ce3b…` 上重测并统一入库：本地冷启动 3373/3402/3491ms、远程 prompt 1497ms、shell 交互 337/234/394ms、SSH 矩阵 10/10；`scripts/check-verification-evidence.mjs` 的 debug pin 同步更新并通过。
- [x] `pnpm verify` 全绿：前端 954 项、Team Server 103 项、Rust 191 单测 + 3 集成测试、Node 脚本 124 项（原 120 项，新增密码 fixture 3 项与 matrix 超时 1 项）、526 个生产源码文件行数门禁、6 份证据一致性门禁；`git diff --check` 干净。
- [ ] `docs/verification/` 仍未纳入 git 版本控制（用户要求不提交），证据无法随 clone 存活或被代码评审审阅。

### 2026-10-11 Phase 6.45 - 纠正 Phase 6.40 引入的证据失真，并让复用二进制先验明产物类型 ✅ 通过

> 目标：让 10 秒门禁证据覆盖 Phase 6.43/6.44 的前端修复，并确保冷启动与 SSH 矩阵证据描述的确实是同一个产物。

- [x] **纠正 Phase 6.40 自己的错误结论**：当时我用 `--reuse-binary` 让冷启动与矩阵共用一个二进制，并据此写下「两者同源」。但矩阵构建时带 `VITE_TERMINAL_SMOKE_BUILD=1`，而冷启动用的是普通 `pnpm tauri build`——**这是两个不同的产物**。smoke 构建把 smoke/probe 入口与 experiments 导航项编译进前端，包体比用户实际拿到的更大。同一个 sha256 只能证明「同一个二进制被测了两次」，不能证明「它是发布产物」。
- [x] 定位到失效路径：普通构建的二进制没有 smoke 入口，`--reuse-binary` 直接拿它跑矩阵，十个 case 逐个以 `Terminal smoke UI is not included in this build` 失败。此前没有任何检查拦住这种误用。
- [x] 新增 `assertSmokeInstrumentedBinary()`：通过内嵌资源文件名列表判定二进制是否带 smoke/probe chunk，普通构建立即以准确诊断失败，而不是让十个 case 逐个莫名失败。之所以用资源名而非守卫字符串判定，是因为两种构建都含 `Terminal smoke UI is not included in this build` 这段文本。
- [x] 矩阵改为在 `--reuse-binary` 时先验明产物类型并打印依据；新增 3 项测试（检测、拒绝、接受），Node 脚本测试从 117 增至 120。
- [x] 在单一 instrumented 二进制 `ab209317…` 上重测全部证据：本地冷启动 3134–3432ms、远程 prompt 1511ms、SSH 矩阵 8/8 全绿（首次连接 871–1758ms，4 个重连 case 各 11 个唯一 session 对 10 个）。
- [x] 证据文件显式标注 `smokeInstrumented: true` 并列出内嵌 chunk 名，同时说明这是偏保守的上界；另附同一源码的纯 shipping 构建 `ae3442c5…` 的对照值（本地 3368–3440ms、远程 1482ms），两者在噪声范围内。
- [x] `password` 与 `password-reconnect` 的 notRun 已在 Phase 6.46 解除：fixture 不再强制重建镜像，两个 case 在 release 与 debug 上均已复验通过。
- [ ] `docs/verification/` 仍未纳入 git 版本控制（用户要求不提交），证据无法随 clone 存活或被代码评审审阅。

### 2026-10-11 Phase 6.44 - 输出溢出后自动重连不再静默丢弃全部输出 ✅ 自动化通过

> 目标：一次输出队列溢出之后，即使会话自己恢复了，用户也必须真的能看到输出。

- [x] 定位真实缺陷（承重的可用性缺陷）：`TerminalOutputScheduler` 在溢出时进入 `failed` 状态并闩住，`enqueue` 对之后的所有数据直接返回 `false`——这是静默丢弃，不报错。唯一能复活它的 `reset()` 只在 `useTerminal` 暴露的手动 `reconnect()` 里调用。自动重连走的是完全不同的路径，从不调用 `reset()`。
- [x] 后果：溢出 → 自动重连成功恢复 SSH 会话 → 面板显示 connected，但调度器仍处于 failed，**新会话发送的每一个字节都被丢弃**。用户看到的是一个「健康连接」下完全冻结的终端，无法打字反馈、也无法从界面判断出问题。这比报错更糟，因为没有任何提示要求用户介入。
- [x] 修复：在 `onState` 中，当 snapshot 带来 sessionId 且调度器确实处于 `failed` 时调用 `reset()`。有 sessionId 意味着后端确实有一个活着的会话，输出通路随之恢复可用。
- [x] 刻意收窄条件：`reset()` 会清空待处理队列，若每次 connect 都调用会丢掉后端已经交付的输出，因此只在 `state === 'failed'` 时触发，并为「健康会话连接时不得 reset」补了守卫测试。
- [x] 区分力验证：把条件改为恒假后新测试确实变红（1 failed / 1 passed），恢复后通过；容器与服务层 266 项一并通过。
- [~] 高输出已由 smoke 契约覆盖：`loadBytes` 为 8MiB，且 `loadEndVisible` / `afterLoadVisible` 断言负载末尾在溢出恢复后仍可见。剩余缺口仅是真人观感确认（大量日志、编译输出下滚动与重连体验）；本项自动化不替代物理键盘/IME 或跨平台实机矩阵。

### 2026-10-11 Phase 6.43 - 输出溢出错误不再永久遮蔽后续会话状态 ✅ 自动化通过

> 目标：一次偶发的输出队列溢出不应让面板此后永远显示那条过期文案。

- [x] 定位真实缺陷：`useTerminal` 的 `onState` 用 `outputErrorRef.current ?? snapshot.error` 决定面板文案，而 `outputErrorRef` 一旦被 `onOverflow` 写入就**再也没有被清空过**（只有用户手动 reconnect 时才重置）。溢出本身会立即 disconnect 该 binding，因此从那一刻起的每一个 snapshot——包括重连成功后的 `connected`——都会被替换成那条陈旧的「terminal output queue exceeded」。实测确认：溢出 → 会话以 `network unavailable` 失败 → 会话恢复成功，面板三次都显示溢出文案。
- [x] 后果有两层：会话真的恢复了，用户仍看到一个永久错误，无法判断是否该重试；之后真的再次失败（例如网络中断），真正需要用户采取行动的诊断被过期文案完全遮住。
- [x] 修复：当 snapshot 自带错误时，以它为准并清掉记住的溢出文案。溢出会立刻 disconnect，所以「之后的 snapshot」必然描述的是另一件事，此时旧文案已经不适用了；而 snapshot 没有错误时才继续用记住的溢出理由解释这次断开。
- [x] 补 `terminal-session-state.test.ts`（4 项）覆盖重连状态收敛点的不变量：重连以终态结束时四个重试字段全部清空、显式 `retryable` 判定被保留、重连中记录完整时刻表。停用清理分支后其中一项确实变红。
- [x] 排除两条可疑路径（均写测试后确认安全，测试已删或转为断言）：关闭中的标签页不会被迟到的 `ssh-close` 复活（`close()` 同步摘除 record）；串口会话不会被唤醒扫描 arm（两条路径都要求 `tabType === 'remote'`）。
- [x] 新增 `use-terminal-error-recovery.test.tsx` 覆盖本项缺陷；把 `snapshot.error` 优先判断改成恒假后该项确实变红，恢复后通过。
- [~] 本项为前端状态呈现修复。高输出负载本身已由 smoke 的 8MiB `loadBytes` 与可见性断言覆盖；剩余缺口仅是 macOS 实机下真人确认溢出后的重连观感，不替代物理键盘/IME 或跨平台实机矩阵。

### 2026-10-11 Phase 6.42 - 证据门禁不再因证据缺失而静默放过 ✅ 自动化通过

> 目标：证据门禁必须覆盖它声称覆盖的全部证据。删掉一份「current」证据不该让门禁少检查一个 profile 却依然显示通过。

- [x] 定位真实缺陷：`checkVerificationEvidence` 用 `present.includes(file)` 把注册表过滤成「恰好存在于磁盘上的文件」。任何被注册的 current 证据一旦从磁盘消失，就会被静默跳过——门禁照样通过，只是覆盖面变小，审阅者完全看不出证明已被移除。这正是 fail-open。
- [x] 修复：注册表中缺失的文件现在**明确报错**，并提示「恢复它们，或从 EVIDENCE_PROFILE 中显式移除，而不是让门禁悄悄少检查」。缺失项不参与读取与比对（磁盘上本就没有可比较的内容）。
- [x] 重构测试夹具暴露了一个此前被掩盖的问题：`createHarness` 只提供测试自己写入的文件，其余注册文件读不到会抛 ENOENT，被当成 unparsable，从而淹没真正要断言的问题。夹具现在默认补齐全部 6 份注册文件，并按 profile 给出合法默认哈希，另提供 `omit` 选项供「缺失」场景显式使用。
- [x] 顺带修正三处因此暴露的失效断言：`checked` 计数不再是写死的 1/4 而是 `ALL_CURRENT.length`，陈旧哈希场景补上第二份 release 文件以避免制造出假的跨文件冲突。
- [x] 区分力验证：把 `2026-10-11-macos-release-ssh-matrix.json` 移出磁盘后门禁立即失败并指名该文件，恢复后 6 份证据通过。新增测试在未修复实现上确实变红。
- [x] 门禁测试从 12 项增至 13 项，全部通过。
- [ ] `docs/verification/` 目前仍未纳入 git 版本控制（用户要求不提交），因此这些证据无法随 clone 存活或被代码评审审阅；这需要用户授权提交后才能解决。

### 2026-10-11 Phase 6.41 - 唤醒不再为健康会话留下永久 arming ✅ 自动化通过

> 目标：Phase 6.39 只保证了「建链结束时清除标记」，但唤醒扫描会把**所有**符合条件的远端会话都 arm 一遍，包括已经 connected 的健康会话。

- [x] 定位真实缺陷：`handleHostWake` 对每个 record 先尝试 `resume`，失败即 `armAfterWake`。健康 connected 会话不是 retryable error，`resume` 返回 false，于是被 arm；但它没有任何在飞的建链，Phase 6.39 加在 `finally` 里的清除**永远不会执行**，标记永久滞留。此后该会话任意一次普通断线都会被误判为「唤醒后失败」，白拿一轮重试预算。
- [x] 修复：`armAfterWake` 增加前置条件，只 arm `connecting` 与 `reconnecting`——即真正有尝试在飞的两种状态。这同时收窄了 arming 的作用域到它真正要表达的语义。
- [x] 新增 3 项测试：单元层断言健康会话不可被 arm、只有 connecting/reconnecting 被 arm；manager 层用「唤醒健康会话 → 随后普通 `ssh-close` 断线，`maxAttempts: 1`」验证不会出现第 3 次建链。
- [x] 区分力验证：移除状态守卫后上述 3 项**同时变红**（3 failed / 19 passed），恢复后 22/22 通过。
- [ ] 真实合盖休眠/唤醒、VPN/蜂窝切换后的恢复仍需 macOS 实机观测；本项自动化不替代物理键盘/IME 或跨平台实机矩阵。

### 2026-10-11 Phase 6.40 - 10 秒门禁证据与 SSH 矩阵改为同一 release 二进制 ✅ 通过

> 目标：Phase 6.39 改了会话生命周期，release 侧的 10 秒门禁证据仍指向**不含该修复**的旧二进制，必须在同一产物上重新证明，且冷启动与 SSH 矩阵必须同源。

- [x] 定位到一个此前一直被掩盖的证据方法缺陷：`run-terminal-smoke-matrix.mjs` 每次调用都会自行重新构建二进制，而**相同源码的重复构建并非字节可复现**——同一棵源码树两次 `tauri build` 分别产出 `81f0361d…` 与 `bef9cc8f…`。因此矩阵证据在结构上永远无法与它之前测到的冷启动证据同源，两份「current」记录必然描述不同产物。
- [x] 给矩阵 runner 增加 `--reuse-binary`（默认仍为重建，保持原有「测新鲜构建」语义不变），并把参数解析抽成 `parseMatrixArguments` 加以测试覆盖；新增 2 项测试确认选项不会被误当作 case 名、且复用是显式 opt-in。
- [x] 在单一 release 二进制 `bef9cc8f…` 上重测全部三组证据：本地冷启动 4 次 3268/3702/3473/3584ms、远程 SSH prompt round-trip 1556ms、SSH 认证/重连矩阵 10/10 全绿（首次连接 929–1687ms，5 个重连 case 各产生 11 个唯一 session 对 10 个）、shell 交互 `cat-eof`/history/Tab 三 case 289/212/374ms。
- [x] 证据门禁主动验证过一次：把矩阵记录的哈希改回 `81f0361d…` 后门禁立即以「release evidence disagrees on the measured binary」与「does not describe the binary on disk」两条失败，恢复后 6 份证据通过。
- [x] 修正了 `check-verification-evidence.test.mjs` 中因 release 证据文件改名而失效的常量，并保留一个双文件 fixture 以继续覆盖「同一 profile 跨两个产物」的冲突场景。
- [ ] 未签名/未公证的干净机 Gatekeeper 首次启动行为仍待人工；本次证据不替代 macOS 物理键盘/IME、合盖唤醒实机观测或 Windows/Linux/Pageant/串口实机矩阵。

### 2026-10-11 Phase 6.39 - 唤醒标记不再泄漏到后续无关连接 ✅ 自动化通过

> 目标：唤醒装弹只对唤醒那一刻仍在建链的那次尝试生效，连接成功之后绝不能残留。

- [x] 定位真实缺陷：Phase 6.37 引入的 `armAfterWake` 标记只在 `startTerminalSession` 的 catch 分支被消费。若唤醒时那次建链随后成功，`finally` 未清除标记，它会一直留在 `WeakSet` 里；将来任意一次无关的建链失败都会命中 `consumeWakeArming()` 返回 true，白拿一轮用户从未要求的重试预算，掩盖真实的失败原因。
- [x] 修复：在 `startTerminalSession` 的 `finally` 中无条件调用 `clearWakeArming(record)`，使 arming 的生命周期严格等于单次建链尝试。失败路径的「消费后立即恢复」行为保持不变。
- [x] 测试上的自我修正：最初写的 manager 测试「唤醒装弹后建链成功」**没有区分力**（成功路径无论有没有标记都只连接一次），差点变成假证据。改为真正的顺序场景：唤醒装弹 → 建链成功 → 随后普通 `ssh-close` 断线，`maxAttempts: 1` 下若标记泄漏必然出现第 3 次建链；并实际停用实现确认该测试变红。
- [x] 同时保留 `TerminalSessionWakeRecovery` 单元测试直接断言「成功 attempt 后 arming 不可再消费」。
- [ ] 本项为纯前端生命周期修复，仍需 macOS 实机合盖/唤醒观测确认端到端表现；不替代物理键盘/IME 或跨平台实机矩阵。

### 2026-10-11 Phase 6.38 - 在含新改动的 release bundle 上重测 10 秒门禁 ✅ 通过

> 目标：Phase 6.34–6.37 改了启动失败界面、唤醒恢复、错误态 UI 与容器结构，原有 10 秒门禁证据测的是**不含这些改动**的旧二进制，必须在新二进制上重新证明。

- [x] 重新 `pnpm tauri build --no-bundle` 并在 release 二进制 `9d16bf81…` 上重测：本地冷启动重复三次 3204–3448ms，远程 prompt round-trip 1518–1647ms，均远低于 10 秒预算。
- [x] 记录并说明链接后首次运行的 9158ms 冷缓存暖机值，明确标注其不代表正常启动，避免以后被当成回归或被误引为典型值。
- [x] 验证「本地会话被排除在唤醒恢复之外」这一前提：用 `/bin/zsh -i` 经 SIGSTOP 2.5s 后 SIGCONT，同一算术标记命令前后均正常返回，证明本地 shell 能挺过 CPU 挂起；真实合盖与电源管理切换仍列为未验证。
- [x] release SSH 认证/重连矩阵在同一二进制上 10/10 全绿（首次连接 859–1130ms），shell 交互三 case 309/228/367ms 全绿。
- [x] 证据一致性门禁在过程中**主动拦截**了一次混用：新冷启动证据与旧 SSH 矩阵证据的二进制哈希不一致，门禁直接失败，迫使在同一二进制上重跑矩阵而不是引用旧数字；同时修正了 `check-verification-evidence.test.mjs` 中随之失效的文件名常量。
- [ ] 新证据尚未经远端 real-machine workflow run 复验；release 未签名/未公证的干净机 Gatekeeper 首次启动行为仍待人工。

### 2026-10-11 Phase 6.37 - 唤醒时仍在建链的会话也能恢复 ✅ 自动化通过

> 目标：合盖唤醒只投递一次事件。若那一刻会话还在建链，随后的建链失败也必须能自动恢复，而不是永久停在错误态。

- [x] 定位真实缺陷：Phase 6.35 只处理「唤醒时已停在 `error`」的会话。但唤醒会同时恢复定时器与 socket，建链中的会话常在 wake 事件之后才失败；这类失败**没有 sessionId**，`handleIoError` 的 `shouldReconnect` 要求 `Boolean(record.sessionId)`，因此不会触发任何自动重连，会话就此卡死。
- [x] 该失败不会再有第二次 wake 事件到来补救，所以这一次 wake 必须提前「装弹」：新增 `TerminalSessionWakeRecovery.armAfterWake()` 记录 wake，`startTerminalSession` 的 catch 分支消费该标记并立即重开一轮自动重连预算。
- [x] 抽出 `terminal-session-wake-recovery.ts` 承载两种唤醒形态（已失败的 error 态 / 仍在建链），使 reconnect 回到 300 行门禁内。
- [x] 过程中修正了自己的错误结论：最初写的测试允许「第二次 wake 补救」也能通过，掩盖了缺陷。改为「单次 wake 必须完成恢复」后先确认 RED，并额外用 `void record` 停用实现，确认**两项 wake 回归同时失败**，证明测试确实有区分力。
- [x] Phase 6.39 修掉同一条链路上的标记泄漏：`armAfterWake` 的标记原本只在失败时被消费，若唤醒时那次建链**随后成功**，标记就永久残留，将来某次毫不相干的建链失败会被误判为「唤醒后失败」而白拿一轮重试预算。现在 `startTerminalSession` 的 `finally` 在每次建链结束时都清除该标记。
- [x] 该泄漏无法用「唤醒 → 建链成功」的 manager 测试观察（成功路径本就只连接一次），最初那条测试没有区分力，已改写为真正的顺序场景：唤醒装弹 → 建链成功 → 随后普通 `ssh-close` 断线；`maxAttempts: 1` 下若标记泄漏就会出现第 3 次建链。停用 `finally` 清除后该测试确实变红，确认有区分力。
- [ ] 真实合盖休眠/唤醒与唤醒后首字节延迟仍需 macOS 实机观测；本项自动化不替代物理键盘/IME 或跨平台实机矩阵。

### 2026-10-11 Phase 6.36 - 重试耗尽的错误态在 UI 上可辨识 ✅ 自动化通过

> 目标：自动重试耗尽但仍可恢复的错误，不能在界面上和「彻底失败」长得一模一样。

- [x] 定位真实缺陷：`retryable` 一路从 session snapshot 计算并传到 `useTerminal`，却在 `container.tsx` 被静默丢弃。Phase 6.35 修复的「唤醒后卡死」状态里，用户只看到一个静态的红色「错误」圆点，完全看不出重试仍然可行。
- [x] `TerminalPaneHeader` 新增 `reconnectRetryable`：`status=error` 且 `retryable=true` 时显示 `terminal.status.retryExhausted`（待恢复 / Retrying soon / Reprise imminente），tooltip 说明「自动重试已用尽，可立即重试或等待主机唤醒」；`retryable=false` 仍显示原有「错误」，不改变硬失败的既有语义。
- [x] 新增 2 项 header 回归，分别锁定可恢复与不可恢复两种错误态；先对未实现版本确认 RED，再确认 GREEN。
- [x] 顺带把 `useTerminal` + host-key gate 的绑定抽到 `useTerminalSessionBinding`，并抽出 `useTerminalActivePreset` 主题选择，使 `container.tsx` 重新回到 200 行门禁内；hook 调用顺序（gate 在 `useTerminal` 之前）保持不变。
- [ ] 「唤醒后可恢复」的整条真实链路仍需 macOS 实机合盖观测；本项自动化不替代物理键盘/IME 或跨平台实机矩阵。

### 2026-10-11 Phase 6.35 - 主机唤醒后恢复远端会话 ✅ 自动化通过

> 目标：笔记本合盖休眠后重新唤醒，SSH 标签页能自动回到可用状态，而不是永久停留在「重试已耗尽」的错误界面。

- [x] 定位真实缺陷：自动重连只由 `ssh-close`/I/O error 事件触发。休眠会挂起定时器并断开 socket，5 次重试预算通常在机器睡着时全部耗尽，record 停在 `status=error, retryable=true`；此时后端已经投递完最后一个错误，**没有任何后续事件会重新触发恢复**，会话永久卡死。
- [x] `TerminalSessionReconnect.resume()` 只对「remote + 未关闭 + 无进行中重连 + 非手动模式 + `status=error` + `retryable=true`」的 record 重开一轮自动重连预算，其余状态一律不动。
- [x] `TerminalSessionManager.handleHostWake()` 遍历所有 record 调用 `resume`；新增 `useTerminalHostWake` 在 `visibilitychange` 可见与 `focus` 时触发，并在卸载时移除监听，避免陈旧 hook 恢复会话。
- [x] 新增 2 项 manager 回归（耗尽后唤醒恢复、已连接会话不受打扰）与 3 项 hook 回归（可见性、focus、卸载清理），先对未实现版本确认 RED 再确认 GREEN；前端全量 111 文件/935 项通过。
- [ ] 真实合盖休眠/唤醒仍需在 macOS 实机上人工观测（含唤醒后首字节延迟与 VPN/蜂窝网络切换）；本项自动化不替代物理键盘/IME 或跨平台实机矩阵。

### 2026-10-11 Phase 6.34 - 启动失败界面国际化与可操作提示 ✅ 自动化通过

> 目标：数据库不可用、应用 chunk 加载失败时，用户看到的是可理解、可行动、且符合 en/fr/cn 语言设置的启动失败界面，而不是一段硬编码英文。

- [x] `startup-error` 原先把标题、说明、详情标题和重试按钮全部硬编码为英文，违反项目 en/fr/cn 国际化约定；新增 `locales/{en,cn,fr}/startup.ts` 并接入三份 `index.ts`。
- [x] 该界面由 bootstrap 在主应用 chunk 挂载**之前**渲染，而 i18n 原本只在 `App` 内初始化；组件改为直接 `import '@/locales'` 按需初始化，不依赖尚未挂载的 Provider。
- [x] 新增可操作提示：说明常见原因是本地数据库不可用或被占用、重试会重新执行 workspace recovery、持续失败应重启或查看日志视图，而不是只显示一条原始错误。
- [x] 新增 3 项组件回归覆盖中/英/法全屏翻译与提示文案；先对硬编码版本确认 3 项全部 RED，再对实现确认 GREEN。
- [ ] 数据库不可用和真实用户工作区恢复仍需在目标发布构建上做人工观测；系统睡眠唤醒的会话恢复已由 Phase 6.35 自动化覆盖，实机合盖观测仍待进行。本项自动化不替代 macOS 物理键盘/IME 或跨平台实机矩阵。

### 2026-10-11 Phase 6.33 - workspace recovery 瞬时失败重试 ✅ 自动化通过

> 目标：数据库或启动竞态导致 workspace recovery 瞬时失败时，有限次重试恢复会话，同时不牺牲 10 秒内进入本地终端的兜底路径。

- [x] `App` 对 recovery reject 按 1/2/4 秒延迟最多重试三次；成功后停止重试，失败后不会无限保活启动流程。
- [x] 重试不延迟 2 秒本地终端 fallback；组件卸载会清除重试计时器，卸载后迟到的 recovery handle 会立即 dispose。
- [x] 新增 App、workspace recovery 和 store 回归覆盖瞬时失败后成功、并发加载取消与 handle 生命周期及耗尽上限；前端全量门禁为 109 个测试文件/925 项。
- [x] local PTY reader 的 `spawn_blocking(read)` 句柄在 shutdown/output-pump 退出路径显式保留并有界等待，新增阻塞读关闭回归；Rust local session 6/6 与 Clippy `-D warnings` 通过。
- [ ] 数据库不可用、系统睡眠唤醒和真实用户工作区恢复仍需在目标发布构建上做人工观测；本项自动化不替代 macOS 物理键盘/IME 或跨平台实机矩阵。

### 2026-09-06 Phase 6.23 - SSH 建链取消与启动门禁复验 ✅ 自动化完成，外部实机待验证

> 目标：让关闭、断开、重连和 I/O 错误在 SSH 握手期间立即停止旧 attempt，确保应用启动与重连不会积累迟到会话。

- [x] 后端新增 process-local connection attempt registry、取消信号与 `session_cancel_connection` 命令；password/key/agent/cert/Jump 五类建链统一受 cancellable future 包裹
- [x] 前端 `TerminalSessionManager` 为 remote tab 生成 attempt ID，关闭、断开、I/O 错误和 generation retirement 路径主动取消；迟到 session 由 generation 检查关闭且不发布 connected/output
- [x] cancel/create 竞态使用有界 tombstone；重复取消幂等，新增 Rust 竞态与上限回归测试
- [x] 2026-10-09 修复事件监听注册期间关闭 remote tab 的取消窗口；attempt ID 前置到首个 await，迟到监听不会启动已退休会话
- [x] 2026-10-09 增加 SSH 发布守卫，覆盖 pool/registry 已发布但 reader 尚未接管时的取消回收；Rust 发布中途取消回归通过
- [x] smoke 在真实 xterm parser 看见 ready marker 后记录 `firstConnectionMs`；reconnect 首次连接只执行 interactive checkpoint，不虚构完整 round
- [x] 前端 102 个测试文件/875 项、Team Server 103 项、Rust 177+3 项、Node smoke 39 项及 lint/typecheck/build/fmt/Clippy/源码门禁全部通过；`smoke:ssh-matrix` 7 用例和标准 8 MiB/97×31 smoke 全绿
- [ ] macOS 人工物理键盘 30 轮重叠 `a/s/d`；原生 CGEvent 自动化已在 Phase 6.24 通过
- [ ] Windows OpenSSH/Pageant/PTY 与 macOS/Windows/Linux 串口硬件矩阵

---

### 2026-08-29 Phase 6.22 - 应用图标程序化生成 ✅ 已生成，配色待定稿

> 目标：给项目一套可复现、可改配色的应用图标，替换此前缺失/占位的图标资产。

- [x] 新增 `scripts/generate-icon.py`：Pillow 程序化绘制 1024×1024 RGBA 源图（Big Sur 圆角方块 + 对角渐变 + 顶部柔光 + 内描边 + 单层 55% alpha 光晕的发光终端提示符 `>` 与光标块）
- [x] 三套配色可切换：`aurora`（深蓝→青绿 + 薄荷绿，默认已生效）、`violet`（紫罗兰 + 纯白）、`phosphor`（墨绿 + 琥珀，CRT 复古）；`--palette` 选配色，`--previews`/`--gallery` 输出对比图
- [x] `pnpm tauri icon` 生成全平台资产：`icon.icns`/`icon.ico`/`32x32.png`/`64x64.png`/`128x128.png`/`128x128@2x.png`/`icon.png`、Windows `Square*Logo`/`StoreLogo`，以及新增的 `android/`（mipmap-\*，含 `ic_launcher_foreground`/`ic_launcher_round`）与 `ios/`
- [x] 像素级校验：四角 alpha=0、中心 alpha=255、方块横向跨度 100–924（对应 100px margin）、提示符最亮像素为强调色 `(95,242,200)`；32/64px 小尺寸下 chevron 与光标块仍可辨（画廊见 `dist/icon-preview/index.html`）
- [x] 根脚本 `pnpm icon:source`（生成源图，依赖 Pillow）与 `pnpm icon`（源图 + `tauri icon` 全平台资产）
- [ ] 配色待用户定稿（当前默认 aurora）；换色执行 `pnpm icon:source -- --palette NAME` 后 `pnpm tauri icon src-tauri/icons/icon-source.png --output src-tauri/icons`

---

### 2026-05-02 第一轮 (本地终端修复 + UX/构建优化)

> 修复本地终端关键 bug 后，继续清理 + 增强 UX + 构建分析。

1. **本地终端三合一 bug 修复** - 详见 `docs/issue.md` Issue #0
   - `useTerminal` hook 重写（同步 onData 注册、listen-before-invoke、数据缓冲、post-connect resize）
   - `container.tsx` 改用 `termInstance` 状态、tab → tabId-only 依赖
   - `router/index.tsx` 移除重复 `TerminalContainer` 渲染
   - `local.rs` 增加 PowerShell `-NoLogo`、`TERMINAL_DEFAULT_SHELL` 环境变量
2. **死代码清理** ✅
   - 删除 `features/terminal/hooks/` 目录（3 个未引用的 hook：`useTerminalSession`、`useTerminalEvents`、`useTerminalResize`）
   - `useTerminal` 内联 `UseTerminalOptions`，断开对 deprecated 目录的依赖
3. **WebKit 输入补偿（历史 DOM fallback 已由修复版 core 取代）**
   - 2026-05-02 曾在 `use-terminal.ts` 通过 `setupWebKitInputCompensation` 监听 textarea `input` 事件
   - Phase 6.17 移除应用层 DOM fallback，恢复 `@baicie/xterm@0.1.7` 内部 `AppleWebKit` 键盘路径；文本输入只从修复版 core 的 `onData` 进入 FIFO，避免应用层 `input` 与 core 双路发送
   - 自动化覆盖 FIFO 不改写/不重复和精确依赖契约；物理重叠按键与 IME 仍必须在 WKWebView 实测
4. **终端右键菜单** ✅ 新增 `features/terminal/components/terminal-container/terminal-context-menu.tsx`
   - 复制 / 粘贴 / 全选 / 清屏 / 字号缩放
   - shadcn/ui 风格，新增 `components/ui/context-menu.tsx`（与 dropdown-menu 同风格）
   - 仅桌面端启用，移动端保持原触摸交互
5. **全局快捷键速查面板** ✅ 新增 `components/shortcuts-help/`
   - 触发：`Cmd/Ctrl + /` 或 `Shift + ?`（在输入框时不触发）
   - 数据源：`shortcutsService.getShortcuts()`，按 Navigation/Terminal/View/Other 自动分组
   - macOS 自动渲染 ⌘ ⇧ ⌥ 符号
6. **终端无障碍** ✅
   - 终端容器加 `role="application"` + `aria-label="Terminal"` + `focus-visible:ring`
7. **构建分析工具链** ✅
   - 新增 `packages/frontend/scripts/bundle-stats.mjs`：扫描 dist/ 输出 raw + gzip + brotli markdown 报告
   - 新增 `pnpm build:analyze` / `pnpm stats` 脚本
   - 不依赖 `rollup-plugin-visualizer`（Vite 8 + rolldown 后端不兼容）
   - 基线产物：raw 1.50 MB / gzip 418 KB / brotli 353 KB
8. **i18n 补齐** ✅ cn / en / fr 同步加 `terminal.*` + `shortcuts.*` 键

文件变更：

- `packages/frontend/src/hooks/use-terminal.ts`（清理 deprecated 引用；Phase 6.17 移除 DOM WebKit fallback）
- `packages/frontend/src/features/terminal/components/terminal-container/{container,terminal-context-menu}.tsx`
- `packages/frontend/src/components/{ui/context-menu,shortcuts-help/index}.tsx`
- `packages/frontend/src/layout/index.tsx`（挂载快捷键面板 + Cmd+/ 监听）
- `packages/frontend/src/locales/{cn,en,fr}/app.ts`
- `packages/frontend/{vite.config.ts,package.json,scripts/bundle-stats.mjs}`
- `.gitignore`（dist-stats.\* 忽略）
- 删除：`packages/frontend/src/features/terminal/hooks/` 整个目录

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

2. **Agent 登录认证** - 更新 SSH session 与 Vault
   - SSH Agent 登录支持 (读取 SSH_AUTH_SOCK)
   - ClientHandler 实现 server_channel_open_agent_forward
   - 前端 authType: "agent" 选项

3. **Jump Host 主机链** - 新增 `session_create_ssh_jump` 命令
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

1. ~~SSH 密钥认证完善~~ - ✅ 已实现 (russh-keys, 2026-03-19)
2. ~~SFTP 文件传输~~ - ✅ 已实现 (russh-sftp, 完整 CRUD + 流式上传下载, 2026-05-02)
3. ~~本地终端~~ - ✅ 已完成
4. ~~命令历史~~ - ✅ 已完成
5. 修复 Rust 编译警告

### 中优先级 (P1)

1. ~~端口转发~~ - ✅ 已实现 (Local/Remote/Dynamic SOCKS5, 2026-03-26)
2. ~~分屏模式~~ - ✅ 已完成
3. ~~Snippet~~ - ✅ 已完成
4. ~~主题系统~~ - ✅ 已完成
5. ~~ssh_resize 实现~~ - ✅ 已实现
6. ~~命令快速补全~~ - ✅ 终端内 ↑↓ 导航 (2026-05-02)

### 低优先级 (P2)

1. Vault 加密 - 安全增强
2. 多工作区 - 项目隔离
3. 命令面板 - 快捷操作
4. 跨设备同步 - 云端同步

---

## 六、开发建议

### 近期开发路线

```
第一阶段：完善核心功能 (已完成)
├── 1. ✅ SSH 密钥认证后端 (使用 russh-keys)
├── 2. ✅ SFTP 后端功能 (使用 russh-sftp)
├── 3. ✅ 端口转发后端 (Local/Remote/Dynamic)
└── 4. ✅ 本地终端支持 (portable-pty)

第二阶段：提升用户体验 (已基本完成)
├── 1. ✅ 分屏模式
├── 2. ✅ Snippet 功能
├── 3. ✅ 主题系统
└── 4. ✅ 端口转发 UI

第三阶段：高级功能 (主要代码路径已完成)
├── 1. ✅ Vault 加密
├── 2. ✅ 主机链 password/key/agent/certificate 代码完成，待实机
├── 3. ✅ Agent 登录与 forwarding 安全入口代码完成，待实机
└── 4. ✅ 多工作区
```

### 待解决的技术问题

1. **SSH 实机矩阵**：macOS/Linux Agent forwarding、Windows OpenSSH/Pageant、Jump Host certificate、断开与连接池复用。
2. **桌面/硬件矩阵**：Windows/Linux 本地 PTY、快捷键和串口硬件。
3. **后续身份能力**：按产品需要评估一次性邀请码、管理员审批或 OIDC；不阻塞当前 closed/token 准入模式。

---

_文档创建时间：2026-03-18_
_最后更新：2026-10-11 - Phase 6.32 五种 SSH 认证路径初连与重连矩阵已通过；可视 prompt、人工键盘/IME 继续验收，Windows/硬件待设备_

---

## 十一、功能增强开发记录 (2026-03-26)

### 2026-03-26 完成的工作 (第十三批次 - 构建修复)

#### 1. team-server Prisma 7.x 升级修复

- **Prisma 7.x 配置变更**: `url` 不再支持在 schema.prisma 中
- **新增配置文件**: `prisma.config.ts` - Prisma 7.x 新配置方式
- **更新 schema.prisma**: 移除 `url = env("DATABASE_URL")` 配置
- **更新 PrismaService**: 使用 `PrismaPg` 适配器连接数据库
- **tsconfig.json**: 添加 `rootDir: "./src"` 修复编译错误
- **安装依赖**: `@prisma/adapter-pg` 和 `pg`

#### 2. Rust 编译警告清理

- 移除 `src-tauri/src/local.rs` 中不必要的 `mut` 关键字
- 清理 `unused_mut` 警告

---

### 2026-03-26 完成的工作 (第十二批次 - 功能完善)

#### 1. 数据存储服务前端集成

- **后端命令**: `src-tauri/src/storage.rs` 新增存储服务命令
  - `storage_init` - 初始化存储后端
  - `storage_health_check` - 健康检查
  - `storage_upload` - 上传数据
  - `storage_download` - 下载数据
  - `storage_list` - 列出文件
  - `storage_delete` - 删除文件

- **前端服务**: `src/service/storage.ts` 新增存储服务 API

- **设置页面增强**: `src/components/settings-dialog/index.tsx`
  - 添加连接测试按钮和状态显示
  - 添加同步到服务器功能
  - 添加 S3 Bucket 字段

#### 2. 终端体验优化

- **终端主题预设**: `src/utils/terminal-themes.ts`
  - 8 种预设主题: Monokai, Solarized, One Dark, GitHub Dark, Dracula, Nord, Catppuccin
  - 主题选择 UI 集成到设置页面

- **设置页面增强**: Terminal Tab 新增主题选择器
  - 8 种预设主题可视化展示
  - 点击选择即可切换

#### 3. 团队协作冲突处理

- **NestJS 服务端**: `packages/team-server/src/sync/`
  - `sync.service.ts` 新增:
    - `checkConflicts` - 检测冲突
    - `resolveConflict` - 解决冲突 (LOCAL/REMOTE)
  - `sync.controller.ts` 新增端点:
    - `POST /sync/conflicts/check`
    - `POST /sync/conflicts/resolve`

- **前端 API**: `src/service/team-api.ts`
  - `checkConflicts` - 检查冲突方法
  - `resolveConflict` - 解决冲突方法

#### 4. SSH Agent 认证完善

- **agent.rs 更新**: 完善 SSH Agent 协议实现
  - 完整的请求签名支持
  - 与 SSH 服务器的 agent 转发集成

- **ssh.rs 更新**: `ssh_connect_agent` 函数完善
  - Agent 会话建立流程
  - 密钥获取和日志记录

#### 5. 高级功能服务

- **录制服务**: `src/service/recording.ts`
  - `TerminalRecordingService` - 终端录制服务
  - 支持录制/回放终端会话
  - 导出/导入 JSON 格式

- **快捷键服务**: `src/service/shortcuts.ts`
  - `ShortcutsService` - 自定义快捷键服务
  - 15+ 预设快捷键
  - 支持自定义快捷键配置
  - 快捷键冲突检测

---

---

## 十、团队协作开发记录 (2026-03-25)

### 2026-03-25 完成的工作 (第十一批次 - NestJS 服务端完善)

1. **修复重复模块** - `src/app.module.ts`
   - 移除重复的 `AuditModule` 导入

2. **健康检查端点** - `src/health/`
   - `/health` - 服务健康状态 (数据库连接检查)
   - `/health/live` - K8s 存活探针
   - `/health/ready` - K8s 就绪探针

3. **Prisma 修复** - `prisma/schema.prisma`
   - 移除无效的 `receivedInvites` 关系
   - 修复重复的 `email` 字段

4. **Seed 脚本** - `prisma/seed.ts`
   - 创建演示用户和团队
   - 生成演示邀请码

5. **认证流程优化** - `src/auth/auth.service.ts`
   - `register` 接口自动创建 API Token
   - 用户首次注册即可获得 Token，无需额外步骤

6. **前端健康检查** - `src/service/team-api.ts`
   - `healthCheck()` 改为调用 `/health` 端点 (无需认证)

7. **Docker 完善**
   - 添加 `.dockerignore`
   - `docker-compose.yml` 添加 healthcheck
   - `Dockerfile` 启动时运行 `prisma migrate deploy`

8. **TypeScript 编译修复** - `tsconfig.json`
   - 移除 `baseUrl` 避免 TS 5.9+ 警告

### 2026-03-25 完成的工作 (第十批次 - 前端云端同步)

1. **API 服务** - `src/service/team-api.ts`
   - 封装所有 NestJS 后端 API 调用
   - 类型转换辅助函数 (convertApiTeam, convertApiMember 等)
   - 健康检查和错误处理

2. **Team Store 增强** - `src/store/team.ts`
   - 添加 `cloudCreateTeam` - 云端创建团队
   - 添加 `cloudLoadTeams` - 云端加载团队列表
   - 添加 `cloudLoadMembers` - 云端加载成员
   - 添加 `cloudLoadShares` - 云端加载共享资源
   - 添加 `cloudCreateShare` - 云端创建共享
   - 添加 `cloudDeleteShare` - 云端删除共享
   - 添加 `cloudCreateInvite` - 云端创建邀请
   - 添加 `cloudJoinByCode` - 通过邀请码加入
   - 添加 `cloudJoinByLink` - 通过链接加入
   - 添加 `cloudLoadAuditLogs` - 云端加载审计日志
   - 更新 `sync()` 方法实现增量同步

3. **设置对话框增强** - `src/components/settings-dialog/`
   - 新增 `TeamServerConfig` 组件
   - 服务端配置 UI (Endpoint, API Token)
   - 连接测试功能
   - 自动同步开关和间隔配置
   - Local/Cloud 模式切换

### 2026-03-25 完成的工作 (第九批次 - NestJS 服务端)

1. **NestJS 服务端项目** - `packages/team-server/`
   - 项目结构与配置 (package.json, tsconfig.json, nest-cli.json)
   - Prisma 数据模型 (User, Team, TeamMember, Share, Invite, AuditLog)
   - Docker 配置 (Dockerfile, docker-compose.yml)

2. **认证模块** - `src/auth/`
   - API Token 认证 (创建、验证、撤销)
   - API Key Guard 和装饰器

3. **Teams 模块** - `src/teams/`
   - CRUD 操作 (创建、查询、更新、删除)
   - 权限检查 (仅管理员/所有者)

4. **Members 模块** - `src/members/`
   - 成员管理 (添加、移除、更新角色)

5. **Shares 模块** - `src/shares/`
   - 资源共享 (主机、代码片段)
   - 权限管理 (只读/读写)

6. **Invites 模块** - `src/invites/`
   - 三种邀请方式 (链接、邀请码、邮箱)
   - 加入团队接口

7. **Audit 模块** - `src/audit/`
   - 审计日志查询

8. **Sync 模块** - `src/sync/`
   - 增量同步 (GET /sync?since=timestamp)
   - 推送更改 (POST /sync)

9. **文档完善**
   - README.md 完整 API 使用说明
   - .env.example 环境变量示例

### 2026-03-25 完成的工作 (第八批次 - 本地模式完善)

1. **Snippet 分享功能** - `src/components/snippet-manager/index.tsx`
   - 添加团队分享按钮到每个 Snippet 卡片
   - 实现分享对话框，支持选择权限（只读/读写）
   - 显示分享到的团队名称
   - Toast 通知分享成功

2. **Hosts 视图 Snippets 展示** - `src/view/hosts/index.tsx`
   - 添加共享代码片段区域显示
   - 实现共享 Snippet 一键导入功能
   - 显示权限标签和描述信息
   - 团队卡片入口跳转到 Teams 页面

3. **敏感数据加密共享** - `src/utils/team-encryption.ts` + `src/components/share-host-dialog/index.tsx`
   - AES-256-GCM 加密实现（Web Crypto API）
   - PBKDF2 密钥派生（100000 次迭代）
   - 分享对话框添加加密选项
   - 密码强度验证
   - 导入时解密对话框
   - 加密标识显示

4. **国际化翻译完善**
   - 添加 `readonlyDesc`、`readwriteDesc`、`shareToTeam` 翻译
   - 中英法三种语言完整支持
   - 加密相关翻译（加密/解密/密码）

### 2026-03-25 完成的工作 (第七批次 - 续)

1. **Hosts 视图团队集成** - `src/view/hosts/index.tsx`
   - 添加团队共享主机展示区域
   - 实现共享主机导入功能（点击导入到本地）
   - 为主机卡片添加分享到团队操作菜单
   - 共享主机显示权限标签（只读/读写）

2. **设置页面团队入口完善** - `src/components/settings-dialog/index.tsx`
   - Team Tab 添加"打开 Teams 视图"按钮
   - 未启用团队模式时显示"启用团队模式"按钮
   - 导航到 Teams 页面进行团队配置

3. **国际化翻译完善**
   - `src/locales/en/demo.ts` - 补充英文翻译缺失条目
   - `src/locales/fr/demo.ts` - 添加完整法语翻译
   - Teams 相关翻译（中英法三种语言）

### 2026-03-25 完成的工作 (第七批次)

1. **团队功能基础框架**
   - `src/store/team.ts` - TeamStore 状态管理
     - 用户 UUID 自动生成
     - 团队设置管理（enabled/mode/endpoint/apiToken/autoSync）
     - 团队 CRUD 操作
     - 成员管理（添加/移除/更新角色）
     - 共享主机/代码片段
     - 邀请管理（链接/码/邮箱三种方式）
     - 审计日志
     - 同步状态管理

2. **数据库表扩展** - `src/service/database.ts`
   - teams 表 - 团队信息
   - team_members 表 - 团队成员
   - team_shared_hosts 表 - 共享主机
   - team_shared_snippets 表 - 共享代码片段
   - team_invites 表 - 邀请记录
   - team_audit_logs 表 - 审计日志
   - sync_queue 表 - 同步队列（离线支持）
   - user_profile 表 - 用户信息

3. **导航栏动态显示** - `src/components/app-sidebar/index.tsx`
   - 根据 `teamStore.settings.enabled` 动态显示/隐藏 Teams 入口
   - 普通用户模式：无 Teams 入口
   - 团队用户模式：显示 Teams 入口

4. **TeamsView 页面** - `src/view/teams/index.tsx`
   - 团队列表（左侧边栏）
   - 团队详情页面（右侧）
   - Members 标签 - 成员管理
   - Shared Hosts 标签 - 共享主机
   - Shared Snippets 标签 - 共享代码片段
   - Audit Logs 标签 - 审计日志
   - 创建团队对话框
   - 邀请成员对话框（支持链接/码/邮箱）

5. **路由注册** - `src/router/index.tsx`
   - 添加 `/teams` 路由

6. **国际化翻译** - `src/locales/en/demo.ts` 和 `src/locales/cn/demo.ts`
   - 添加 Teams 相关翻译（中英文）

7. **应用初始化** - `src/App.tsx`
   - 应用启动时初始化 TeamStore

---

### 2026-03-29 待完成的工作 (第八批次) — 已并入生产 ✅

1. **Safari / WKWebView 键盘事件（Issue #26）** — 2026-05-02 的 textarea fallback 已被 Phase 6.17 移除；当前 local / SSH / serial 共用精确固定的 `@baicie/xterm@0.1.7`，由 core 内部 `AppleWebKit` 分支修复重叠按键，再通过透明 `onData`/`onBinary` FIFO 下发。详见 `docs/issue.md` → Issue #26。

   **强制实机回归**: macOS WKWebView 物理 `a/s/d` 重叠按键、快速连续输入、Option/dead key、中文 IME、Ctrl+C；实验页 `packages/frontend/src/experiments/xterm-test.tsx` 仅可辅助观察，不能替代真实事件时序。

### Phase 6.34 - 长中断唤醒恢复 smoke ✅ 自动化矩阵通过

- ✅ 完成 host-wake smoke 控制通道、严格控制文件校验和后端证据字段，并接入默认 SSH 矩阵；当前 instrumented binary 上 `key-outage-wake-reconnect` 的 20 秒 outage 恢复通过，完整矩阵 13/13 全绿。
- ⚠️ 该场景不替代真人合盖休眠、网络切换和物理键盘/IME 验收。

### Phase 6.56 - 自动重试耗尽后的长期网络恢复 ✅ 自动化通过

> 目标：前台窗口保持打开、系统仍报告 online，但 VPN/路由/NAT 黑洞持续超过指数退避预算时，远端会话仍能自行恢复，不要求用户先发现错误再点击重连。

- [x] `TerminalSessionReconnect` 在 retryable 自动重试耗尽后安排 30 秒冷却重试；连接成功、手动 Retry、主动断开、关闭标签和新的唤醒恢复都会清除旧计时器，避免重复建链或在已关闭标签上启动会话。
- [x] retryable 错误仍保持可见状态，状态文案改为“等待自动重试”，tooltip 说明 30 秒周期及立即重试/断开操作。
- [x] 新增状态机回归：无 visibility/focus/online/wake 事件时自动恢复；手动 Retry 在长冷却前立即恢复；定向 reconnect/header 测试 26/26 通过，前端 typecheck 通过。
- [ ] VPN、蜂窝切换和真实路由黑洞仍需 macOS 实机观察；本项单元测试证明调度与取消语义，不替代真实网络矩阵。

### 2026-10-15 Phase 6.60 - OSC 133 退出码接入终端面板 ✅ 自动化通过

- [x] 退出码成为真实可见功能（#97）：`133;D;$?` 早就从 Rust 注入到 bash/zsh，前端也正确解析成 `command-finished`，但 `ShellIntegrationState.snapshot()` 在生产代码里零调用点，`lastExitCode` 只写不读——命令失败时用户必须翻 scrollback 才能看到退出状态。面板头部现在显示「上一条命令执行成功」或「上一条命令退出码 N」，分别用 `text-success`/`text-destructive`。渲染拆成独立的 `terminal-pane-command-status.tsx`，因为放回 `terminal-pane-header.tsx` 会到 215 行、超过 200 行门禁（门禁当场报出）。测试固定住两条语义：0 与非 0 分别渲染，**没有信号时不渲染**——把「没观测到」显示成绿色成功会让用户误判命令已跑完。同一轮审计还确认 `phase`（`command-start`/`command-output`）同样无消费者；Issue #99 已为远程 SSH 会话补上显式 per-host opt-in，当前 bash loopback 已有 prompt marker 证据，真实用户远程 shell 仍待验收。见 Issue #97。
- [x] 远程 SSH Shell Integration 已落地为显式 per-host 配置（Issue #99）：Host/SQLite 使用 `shellIntegration`/`shell_integration` 的 `off|bash|zsh`，默认关闭并兼容旧数据库；Rust `TerminalProfile` 只在选择 bash/zsh 时组合单行脚本，再保留用户 `startupCommand`。不提供 `auto`，未知或不匹配的远端 shell 不注入。
- [x] 2026-10-16 真实 loopback OpenSSH bash 的 cwd、OSC 133 退出码与 prompt marker 回读通过：同一 instrumented binary 上远程 prompt 3647ms；另有默认 `/bin/sh` 真实 SSH shell 交互 7/7 全绿；修复 zsh startup 首字节竞态和 OSC 同 chunk marker 识别。
- [ ] fish/sh/未知 shell、tmux/screen 及 Windows shell 的 cwd/OSC 133/远程 prompt 回读仍待实机验收。
- [x] 首次连接失败现在也自动重连（#98）：自动重连只由 I/O 错误路径触发，而该路径要求已有 `sessionId`，从未建立起来的连接没有 sessionId，所以首次握手失败根本不进重连循环——面板永久停在 error，直到用户手动重连或碰巧有一次 visibility/focus/online 事件兜底。可重试的首次远程失败现在消耗与断线相同的指数退避 + recovery timer 预算；认证/host key 等不可重试失败不消耗预算（否则错误密码会把 UI 卡住 30 秒），本地 PTY 与串口不参与自动重连。见 Issue #98。

### 2026-10-16 Phase 6.62/6.63 - 远程 SSH Shell Integration 显式 opt-in ✅ bash/zsh 自动化实机通过

- [x] Host 增加 `shellIntegration: 'off' | 'bash' | 'zsh'`，数据库列 `shell_integration` 默认 `off`，旧数据迁移和导入归一均保持关闭。
- [x] launcher 在没有 startup/environment 时仍传递显式 profile；Rust 组合 integration script 与原有启动命令，bash/zsh guard 防止把脚本交给错误 shell。
- [x] 自动化覆盖 TerminalProfile serde/validate、`auto` 拒绝、off/on composition、Host mapper/SQLite/同步导入与 launcher 接线。
- [x] 真实 loopback OpenSSH bash/zsh 的 cwd、OSC 133 退出码与 prompt marker 回读；zsh startup 写入等待首个 shell 输出，避免首字节丢失；远程 marker 允许与 OSC 控制序列同 chunk。
- [ ] fish/sh/未知 shell 负向矩阵、tmux/screen 和 Windows 端仍待验收。

### 2026-10-16 Phase 6.64 - 串口未知端口的平台分类修复 ✅ 自动化通过

- [x] `serial_list` 仅在 Windows 将未知的 `COM*` / `\\.\\COM*` 路径标为 `Serial Port`；macOS/Linux 上保持 `Unknown`，新增 4 项纯逻辑回归断言。
- [x] Rust 串口定向测试 19/19、完整 `pnpm verify` 通过；当前证据已在同一 instrumented binary `4368d6c8…` 上重采集，证据门禁通过。
- [ ] Windows/Linux 串口枚举、流控、精确写入和拔线仍需真实硬件矩阵，不能由静态平台分类测试替代。

### 2026-10-16 Phase 6.65 - 串口会话清理并发加固 ✅ 自动化通过

- [x] 写入先释放 `serial_sessions` map 锁再等待 gate，避免阻塞写入卡住断连或 reader EOF 清理；gate guard 移入 `spawn_blocking`，异步命令取消不会提前放行设备。
- [x] reader 自然 EOF/错误、显式断连和应用退出统一在摘除 session 后排空在途写入，再发布 `serial-close` 或完成 cleanup；reader 等待有 2 秒有界诊断。
- [x] Rust 串口定向测试 10/10、shutdown 定向测试 2/2、完整 `pnpm verify` 通过。
- [ ] Windows/Linux 串口驱动在阻塞读/写异常时的硬件拔线与重连仍需真实设备矩阵。

### 2026-10-16 Phase 6.66 - Vim shell probe 时序与 smoke 源码规模修复 ✅ 自动化通过

- [x] Vim 用例把编辑按键安排为 1/2/3/4 秒，并将 shell 侧验证命令延后到 5 秒；回归断言锁定验证命令必须晚于最后一个编辑按键，避免 Linux runner 上编辑器尚未退出就被验证命令抢占导致超时。
- [x] 将 `waitForTerminalSmokeFrame` 拆到 `terminal-smoke-frame.ts`，`run-terminal-smoke.ts` 降至 297 行并通过源码规模门禁。
- [x] 历史 instrumented debug binary `9c3948b0…`（source fingerprint `6e597e22…`）上的本地冷启动 5140ms、远程 bash prompt marker 3617ms、真实 SSH 13/13、本地 shell 14/14 和真实 SSH shell 7/7 全部通过；当前证据已迁移到 `4368d6c8…` / `de8e49cb…`。
- [x] 新提交的 macOS/Linux/Windows real-machine workflow 由 run `38997341490` 完成全矩阵复验；人工物理键盘、中文 IME、Option/dead key、Windows OpenSSH Agent/Pageant 与串口硬件继续按实机清单验收。

### 2026-10-16 Phase 6.67 - 远程 prompt cold-start 跨平台测量适配 ✅ 自动化通过

- [x] 远程 marker readiness 不再编译或轮询 macOS AX helper；`axProbe: 'none'` 仅允许 remote 模式，避免 hosted runner 将无关的 Swift 编译超时报告成 SSH prompt 失败。
- [x] Linux real-machine remote prompt 步骤使用 30 秒观测窗口，保留实际 `spawnToReadyMs`，而本地 10 秒可靠终端预算仍由独立 cold-start 证据验证。
- [x] 定向 stopwatch/workflow 测试 36/36、完整 `pnpm verify` 通过；real-machine run `38997341490` 已复验。

### 2026-10-16 Phase 6.68 - Linux shell probe 退出清理竞态 ✅ 已修复，跨平台矩阵通过

- [x] `run-terminal-shell-probe` 的临时目录递归删除增加 20 次、每次 100ms 的有界重试，覆盖 WebKitGTK/Mesa shader-cache 子进程退出后的短暂 `ENOTEMPTY`。
- [x] shell probe Node 回归测试与矩阵契约测试通过；原始业务错误仍优先保留，清理失败不会覆盖探针诊断。
- [x] real-machine run `38997341490` 确认 macOS/Linux/Windows shell 矩阵与 Linux remote prompt 均执行并通过。

### 2026-10-17 Phase 6.69 - Linux remote cold-start fixture 数据库目录隔离 ✅ 已修复，跨平台矩阵通过

- [x] Linux remote cold-start runner 建库与启动应用共用同一 `XDG_CONFIG_HOME`，固定为临时 HOME 下的 `.config`，不会受宿主进程预设目录影响。
- [x] 回归测试模拟宿主 `XDG_CONFIG_HOME=/host/config`，并断言 sqlite3 写入路径与应用读取目录一致。
- [x] remote stopwatch 定向测试 7/7、real-machine workflow 契约测试 7/7 通过。
- [x] real-machine run `38997341490` 的 Linux password、shell interaction 与 remote marker 往返通过；Issue #103 根因已复验。

### 2026-10-17 Phase 6.70 - 慢速 workspace 恢复与启动兜底竞争 ✅ 已修复，跨平台矩阵通过

- [x] 启动兜底标签由 `startupFallback` 所有权标记控制；数据库恢复较慢、兜底已自动连接时，已保存的远程布局仍可替换兜底标签。
- [x] xterm、移动端快捷键栏和 snippet/history 命令总线的主动写入统一清除 `startupFallback`，保留用户已经接管的本地会话，避免恢复结果覆盖交互中的终端。
- [x] 新增恢复回归覆盖 delayed remote layout + connecting fallback，恢复与输入协议定向测试通过。
- [x] real-machine run `38997341490` 确认 Linux remote startup/prompt marker 往返；本地 fallback session 的清理由 TerminalByUrl 的 tab prune 路径负责。

### 2026-10-17 Phase 6.71 - 启动兜底主动输入接管路径 ✅ 自动化通过

- [x] `useTerminal` 的直接 `write` 与 `terminalWriteBus` 写入复用主动输入通知，覆盖移动端快捷键栏和 snippet/history 命令；xterm text/raw 输入保留原诊断路径。
- [x] use-terminal routing 回归断言直接写入和目标 tab 命令总线写入都会在 session FIFO 前通知接管逻辑。
- [x] real-machine run `38997341490` 完成 macOS、Windows、Linux 启动恢复与 remote startup/prompt marker 验收。

### 2026-10-17 Phase 6.72 - 手动输入探针输入源切换 ✅ 自动化通过

- [x] `run-input-probe.mjs --inject manual --input-source ascii` 在当前输入源为中文输入法时临时选择 ASCII 键盘，并在验收结束后恢复原输入源。
- [x] 新增切换与恢复回归，输入探针定向测试 21/21 通过；恢复失败仍会使验收失败，不会伪造通过结果。
- [ ] 真人物理键盘 30 轮、中文 IME composition、Option/dead key、合盖睡眠/VPN/蜂窝切换，以及 Windows Agent/Pageant/PTY/串口硬件仍待实机验收。

### 2026-10-17 Phase 6.73 - shell probe dialect 声明收紧 ✅ 自动化通过

- [x] `run-terminal-shell-probe` 与 matrix runner 不再把 fish/sh 复用 POSIX 命令表；显式请求会在构建或启动前报告缺少 dialect。
- [x] 新增 fish/sh fail-fast 契约回归；shell probe、matrix 与 dialect 合约定向测试 31/31 通过。
- [ ] fish/sh 独立交互 dialect、tmux/screen 及对应真实 shell 矩阵仍待实现和实机验收。

### 2026-10-17 Phase 6.74 - 认证阶段瞬时网络错误自动重连 ✅ 自动化通过

- [x] 认证阶段的超时、连接重置/关闭、拒绝连接、路由不可达和传输关闭错误会继续进入远程自动重连状态。
- [x] 凭据拒绝、host key 校验、密钥/证书解析和取消错误保持不可重试；新增首次连接认证 timeout/transport reset 回归。
- [x] 前端重连定向测试 29 项、Rust SSH 定向测试 50 项通过；真实 VPN/蜂窝切换和路由黑洞仍需 macOS 实机观察。

### 2026-10-17 Phase 6.75 - Windows Agent 空白环境变量回退 ✅ 自动化通过

- [x] Windows Agent 登录忽略空字符串和空白 `SSH_AUTH_SOCK`，继续尝试默认 OpenSSH named pipe 与 Pageant；合法显式管道保持原样。
- [x] 新增 `non_empty_agent_pipe` Rust 回归（未设置、空值、空白值、合法 named pipe）；定向测试通过。
- [ ] Windows OpenSSH Agent/Pageant 服务、权限和真实认证仍需 Windows 实机矩阵验收。

### 2026-10-17 Phase 6.76 - Windows PowerShell 绝对路径启动加速 ✅ 自动化通过

- [x] 本地 PTY 按跨平台 basename 识别 `powershell.exe`/`pwsh.exe`，即使 `TERMINAL_DEFAULT_SHELL` 使用 Windows 绝对路径也追加 `-NoLogo`。
- [x] 新增 Rust 回归覆盖反斜杠路径、大小写及 cmd/bash 负例；定向测试通过。
- [ ] Windows ConPTY 的真实 banner/prompt 时序仍需实机验收。

### 2026-10-17 Phase 6.77 - 重连状态机同步回调重入 ✅ 自动化通过

- [x] 重连任务在发布首个 `reconnecting` 快照前先登记 ownership promise，避免状态监听器同步触发手动 Retry/断开时覆盖新任务的 mode 与 promise。
- [x] 新增同步 listener 重入回归；manager/reconnect/wake 相关测试共 80 项通过。
- [ ] 真人睡眠唤醒、VPN/蜂窝切换、Windows Agent/Pageant/PTY 和串口硬件仍按实机矩阵验收。

### 2026-10-17 Phase 6.78 - WebKit 延迟 input 重叠回归 🟡 自动化覆盖完成，物理键盘待验收

- [x] 将 xterm WebKit 去重 marker 改为最多 32 项、1 秒单调时钟 TTL 的 payload FIFO，修复多个 `keydown` 先于对应 `input` 时 marker 被覆盖的问题并回收无配对 marker。
- [x] composition 开始、paste handler 与非 `insertText` input 清理旧 marker；IME commit 和 paste 仍由 xterm 原有 composition/paste handler 发送。
- [x] 自动化覆盖不同字符与重复字符重叠、FIFO 上限/过期、`insertFromComposition`、真实 paste 事件与 `insertFromPaste`。
- [ ] macOS WKWebView 多轮物理 `a/s/d`、Option/dead key 和真人中文 IME 仍按 Issue #26/#58 人工验收。

### 2026-10-17 Phase 6.79 - 首连 outage smoke fixture 同步修复 ✅ 自动化通过

- [x] sshd fixture 暴露 `outagePromise.ready` checkpoint，表示旧 daemon 已完全停止；SSH smoke runner 在启动应用前等待 checkpoint，并继续等待 fixture 最终恢复完成。
- [x] 新增回归确认首连 outage 的 down checkpoint 先于 daemon 恢复；`terminal-smoke-sshd` 与 runner 定向测试共 56/56 通过。
- [x] 当前 instrumented debug binary `4368d6c8…`（source fingerprint `de8e49cb…`）上真实 SSH 矩阵 13/13 全绿，`key-first-connect-outage` 首次连接 9629ms；本地冷启动三次 4768/4146/4464ms，远程 prompt marker 2742ms，本地 shell 14/14、真实 SSH shell 7/7 全绿。
- [ ] macOS 物理键盘、中文 IME、Option/dead key、真实合盖睡眠与网络切换，以及 Windows Agent/Pageant/PTY/串口硬件仍待实机验收。

### 2026-10-17 Phase 6.80 - host-wake fallback timer 停顿诊断 🟡 自动化与定向 SSH 通过，根因待隔离

- [x] fallback timer 每 5 秒上报一次心跳；共享 host-wake checkpoint 在途时额外记录一次状态，reporter 失败会输出本地诊断，checkpoint 触发后停止 interval。
- [x] fallback/recovery 定向测试 20/20、frontend typecheck、Rust `terminal_smoke` 37/37 与 SSH runner 38/38 通过。
- [x] instrumented debug binary `08ba7338…` 上 `key-outage-reconnect`、`key-outage-wake-reconnect`、`key-first-connect-outage` 3/3 通过；wake case 一次 100250ms 完成并记录 7s 到 64s 的 timer 事件空档，同 binary 再跑 21492ms 完成。
- [x] renderer heartbeat 的周期上报改走独立 loopback `fetch`；只有初始配置 `invoke` 与 host-wake checkpoint 共用 Tauri IPC。可用 heartbeat 与 checkpoint 的时间差区分 renderer/timer 停顿和后续 IPC/命令路径停顿。
- [ ] 在解锁的 macOS WKWebView 上完成上述差异复验，再采集完整 13-case、冷启动和 shell 证据。
- [ ] macOS 物理键盘、中文 IME、Option/dead key、真实合盖睡眠与网络切换，以及 Windows Agent/Pageant/PTY/串口硬件仍待实机验收。

### 2026-10-18 Phase 6.81 - 独立 renderer heartbeat 诊断 🟡 定向测试通过，待 WKWebView 复验

- [x] host-wake smoke runner 启动随机端口与 token 的 loopback 接收器，前端通过普通 `fetch` 每秒及 visibility/focus 变化上报活性；Rust/前端严格校验 endpoint/token。
- [x] fallback 自清、abort/cleanup reporter 失败均保留诊断；前端定向测试 80/80、Rust smoke 38/38、Node SSH/heartbeat runner 42/42、typecheck 与目标 lint 通过。
- [x] macOS AppKit frontmost helper 对目标进程尚未登记的 code 3/前台查询 code 4 做有界重试，并以 Node 回归覆盖瞬时激活失败；当前 runner 不再把该启动竞态直接误报为终端恢复失败。
- [ ] 在 macOS WKWebView 比较 renderer heartbeat 与 host-wake IPC 事件，定位 `08ba7338…` 三项 outage 复跑超时；之后按当前源码重新采集完整证据。

### 2026-10-19 Phase 6.82 - 产品 host-wake 生命周期兜底 ✅ 代码与定向测试通过，实机待验收

- [x] `useTerminalHostWake` 增加低频 wall-clock 漂移检测；覆盖 WKWebView 在合盖睡眠后保持 visible/focused、但浏览器生命周期事件未触发的恢复路径。
- [x] 监听 `pageshow` 与 `document.resume`，并在卸载时清理 interval/listener；hook 定向测试 6/6 通过。
- [ ] 在解锁的 macOS WKWebView 上复跑 host-wake、完整 SSH、冷启动和 shell 证据；真实合盖、VPN/蜂窝切换仍需人工验收。

### 2026-10-19 Phase 6.83 - host-wake/renderer heartbeat 生命周期加固 ✅ 自动化通过，GUI 证据待复采

- [x] host-wake reporter 按 reporter 身份串行化底层 invoke；超时或 abort 不会释放仍在途的底层操作，后续请求等待旧操作 settle，避免 IPC 重叠。
- [x] recovery 的 abort、timer cleanup 和 unmount 路径遵守 AbortSignal；新增超时重试、永久 pending、abort 与 cleanup 回归测试。
- [x] renderer heartbeat 配置失败可重试，heartbeat fetch 检查 HTTP 状态、单飞并在 effect cleanup 时 abort；新增失败、HTTP 503、并发和取消测试。
- [x] 自动化验证：smoke 14 文件 129/129、host-wake/recovery 29/29、renderer heartbeat 9/9、frontend typecheck、目标 lint/format、Rust `terminal_smoke` 38/38、Node SSH/runner 59/59。
- [ ] 解锁 macOS 后用当前源码重建 instrumented binary，重采 host-wake、完整 SSH、冷启动和 shell evidence；真实合盖、VPN/蜂窝切换仍需人工验收。

### 2026-10-21 Phase 6.84 - 明确窗口 readiness 与 shell readiness 🟡 契约测试通过，当前实机证据待采集

- [x] cold-start stopwatch 结果增加 `windowReady`、`terminalReady`、`readinessTarget` 与 `readyAt`；本地默认值保持兼容且清楚标为窗口 readiness，远程 marker 路径标为 terminal readiness。
- [x] 严格本地 terminal readiness 必须提供 marker/marker-check；该模式跳过 AX helper，窗口 readiness 不能替代 marker。旧 evidence JSON 保留原样。
- [x] cold-start、remote cold-start 与 evidence 定向 Node 测试 53/53 通过，覆盖跨运行 marker 内容拒绝、预置 stale marker 拒绝和按 readiness target 的退出诊断。
- [x] 增加本地真实 PTY per-run marker runner：每次运行生成 nonce，shell probe 配置把 nonce 送入前端，marker 仅在 `term.input` → `session_write` → local PTY 回读并通过结果校验后写出；`pnpm smoke:local-cold-start` 使用严格 terminal readiness。
- [ ] 解锁 macOS 后用当前源码重建并采集 `readyAt: terminal` 证据，之后再更新发布就绪数值。

### 2026-10-21 Phase 6.87 - strict local cold-start 环境隔离与探针回收 ✅ 自动化通过，GUI 证据待采集

- [x] local PTY runner 清除继承的 shell startup hooks 与旧 SSH probe 配置，并把 `TERMINAL_DEFAULT_SHELL` 固定为已校验的 bash/zsh，防止启动脚本提前伪造 per-run marker 或 dialect 不匹配。
- [x] cold-start app 清理超时升级 SIGKILL；AX helper 与 Swift compiler 超时等待子进程关闭，必要时升级 SIGKILL。
- [x] 新增环境合并后 unset、marker 环境绑定、strict marker-only、不再编译/调用 AX，以及编译器超时回收回归；cold-start/local runner 39/39、Node runner/evidence/workflow 定向测试 123/123，Rust shell probe 4/4。
- [ ] macOS GUI 锁定状态下无法采集新 binary 证据；解锁后重建并采集 strict `readyAt: terminal`，同时复验 host-wake、SSH、shell 与人工键盘/IME。

### 2026-10-21 Phase 6.86 - host-wake 延迟恢复代际守卫 ✅ 自动化通过

- [x] 延迟 wake recovery continuation 记录触发时的 reconnect generation；新一代手动/自动重连接管后，旧 continuation 不再启动额外自动重连。
- [x] 新增旧 ownership settle 与新 retryable error generation 交错回归；wake recovery 定向 Vitest 7/7、目标 ESLint 与 Prettier 通过。
- [ ] 真实合盖睡眠/唤醒、VPN/蜂窝切换和跨平台 Agent/PTY/串口仍按实机矩阵验收。

### 2026-10-21 Phase 6.88 - 事件注册等待可随会话关闭取消 ✅ 定向自动化通过

- [x] 每次终端启动等待共享事件监听注册时使用独立取消信号；关闭 record 或退休重连代际后，启动 promise 会及时 settle，不再阻塞 `TerminalSessionManager.close()`。
- [x] 取消后不会继续调用 session create；迟到的共享 listener 注册仍保留为 manager 级资源，注册拒绝也由等待方接住，不产生未处理 rejection。
- [x] 新增注册 promise 永不完成时关闭成功的回归；manager/events/reconnect/wake 定向测试 86/86，另有启动取消集合交错回归 1/1，前端 typecheck 通过。

### 2026-10-21 Phase 6.89 - SSH host-key 预检瞬时网络错误分类 ✅ 定向自动化通过

- [x] host-key preflight 将 timeout、连接重置/拒绝/关闭、DNS、no route、network unavailable、broken pipe 与 transport closed 归为有限自动重试；250ms/1s/3s 预算耗尽后保留可见 error 与手动 Retry。
- [x] host key changed、invalid input、密钥解析、凭据拒绝和非超时 known_hosts 数据错误继续 fail-closed，不因自动重试掩盖信任或凭据问题。
- [x] ready 状态绑定完整 host/jump route key；主机或跳板配置变化时旧授权立即失效，异步旧 probe 不能放行新配置。
- [x] 新增 host-key gate 回归；该文件 29/29 通过，会话 manager/reconnect/wake 定向 83/83，前端 typecheck、目标 ESLint/Prettier 通过。
- [ ] 解锁 macOS 后在真实 VPN/DNS/路由切换和跳板矩阵上复验；当前锁屏状态不产生新的 GUI 或网络证据。

### 2026-10-21 Phase 6.90 - 证据指纹覆盖构建输入 ✅ 门禁回归通过

- [x] 将 `index.html`、前端 tsconfig/vite 配置、Tauri `capabilities/`、Rust `Cargo.toml`/`Cargo.lock`/`tauri.conf.json`/`build.rs`、workspace/toolchain 配置和 checker 自身纳入 debug evidence source fingerprint，防止只改构建或验收边界时旧证据 false-pass。
- [x] 新增 fingerprint path 契约回归；旧 evidence JSON 保持 fail-closed，不修改历史证据。
- [ ] 解锁 macOS 后按新指纹重建并重新采集冷启动、SSH、shell 与 host-wake evidence。

### 2026-10-21 Phase 6.91 - 延迟 workspace 恢复的本地终端兜底 ✅ 自动化通过

- [x] 恢复完成后重新检查是否存在本地终端或已解析 host 的远程终端；2 秒兜底已触发且恢复结果不可用时补建本地 `startupFallback`，避免窗口只剩无法连接的远程标签。
- [x] 保留远程布局的恢复与持久化语义，不让临时 fallback 覆盖 SQLite 中保存的工作区布局。
- [x] 新增延迟恢复与永久 pending host 的组合回归；App/workspace recovery 定向测试 29/29、前端 typecheck、目标 ESLint/Prettier 通过。
- [x] SSH host-key 预检与首次 session 创建已共享一条前端单调 10 秒启动预算；probe、瞬时重试、Jump Host 串行阶段和五种 SSH create 命令均只消费剩余毫秒数，后端保留 8 秒预检/9 秒建连 cap。

### 2026-10-22 Phase 6.96 - 首次 SSH 连接共享启动预算 ✅ 自动化通过

- [x] 新增 `terminal-connection-deadline` 单调时钟 helper；host-key direct/jump probe、瞬时重试和首次 session create 复用同一启动预算，IPC 传递前预留 100ms margin。
- [x] Jump Host probe 在一枚 Rust `Instant` 下覆盖跳板认证、隧道、目标握手和 `known_hosts` 检查；五种 SSH session create 均把剩余 `connectionTimeoutMs` 交给 Rust，并继续受后端 9 秒上限约束。
- [x] TOFU、保存未知 key、手动 Retry 会开启新的尝试预算；自动重连不沿用首次 deadline。连接 deadline、host-key gate/IPC、session manager 和 Rust 全量回归通过。
- [ ] 解锁 macOS 后按当前源码重建并复验网络切换、Jump Host、严格 terminal cold-start、完整 SSH 和 host-wake evidence；跨进程相对毫秒预算带 100ms margin，不替代实机 SLA 证据。

### 2026-10-22 Phase 6.97 - 启动期限与 IPC 毫秒边界收口 ✅ 自动化通过

- [x] 首次 SSH session create 在共享 deadline 耗尽后才返回时，退休 pending output/lifecycle 并关闭后端 session，不发布 `connected`；重连尝试仍使用独立预算。
- [x] 剩余连接预算在跨 Tauri IPC 前向下取整为整数，满足 Rust `Option<u64>` 参数契约。
- [x] 新增 local/remote 迟到 session 与小数毫秒回归；remote 迟到结果会关闭旧 session 并用独立预算自动重连。manager/reconnect/wake recovery、host-key gate/deadline helper 定向测试通过；launcher 覆盖 password/key/agent/cert/jump 五种 IPC timeout 传递，前端 typecheck、目标 ESLint 和 Prettier 通过。
- [ ] 解锁 macOS 后在当前源码上复验严格 terminal cold-start、真实 SSH 与 host-wake；旧证据因源码指纹变化继续 fail-closed。

### 2026-10-22 Phase 6.98 - 启动失败兜底与 dispose 生命周期收口 ✅ 自动化通过

- [x] 启动失败立即渲染带错误信息和 Retry 的轻量兜底，动态错误界面加载成功后再替换，chunk 拒绝时保留可操作兜底。
- [x] `startTerminalApp` 将每次 bootstrap attempt 绑定到 guarded render root；HMR dispose、重试代际变化或卸载后，迟到成功/失败结果不会重新渲染旧 root。
- [x] 兜底 Retry 使用 shadcn `Button`；loader 注入回归真实覆盖错误 chunk reject，bootstrap 12/12、前端全量 125 文件/1130 项、typecheck、lint、Prettier 和生产构建通过。
- [ ] 解锁 macOS 后按最终源码重建并复验严格 terminal cold-start、完整 SSH/Jump Host、host-wake、物理键盘、中文 IME 与 Option/dead key；旧证据继续 fail-closed。

### 2026-10-22 Phase 6.100 - probe root loader deadline 与 xterm 输入日志清理 ✅ 自动化通过

- [x] smoke、input、raw input、shell probe root loader 复用 bootstrap attempt 的绝对 deadline 与 AbortSignal；永久 pending 不再让验收窗口无限空白。
- [x] 增加永久 pending smoke root 回归；bootstrap 定向测试 17/17、前端全量测试 126 文件/1139 项通过。
- [x] `@baicie/xterm@0.1.7` 补丁和 lock hash 固定为 `63e246a9944c8f4c202660ee4be6c3d6d60e2e38e112d8deb5f134691ff2abdb`；活动安装产物的 WebKit 输入路径不再打印按键或输入内容，xterm 定向测试 17/17。
- [ ] 解锁 macOS 后完成严格 terminal cold-start、SSH、host-wake、物理键盘、中文 IME、Option/dead key 和真实输入日志确认；verification JSON 保持原始历史内容。

### 2026-10-22 Phase 6.99 - App loader deadline 与移动端首屏交互收口 ✅ 自动化通过

- [x] normal App 动态模块加载增加 8 秒 deadline；超时进入带错误信息和 Retry 的同步兜底，dispose/重试会取消当前等待并清理 timer。
- [x] 新增永久 pending、超时后 Retry 成功、迟到旧模块不得覆盖新应用及启动中重复 Retry 不使当前 attempt 失效的回归；移动端核心工具栏改为同步加载，确保菜单按钮不被 Suspense 空占位遮挡。
- [x] Node 24 定向 bootstrap/移动工具栏测试 17/17、typecheck、目标 ESLint/Prettier 通过；前端全量测试 126 文件/1139 项、生产 bundle budget 通过；Phase 6.99 时源码指纹为 `d9037fc9…`。
- [ ] 解锁 macOS 后按最终源码重建并复验严格 terminal cold-start、完整 SSH/Jump Host、host-wake、物理键盘、中文 IME 与 Option/dead key；旧证据继续 fail-closed。

### 2026-10-21 Phase 6.92 - cold-start 异步 deadline 收口 ✅ 自动化通过

- [x] AX/marker 异步检查返回后再次核对单调时钟；超过预算时 fail-closed，不受 timeout timer 调度顺序影响。
- [x] 成功结果的 `requestToReadyMs`/`spawnToReadyMs` 复用 deadline 检查时的同一时间点，避免报告与判定不一致。
- [x] 新增跨过 timeout 后仍返回成功的确定性回归；cold-start stopwatch 35/35 通过。
- [ ] 当前源码的严格 `readyAt: terminal` 仍需解锁 macOS 后重建并采集证据。

### 2026-10-21 Phase 6.93 - WKWebView Option-as-Meta 输入边界 ✅ 自动化通过

- [x] 仅对普通 Option-as-Meta 字符阻止 WKWebView 默认文本动作，避免 Meta 序列与布局字符双发。
- [x] Dead key、Process、keyCode 229 和 active composition 保留原生 IME/dead-key 路径；xterm patch 通过 pnpm 干净重放并更新 lock hash。
- [x] 增加 Option Meta、Dead key、paste/composition 边界和真实重复键输入回归；xterm WebKit 输入 17/17 通过，活动 patched package 的输入路径已无敏感 `console.debug`。
- [ ] 解锁 macOS 后完成物理 Option/dead key、中文 IME、近同时 `a/s/d`、vim/nano 与真实睡眠/网络切换验收。

### 2026-10-21 Phase 6.94 - host 查询取消后清理加载状态 ✅ 自动化通过

- [x] workspace recovery 取消 host 查询时立即清除当前 generation 的 `loading` 状态，避免底层 SQLite 请求永久 pending 导致 store 状态卡住。
- [x] 新增 pending 查询取消与旧请求不得清除新请求状态的回归。
- [x] 前一版 instrumented debug binary `3f42bbcd…` 的严格本地 terminal marker 与远端 bash prompt 各完成 3/3；锁屏导致 SSH GUI 矩阵在 frontmost helper 阶段中止，未生成 current evidence。
- [ ] 解锁并恢复桌面后，用当前源码重建 binary，完成 13-case SSH 与 bash/zsh/SSH shell matrix，再整理 current evidence。

### 2026-10-21 Phase 6.95 - host-wake smoke fixture 可随矩阵取消 ✅ 自动化通过

- [x] `interruptUntilControl` 接受 `AbortSignal`；host-wake 用例取消时停止控制文件轮询并清理 timer。
- [x] 新增取消回归，确认 fixture 关闭后不会启动替代 sshd；SSH fixture 与 runner 定向测试 60/60 通过。
- [ ] 解锁 macOS 后仍需按当前源码重建 binary 并采集 host-wake、完整 SSH、shell 与 terminal cold-start 证据。

### 2026-10-22 Phase 6.101 - SSH 连接取消通知无丢唤醒窗口 ✅ 自动化通过

- [x] Tokio `Notified` 在读取取消标志前先调用 `enable()` 注册 waiter；取消恰好发生在标志读取与首次 poll 之间时，不会丢失 `notify_waiters()` 通知并遗留挂起的 SSH create future。
- [x] Rust 全量测试 221 单测 + 3 集成测试、Clippy `-D warnings`、`cargo fmt --check` 通过；Node 24 前端全量测试 126 文件/1139 项、Team Server 103 项、脚本测试 205 项、源码规模与构建门禁通过。
- [ ] 完整 `pnpm verify` 仍由 evidence gate 的 9 项实机记录失败：cold-start terminal marker、完整 SSH case contract、release marker/hash 与旧 debug fingerprint；解锁后按当前源码重采，不手改证据 JSON。
- [ ] macOS 解锁后按最终源码重采严格 terminal cold-start、完整 SSH、host-wake 与人工输入证据；旧 verification JSON 继续保持历史内容并由 evidence gate 拒绝。

### 2026-10-24 Phase 6.102 - macOS 原生红绿灯位置、首帧安全区与拖拽命中区 🟡 自动化通过，GUI 待确认

- [x] 原生 traffic lights 调整到 `x: 16, y: 16`，让灯组位于 44px 桌面顶栏的高度范围内，并将桌面和窄屏工具栏左侧安全区统一为 80px。
- [x] 安全区在首帧同步判断，并通过 Tauri 官方 `isTauri()` 检测，仅原生 macOS 窗口应用；浏览器预览保持原布局。
- [x] 顶栏拖拽区改用 `data-tauri-drag-region="deep"`，内部空白区可拖动，交互按钮继续显式排除拖拽。
- [x] TopToolbar 回归测试 6/6、frontend typecheck、ESLint、Prettier、Tauri JSON 解析与 diff whitespace 检查通过。
- [ ] 解锁 macOS 后目视确认原生灯组位置、标题栏拖拽区域和工具栏控件不重叠。

### 2026-10-28 Phase 6.103 - 前端测试并发上限与门禁收口 ✅ 自动化通过

- [x] `packages/frontend/vitest.config.ts` 固定 `maxWorkers: 4`：jsdom worker 数不设上限时，启动与终端类用例里 1 秒的 `findByText` 异步查询窗口会被其它 worker 抢占 CPU 拖慢，同一用例单独运行稳定通过而全量并行偶发超时；该上限只约束并行度，不改任何用例的超时或断言。
- [x] `pnpm verify` 的自动化分组全绿：前端 126 文件/1142 项（90.63s）、Team Server 25 文件/103 项、Rust 221 单测 + 3 集成测试、Node 脚本 205 项、550 个生产文件行数门禁，以及 ESLint、typecheck、生产构建与 bundle budget（initial gzip 129.55 KB、total gzip 553.15 KB）通过。
- [ ] 完整 `pnpm verify` 仍以 evidence gate 的 9 项失败退出：cold-start 与 release 记录缺少 3 次 terminal marker、SSH 矩阵 case 集合不完整、release 证据 hash 与当前已构建 binary 不一致，以及 4 份 debug 证据记录的源码指纹仍是历史 `de8e49cb…`（当前工作树 `534405ec…`）。解锁 macOS 后按当前源码重采，不手改证据 JSON。

### 2026-10-28 Phase 6.104 - 会话恢复两处生命周期缺陷修复 ✅ 自动化通过

- [x] 只读审计覆盖「连接主流程」与「启动/恢复/唤醒」两条链路，逐条复核后确认 2 个真实缺陷、3 条暂不修改的设计项、2 条「疑似缺陷但经核对属既有设计行为」。
- [x] Issue #132：workspace 恢复的兜底路径不再武装第二个 debounce timer（孤儿 timer 会在 dispose 之后仍写一次盘）。
- [x] Issue #133：host-wake 的漂移判定只在可见窗口执行，隐藏窗口被节流到 ≥16 秒的后台轮询不再被误判为主机唤醒。
- [x] Issue #137/#138：`exit` 分支返回 `cancelled`、启动兜底在有远端标签时补一个 Local 标签，两者核对为既有设计行为，未改代码；审计提出的「按 hostId 删除兜底判据」改动已回退。
- [ ] Issue #134/#135/#136（唤醒冷却、host-key 探测不可取消、journal 每次 store 变更同步写）保持待评估，不在本轮范围。
- [ ] 实机证据仍未重采：本轮没有可用的解锁桌面窗口，`pnpm verify` 的 source 分组会继续以 evidence gate 的 9 项失败退出。


### 2026-10-28 Phase 6.105 - 当前源码实机证据重采（debug 全绿） ✅ 实机通过

- [x] 源码冻结后按 runbook 重建插桩产物：debug `d7a4dd4c…`、release `1e68ba73…`，源码指纹 `04bb5973…`，并把 debug 复核哈希固定进门禁（commit `94ed89c`）。
- [x] debug 本地冷启动三次：6654 / 2127 / 1225 ms，全部 `readyAt: terminal`，marker 由 `term.input → session_write → local PTY` 回读后才写出。
- [x] 远程 prompt 冷启动：4575 ms，loopback sshd 的 OSC 133 prompt marker 往返完成。
- [x] 13-case SSH 矩阵 13/13 全绿：首连 985–9125 ms（含首连 outage 9125 ms）、outage/wake 重连 14.3–23.9 s、每种认证路径 10–11 个唯一 session。
- [x] shell 交互矩阵：bash/zsh 各 7 case 共 14/14，真实 SSH 7/7，单例 218–1071 ms。
- [x] release 产物本地冷启动三次：1827 / 1319 / 1421 ms，全部 terminal-ready。
- [ ] release SSH 矩阵 10 case 未拿到干净一轮：两次运行分别出现 `expected process X to be frontmost` 与 stale-output 超时，失败用例 heartbeat 显示窗口 `hidden`，属桌面焦点争用；已改为自动重试，待一轮 10/10。
- [ ] 人工物理键盘、IME、Option/dead key 与真实合盖唤醒仍未验收；Windows Agent/Pageant/PTY 与串口硬件仍无实机。

