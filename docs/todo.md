# Terminal 项目待办事项

> 基于设计文档 `docs/design.md` 整理的待办事项
> 更新时间：2026-05-03（Phase 6.4 — 代码质量拆分 + 命令补全 + 跨设备同步）

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
| 增量同步功能   | 基于时间戳的增量同步            | 📋 待开发（需服务端）  |
| 冲突处理       | 询问用户选择保留版本            | 📋 待开发（需服务端）  |
| 离线操作队列   | 离线操作记录和恢复              | 📋 待开发（需服务端）  |
| 敏感数据加密   | 密码可选加密共享 (AES-256-GCM)  | ✅ 已实现 (2026-03-25) |
| NestJS 服务端  | REST API 服务端                 | ✅ 已实现 (2026-03-25) |
| Docker 部署    | docker-compose 配置             | ✅ 已实现 (2026-03-25) |
| 前端云端同步   | 前端连接 NestJS 服务端          | ✅ 已实现 (2026-03-25) |

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

### 2026-05-02 第三轮 (Phase 6.2 — 桌面化 + SFTP 队列 + 单测 + Rust 可观测性) ✅

> 在第二轮（首屏 gzip 242 KB / `index.js` 159 KB / 0 警告）之上，按序完成 t1–t4 四个细项。

#### t1 — Tauri 桌面 UX

- 系统托盘 (`src-tauri/src/tray.rs`)：图标 + 菜单 (Show / New Local / New SSH / Command Palette / Quit)，菜单 emit `tray://*` event → 前端 `useTrayEvents` 转 `shortcut:*` CustomEvent，复用既有调度
- 最小化到托盘 (`src-tauri/src/window_cmd.rs` + `lib.rs::on_window_event`)：用户偏好持久化到 SQLite，关闭按钮拦截后 `window.hide()`
- 原生通知 (`packages/frontend/src/service/notifications.ts`)：Tauri plugin → 浏览器 → in-app toast 三级回退；`notifyOnlyWhenUnfocused` 默认开
- 焦点感知 (`packages/frontend/src/hooks/use-window-focus.ts`)：监听 `tauri://focus` / `tauri://blur`，状态条失焦半透明 + tooltip
- 设置面板：`general-settings.tsx` 加 *Desktop UX* section（3 个 Switch + i18n 三语）

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
  - `state.rs` 改为按字段加 allow + 注释，标注 *ownership-only* 或 *reserved for future*
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
   - `useTerminal` hook 同时被 local / SSH / serial 复用，后端 emit 名 `local-data` / `ssh-data` / `serial-data` 对齐前端 listener，第一轮的「同步 onData + 数据缓冲 + WebKit 补偿」自动覆盖三个场景

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
3. **WebKit 输入补偿** ✅
   - `useTerminal` 新增 `setupWebKitInputCompensation`：仅在 Safari/macOS WKWebView 启用
   - 监听 textarea `input` 事件 + recentSent 滚动 buffer，补发 onData 漏掉的字符
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
- `packages/frontend/src/hooks/use-terminal.ts`（清理 deprecated 引用 + WebKit 补偿）
- `packages/frontend/src/features/terminal/components/terminal-container/{container,terminal-context-menu}.tsx`
- `packages/frontend/src/components/{ui/context-menu,shortcuts-help/index}.tsx`
- `packages/frontend/src/layout/index.tsx`（挂载快捷键面板 + Cmd+/ 监听）
- `packages/frontend/src/locales/{cn,en,fr}/app.ts`
- `packages/frontend/{vite.config.ts,package.json,scripts/bundle-stats.mjs}`
- `.gitignore`（dist-stats.* 忽略）
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
_最后更新：2026-03-26 - 功能完善批次_

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

1. **Safari WebKit 键盘事件（Issue #26）** — 已在 `packages/frontend/src/hooks/use-terminal.ts` 通过 `setupWebKitInputCompensation` 修复（2026-05-02），local / SSH / serial 共用；补发走与 `onData` 相同的 `send` → 后端写入，非 `term.write()`。详见 `docs/issue.md` → Issue #26。

   **可选回归**: Safari / WKWebView 快速双键、IME、Ctrl+C；实验页 `packages/frontend/src/experiments/xterm-test.tsx` 仍可对照。

