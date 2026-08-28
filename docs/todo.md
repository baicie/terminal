# Terminal 项目待办事项

> 基于设计文档 `docs/design.md` 整理的待办事项
> 更新时间：2026-08-28（Phase 6.20: 真实 SSH 认证矩阵与物理键盘探针自动化，macOS 实机验收完成）

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
- [ ] 用真实 xterm/Tauri 端到端流量验证 SGR mouse、bracketed paste 和非 UTF-8 原始字节
- [ ] 在 macOS WKWebView 用物理键盘多轮近同时按 `a/s/d`，精确检查不丢不重；继续完成快速连续输入、key rollover、CapsLock、Option/dead key、中文 IME、`cat`/历史/Tab/vim/nano/连续 resize 桌面矩阵
- [ ] 用可用 SSH 服务完成密码/key/agent/cert/Jump 与断线重连回归；Windows/Linux/Pageant/串口仍按实机矩阵验收

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
- [ ] 授予宿主进程 Accessibility 后执行 30 轮真实 CGEvent 重叠 `a/s/d` 注入，或人工在探针窗口键入 30 轮，记录 expected/received hex
- [ ] 在 Linux runner 首次 dispatch 执行 real-machine 工作流；Windows OpenSSH/Pageant/PTY 实机按 issue.md Issue #21/#22/#39 人工清单

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
_最后更新：2026-08-24 - Phase 6.19 localhost SSH 重连 smoke 已收口，物理输入与外部实机矩阵待验证_

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
