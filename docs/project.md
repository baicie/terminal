# Terminal 项目文档

> 本文档记录项目的完整结构、实现状态和待办事项

---

## 目录

- [项目结构](#项目结构) - 完整代码结构
- [实现状态](#实现状态) - 功能实现进度
- [待办事项](#待办事项) - 未来开发计划
- [问题追踪](#问题追踪) - 已知问题列表

---

## 项目结构

### 整体目录

```
terminal/
├── src/                          # React 前端源代码
├── src-tauri/                    # Rust 后端源代码
├── docs/                         # 项目文档
│   ├── design.md                 # 设计文档
│   ├── todo.md                   # 待办事项
│   ├── issue.md                  # 问题追踪
│   └── ui/                       # UI 规格（功能与界面描述，便于 AI 阅读）
│       ├── README.md             # 索引
│       ├── 00-design-system.md   # 设计系统
│       ├── 01-layout-and-navigation.md # 布局与导航
│       └── 02-views.md           # 各功能视图说明
├── package.json                  # Node 依赖
├── pnpm-lock.yaml               # pnpm 锁文件
├── AGENTS.md                    # Agent 指南 (你正在阅读)
└── README.md                    # 项目说明
```

---

## src/ 前端结构

```
src/
├── main.tsx                      # 应用入口
├── App.tsx                       # 根组件
├── index.css                     # 全局样式
├── vite-env.d.ts                # Vite 类型定义
│
├── view/                         # 页面级组件
│   ├── terminal/                 # 终端页面
│   │   └── terminal-container.tsx # 终端容器 (xterm.js 集成，直接管理 Terminal 实例)
│   ├── sftp/                     # SFTP 页面
│   │   ├── sftp-view.tsx        # SFTP 视图
│   │   └── sftp-container.tsx   # SFTP 容器 (文件浏览器)
│   ├── vaults/                   # 保险库页面
│   │   ├── vaults-view.tsx      # 保险库视图
│   │   └── vaults-container.tsx # 保险库容器
│   └── home/                     # 首页
│       └── home-view.tsx
│
├── components/                    # 可复用组件
│   ├── ui/                       # 基础 UI 组件
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── input.tsx
│   │   ├── label.tsx
│   │   ├── select.tsx
│   │   ├── tabs.tsx
│   │   └── textarea.tsx
│   ├── host-list/                # 主机列表组件
│   │   ├── index.ts             # 导出入口
│   │   ├── sidebar.tsx           # 侧边栏 (主机列表)
│   │   └── host-dialog.tsx       # 主机编辑对话框
│   ├── command-history/          # 命令历史
│   │   └── index.tsx
│   ├── snippet-manager/          # Snippet 管理
│   │   └── index.tsx
│   ├── port-forward/             # 端口转发
│   │   └── index.tsx
│   ├── split-pane/               # 分屏组件
│   │   └── index.tsx
│   └── settings-dialog/           # 设置对话框
│       └── index.tsx
│
├── store/                         # MobX 状态管理
│   ├── app.ts                    # 应用状态 (标签页、分屏)
│   ├── host.ts                   # 主机状态
│   ├── terminal.ts               # 终端会话状态
│   └── demo.ts                   # 演示/示例状态
│
├── service/                       # 业务服务层
│   ├── ssh.ts                    # SSH 服务 (调用 Tauri 命令)
│   ├── database.ts               # SQLite 数据库服务
│   ├── config.ts                 # 配置服务
│   └── axios.ts                  # HTTP 客户端
│
├── hooks/                         # 自定义 React Hooks
│   ├── use-di.ts                 # 依赖注入
│   └── use-logger.ts             # 日志 Hook
│
├── utils/                         # 工具函数
│   ├── logger/                   # 日志模块
│   │   ├── logger.ts            # 日志主类
│   │   ├── log-level.ts         # 日志级别
│   │   ├── transport.ts         # 日志传输接口
│   │   └── console-transport.ts  # 控制台输出
│   ├── axios.ts                 # Axios 封装
│   └── utils.ts                 # 通用工具
│
├── types/                         # TypeScript 类型定义
│   └── index.ts                 # 类型导出
│
├── locales/                       # 国际化
│   ├── en/                       # 英文
│   │   ├── index.ts
│   │   ├── demo.ts
│   │   └── layout.ts
│   ├── fr/                       # 法文
│   │   ├── index.ts
│   │   ├── demo.ts
│   │   └── layout.ts
│   ├── cn/                       # 中文
│   │   ├── index.ts
│   │   ├── demo.ts
│   │   └── layout.ts
│   └── index.ts                  # 国际化初始化
│
├── router/                        # React Router 路由
│   └── index.tsx
│
├── layout/                        # 布局组件
│   ├── index.tsx                 # 主布局
│   ├── tabs.tsx                  # 标签栏
│   └── vaults/                   # 保险库布局
│       └── index.tsx
│
├── lib/                           # 第三方库封装
│   └── utils.ts
│
└── di.ts                          # 依赖注入容器配置
```

---

## src-tauri/ Rust 后端结构

```
src-tauri/
├── src/
│   ├── main.rs                   # 二进制入口
│   ├── lib.rs                    # 库入口 (Tauri 命令注册)
│   └── terminal.rs               # 终端核心逻辑
│                                    # - SSH 连接 (russh)
│                                    # - 本地 PTY (portable-pty)
│                                    # - SFTP (占位符)
├── Cargo.toml                     # Rust 依赖
├── tauri.conf.json                # Tauri 配置
└── capabilities/                  # Tauri 权限配置
```

### Rust 核心命令

| 命令                  | 功能             | 状态                   |
| --------------------- | ---------------- | ---------------------- |
| `ssh_connect`         | SSH 密码连接     | ✅ 已实现              |
| `ssh_connect_key`     | SSH 密钥连接     | ✅ 已实现 (2026-03-19) |
| `ssh_connect_agent`   | SSH Agent 连接   | ✅ 已实现              |
| `ssh_connect_cert`    | SSH 证书认证     | ✅ 已实现 (2026-03-26) |
| `ssh_shell`           | 打开交互式 shell | ✅ 已实现              |
| `ssh_write`           | 写入数据         | ✅ 已实现              |
| `ssh_resize`          | 调整终端大小     | ⚠️ 空实现              |
| `ssh_disconnect`      | 断开连接         | ✅ 已实现              |
| `ssh_execute`         | 执行单条命令     | ✅ 已实现              |
| `local_shell`         | 本地终端         | ✅ 已实现              |
| `local_write`         | 本地终端写入     | ✅ 已实现              |
| `local_resize`        | 本地终端调整大小 | ✅ 已实现              |
| `local_disconnect`    | 本地终端断开     | ✅ 已实现              |
| `sftp_connect`        | 初始化 SFTP 会话 | ✅ 新增 (2026-03-19)   |
| `sftp_list`           | SFTP 列出目录    | ✅ 已实现              |
| `sftp_upload`         | SFTP 上传        | ✅ 已实现              |
| `sftp_download`       | SFTP 下载        | ✅ 已实现              |
| `sftp_mkdir`          | SFTP 创建目录    | ✅ 已实现              |
| `sftp_delete`         | SFTP 删除        | ✅ 已实现              |
| `sftp_rename`         | SFTP 重命名      | ✅ 已实现              |
| `port_forward_start`  | 启动端口转发     | ✅ 新增 (2026-03-19)   |
| `port_forward_stop`   | 停止端口转发     | ✅ 新增 (2026-03-19)   |
| `port_forward_list`   | 列出活动转发     | ✅ 新增 (2026-03-19)   |
| `serial_list`         | 列出可用串口     | ✅ 新增 (2026-03-20)   |
| `serial_baud_rates`   | 获取常用波特率   | ✅ 新增 (2026-03-20)   |
| `serial_connect`      | 连接串口         | ✅ 新增 (2026-03-20)   |
| `serial_write`        | 写入串口         | ✅ 新增 (2026-03-20)   |
| `serial_write_raw`    | 原始写入串口     | ✅ 新增 (2026-03-20)   |
| `serial_is_connected` | 检查串口连接状态 | ✅ 新增 (2026-03-20)   |
| `serial_disconnect`   | 断开串口         | ✅ 新增 (2026-03-20)   |

---

## 实现状态

### Phase 1 - MVP ✅ 已完成

| 功能                | 前端 | 后端 | 说明                                 |
| ------------------- | ---- | ---- | ------------------------------------ |
| SSH 密码连接        | ✅   | ✅   | russh 实现                           |
| SSH 密钥认证        | ✅   | ✅   | russh-keys 实现 (2026-03-19)         |
| 终端模拟 (xterm.js) | ✅   | ✅   | FitAddon, SearchAddon, WebLinksAddon |
| 多标签页            | ✅   | -    | AppStore 管理                        |
| 主机保存 (SQLite)   | ✅   | ✅   | hosts 表                             |
| 组管理              | ✅   | ✅   | 支持嵌套组                           |
| 收藏夹              | ✅   | ✅   | isFavorite 字段                      |
| 本地终端            | ✅   | ✅   | portable-pty                         |

### Phase 2 - 核心功能 ✅ 已完成

| 功能          | 前端 | 后端 | 说明                                   |
| ------------- | ---- | ---- | -------------------------------------- |
| SFTP 文件传输 | ✅   | ✅   | russh-sftp 实现 (2026-03-19)           |
| 端口转发      | ✅   | ⚠️   | UI 完成，后端基础实现 (2026-03-19)     |
| ssh_resize    | ✅   | ✅   | 使用 escape sequence 实现 (2026-03-19) |
| 命令历史      | ✅   | ✅   | SQLite 存储                            |
| Snippet       | ✅   | ✅   | 完整实现                               |
| 分屏模式      | ✅   | ✅   | 水平/垂直分屏                          |

### Phase 3 - 高级功能 ✅ 已完成

> 2026-03-19 完成 Phase 3 所有高级功能

| 功能               | 状态                   |
| ------------------ | ---------------------- |
| Agent 转发         | ✅ 已实现 (2026-03-19) |
| 主机链 (Jump Host) | ✅ 已实现 (2026-03-19) |
| Vault 加密存储     | ✅ 已实现 (2026-03-19) |
| 命令面板           | ✅ 已实现 (2026-03-19) |
| 多工作区           | ✅ 已实现 (2026-03-19) |
| 跨设备同步         | ✅ 已实现 (2026-03-19) |

### Phase 4 - 企业功能 ⚠️ 部分完成

> 2026-03-25 完成团队协作本地模式全部功能

| 功能                           | 状态                        |
| ------------------------------ | --------------------------- |
| 团队协作 - 本地模式            | ✅ 已实现 (2026-03-25)      |
| 敏感数据加密共享               | ✅ 已实现 (2026-03-25)      |
| 团队协作 - 云端模式            | 📋 文档就绪（见 `docs/team-server-deploy.md`），需自部署 NestJS 服务端 |
| SSH 证书认证                   | ✅ 已实现 (2026-03-26)      |
| 串口连接                       | ✅ 已实现 (2026-03-20)      |
| 数据存储服务 (WebDAV/S3/REST)  | ⚠️ 后端已接线 (2026-05-02)，全量同步 UX 仍迭代中 |
| SSH 密钥生成                   | ✅ 已实现 (2026-03-24)      |
| 高级脚本                       | ✅ 已实现 (2026-03-23)      |
| 终端工具侧栏 (Snippets + 历史) | ✅ 已实现 (2026-03-24)      |
| xterm.js ClipboardAddon        | ✅ 已实现 (2026-03-24)      |
| 主机环境变量编辑               | ✅ 已实现 (2026-03-24)      |
| SFTP Kind 列 + 权限显示        | ✅ 已实现 (2026-03-24)      |

### Phase 5 - UI/UX 系统化重构 ✅ 已完成

> 2026-05-02 完成全面的 UI 一致性与代码质量重构

| 项目                                                     | 状态                   |
| -------------------------------------------------------- | ---------------------- |
| 统一 `HostCard` 组件 (grid/list/mobile 三变体)           | ✅ 已实现 (2026-05-02) |
| 拆分 `HostsView` (395 → 263 行) 与工具栏组件             | ✅ 已实现 (2026-05-02) |
| 拆分 `PortForwardView` (646 → 272 行) 为独立子组件       | ✅ 已实现 (2026-05-02) |
| `ViewToolbar` 统一为 `min-h-14` 标准高度                 | ✅ 已实现 (2026-05-02) |
| `AppSidebar` 激活态加 3px 左侧竖条 + 默认宽度 200→176    | ✅ 已实现 (2026-05-02) |
| `TopToolbar` 三区分隔 (导航 / 标签 / 操作) + 命令面板入口 | ✅ 已实现 (2026-05-02) |
| 语义色 Token (info/warning/success) + 双主题适配         | ✅ 已实现 (2026-05-02) |
| 全局 `.card-interactive` 类（统一 hover/focus/press）    | ✅ 已实现 (2026-05-02) |
| Terminal 会话上下文状态条（目标 + 状态点 + 复制 SSH）    | ✅ 已实现 (2026-05-02) |
| `useStagger` 列表入场动画 hook                           | ✅ 已实现 (2026-05-02) |
| `RouteTransition` 路由切换过渡动画                       | ✅ 已实现 (2026-05-02) |
| 移除冗余文件 (`mobile-host-card.tsx`、`host-toolbar.tsx`) | ✅ 已实现 (2026-05-02) |

### Phase 6 - 终端可靠性 + UX 增强 ✅ 已完成

> 2026-05-02 修复关键的本地终端 bug，并清理代码 + 增强 UX

| 项目 | 状态 |
| --- | --- |
| 本地终端连接竞态、空白、无法输入修复 | ✅ 已实现 (2026-05-02，详见 issue.md #0) |
| WebKit (macOS / Safari) 同时按键输入丢字补偿 | ✅ 已实现 (2026-05-02) |
| 删除 deprecated `features/terminal/hooks/`，统一为 `useTerminal` | ✅ 已实现 (2026-05-02) |
| 终端右键菜单（复制/粘贴/全选/清屏/缩放） | ✅ 已实现 (2026-05-02) |
| 全局快捷键速查面板（Cmd+/ / Shift+?） | ✅ 已实现 (2026-05-02) |
| 终端无障碍属性（role / aria-label / focus-visible） | ✅ 已实现 (2026-05-02) |
| 构建产物分析脚本 + `pnpm build:analyze`（替代不兼容 visualizer） | ✅ 已实现 (2026-05-02) |
| i18n 三语种补齐 `terminal.*` / `shortcuts.*` | ✅ 已实现 (2026-05-02) |

### Phase 6.1 - 第二轮 (P0+P1+P2) ✅ 已完成

> 2026-05-02 在 Phase 6 基线上继续做 8 个细项。详见 `docs/todo.md` → "2026-05-02 第二轮"。
> 收益：首屏 gzip **259 → 242 KB**，主入口 `index.js` raw **256 → 159 KB（↓ 38%）**。

| 项目 | 状态 |
| --- | --- |
| 修复 `INEFFECTIVE_DYNAMIC_IMPORT` 警告 + xterm 真懒加载 | ✅ 已实现 (2026-05-02) |
| 修复 `Invalid input options exclude` 警告（vitest 配置外移） | ✅ 已实现 (2026-05-02) |
| 静态验证 SSH / 串口终端走同一修复路径 | ✅ 已实现 (2026-05-02) |
| 5 个全局对话框改 `React.lazy`（Settings/Host/CommandPalette/Notification/Serial） | ✅ 已实现 (2026-05-02) |
| Tailwind v4 production purge 验证（CSS gzip 仅 15.7 KB） | ✅ 已实现 (2026-05-02) |
| 终端搜索浮层（Cmd/Ctrl+F + SearchAddon + 三 toggle） | ✅ 已实现 (2026-05-02) |
| 命令面板 / 全局快捷键统一收口到 `shortcutsService` + CustomEvent 派发 | ✅ 已实现 (2026-05-02) |
| 移动端长按上下文菜单（等价右键菜单 + Sheet） | ✅ 已实现 (2026-05-02) |

#### 新增 / 修改 / 删除

- 新增：`hooks/use-global-shortcuts.ts`、`features/terminal/components/terminal-container/{terminal-search-overlay,terminal-mobile-menu}.tsx`、`vitest.config.ts`
- 修改：`vite.config.ts`（移除 manualChunks）、`layout/index.tsx`、`top-toolbar/index.tsx`、`bottom-nav/index.tsx`、`features/terminal/components/terminal-container/{container,terminal-context-menu}.tsx`、`service/shortcuts.ts`、`components/command-palette/index.tsx`、`scripts/bundle-stats.mjs`
- 删除：`view/home/`、`service/recording.ts`、`store/terminal.ts`、`features/terminal/stores/`、`view/terminal/{terminal-container,terminal-write-context,terminal-keyboard-bar,terminal.module.scss}`

### Phase 6.2 - 桌面化体验 + SFTP 队列 + Rust 可观测性 ✅ 已完成

> 2026-05-02 在 6.1 基线上继续做 4 个细项 (t1–t4)。

| 项目 | 状态 |
| --- | --- |
| **t1**：Tauri 系统托盘 + 窗口最小化到托盘 + 原生通知（仅失焦时弹） | ✅ 已实现 (2026-05-02) |
| **t1**：终端断连/出错时按窗口焦点决策原生通知 vs in-app | ✅ 已实现 (2026-05-02) |
| **t1**：会话状态条根据窗口焦点自动半透明 + tooltip 提示 | ✅ 已实现 (2026-05-02) |
| **t2**：SFTP 后端按 64KiB 分片上传/下载，事件 `sftp-progress` 推流 | ✅ 已实现 (2026-05-02) |
| **t2**：Tauri webview drag-drop → `useSftpDrop` → 自动入队 + 上传 | ✅ 已实现 (2026-05-02) |
| **t2**：`useTransferQueue` Zustand store + 浮层 `TransferPanel`（速率/ETA/状态） | ✅ 已实现 (2026-05-02) |
| **t3**：`shortcutsService` / `useTransferQueue` / `useWindowFocus` Vitest 单测 | ✅ 已实现 (2026-05-02) |
| **t4**：`tracing` + `tracing-subscriber` 替换 `env_logger`，`tracing-log` 桥接 | ✅ 已实现 (2026-05-02) |
| **t4**：移除 `state.rs` / `storage.rs` 的 blanket `#![allow(dead_code)]`，按字段精细化 | ✅ 已实现 (2026-05-02) |
| **t4**：所有 `eprintln!` / `log::info!` 迁移为带结构化字段的 `tracing::*` | ✅ 已实现 (2026-05-02) |

#### 新增

- 后端 Rust：`src-tauri/src/tray.rs`（托盘菜单 + 左键 toggle 主窗口）、`src-tauri/src/window_cmd.rs`（minimize-to-tray、show/hide/focused 命令）
- 前端：`packages/frontend/src/service/notifications.ts`、`packages/frontend/src/service/window-ux.ts`、`packages/frontend/src/service/sftp-transfer.ts`、`packages/frontend/src/store/transfer-queue.ts`
- 前端 Hook：`packages/frontend/src/hooks/use-window-focus.ts`、`packages/frontend/src/hooks/use-tray-events.ts`、`packages/frontend/src/view/sftp/use-sftp-drop.ts`
- 前端组件：`packages/frontend/src/view/sftp/transfer-panel.tsx`
- 单测：`packages/frontend/src/service/shortcuts.test.ts`、`packages/frontend/src/store/transfer-queue.test.ts`、`packages/frontend/src/hooks/use-window-focus.test.ts`

#### 修改

- 后端 Rust：
  - `src-tauri/Cargo.toml`：新增 `tauri-plugin-notification`、`tracing`、`tracing-subscriber`、`tracing-log`，给 `tauri` 加 `tray-icon`、`image-png` features
  - `src-tauri/src/lib.rs`：`init_tracing` 初始化 + `LogTracer` 桥接 + 注册 `notification` 插件 + tray setup + `on_window_event` 拦截关闭 + 注册新 window 命令
  - `src-tauri/src/sftp.rs`：`Arc<SftpSession>` 共享 + `CHUNK_SIZE` (64KiB) + `emit_progress` 节流推流 + 上传/下载结构化 tracing
  - `src-tauri/src/state.rs`：去掉 blanket `#![allow(dead_code)]`，按字段添加 `#[cfg_attr(not(unix), allow(dead_code))]` / 字段级 allow，并写明所有权语义
  - `src-tauri/src/storage.rs`：移除全局 `#![allow(dead_code)]` 后改为 *单条带文档* 的模块级 allow，明确该模块当前是 stub
  - `src-tauri/src/session/channel.rs`、`src-tauri/src/window_cmd.rs`：`eprintln!` / `log::info!` → `tracing::*` 含 `session_id` / `event` 等结构化字段
  - `src-tauri/capabilities/default.json`：补齐 `core:window:allow-{show,hide,set-focus,unminimize,is-focused,is-visible}` + `core:event:allow-{listen,unlisten}` + `notification:default`
  - `src-tauri/tauri.conf.json`：`app.windows[0].dragDropEnabled = true`
- 前端：
  - `packages/frontend/src/App.tsx`：启动时把桌面 UX 偏好同步到通知服务和 Tauri
  - `packages/frontend/src/layout/index.tsx`：挂载 `useTrayEvents()`，托盘菜单 → `shortcut:*` CustomEvent → 复用既有快捷键链路
  - `packages/frontend/src/components/settings-dialog/{index,general-settings}.tsx`：新增 *Desktop UX* section（minimize-to-tray / native notifications / notify-only-when-unfocused）
  - `packages/frontend/src/features/terminal/components/terminal-container/{container,session-status-bar}.tsx`：断连/出错按窗口焦点决策通知；状态条 unfocused 时半透明 + tooltip
  - `packages/frontend/src/features/terminal/services/sftp.ts`：兼容新的 `transfer_id` 后端参数
  - `packages/frontend/src/view/sftp/sftp-container.tsx`：拖拽覆盖层 + 队列面板 + dialog.open/save 走 `sftp-transfer`
  - 国际化：`packages/frontend/src/locales/{cn,en,fr}/app.ts` 新增 `terminal.windowUnfocused`、`settings.{desktopSection,minimizeToTray*,nativeNotifications*,notifyOnlyWhenUnfocused*}`、`sftp.{transfersTitle,transferActive_*,transferErrors_*,transferEta,transferDone,clearFinished,dropToUpload}`

#### 收益

- **可观测性**：所有后端日志统一 `tracing` 输出，`RUST_LOG` 仍兼容；新增 `transfer_id` / `session_id` / `bytes_total` 等结构化字段，方便后续接 Loki/OpenTelemetry。
- **桌面感**：从 X 关闭可隐藏到托盘；后台时 SSH 断开会跳原生 OS 通知（被聚焦时仍走 in-app toast，不打扰）。
- **SFTP 体感**：单文件 GB 级传输也能看到实时百分比 + 速率 + ETA；多任务不再阻塞列表刷新。
- **代码卫生**：Rust `cargo check` 警告由 14 条降至 0；`#![allow(dead_code)]` 全部带注释解释为何保留。
- **覆盖率**：新增 3 个测试文件，覆盖 `shortcutsService` 关键路径、传输队列状态机、窗口焦点 hook 的初始/事件路径。

### Phase 6.3 - 文档对齐 + 远程存储命令接线 ✅ 已完成

> 2026-05-02：与「按序做」一致——`docs/project.md` 待办与代码对齐；`StorageManager` 注入 Tauri，`storage_init` / `health` / `upload` / `download` / `list` / `delete` 走真实后端；设置页 S3 测试连接补充 `bucket` 参数。

| 项目 | 状态 |
| --- | --- |
| P1/P2/P3 checklist 与 `issue.md` / 代码路径一致 | ✅ |
| `lib.rs` `.manage(Arc<StorageManager>)` + `storage_*` 使用默认后端名 `default` | ✅ |
| 前端 `storageInit` 传入 `bucket`（S3） | ✅ |

### Phase 6.4 - 代码质量 + 命令补全 + 跨设备同步 UX ✅ 已完成

> 2026-05-03：拆分 8 个大文件 + 实现 Tab 补全 + 完善导出/导入/同步流程。

#### 代码质量 — 大文件拆分

> 严格按 `AGENTS.md` 行数限制（视图 300 / 组件 400 / 工具 300）拆分。

| 原文件 | 拆分后 | 状态 |
| --- | --- | --- |
| `view/teams/index.tsx` (350 行) | `index.tsx` (253 行) + `team-list-sidebar.tsx` (85 行) + `disabled-teams-view.tsx` (46 行) | ✅ |
| `host-list/host-dialog.tsx` (422 行) | `host-dialog.tsx` (261 行) + `host-form-basic.tsx` (160 行) + `host-form-actions.tsx` (80 行) | ✅ |
| `view/keychain/index.tsx` (303 行) | `index.tsx` (270 行) + `use-key-form.ts` (237 行) | ✅ |
| `view/hosts/index.tsx` (264 行) | `index.tsx` (~165 行) + `render-list-body.tsx` (~90 行) | ✅ |
| `view/snippets/index.tsx` (266 行) | `index.tsx` (~190 行) + `use-script-form.ts` (~160 行) | ✅ |

**拆分原则：** 按职责拆分——侧边栏/内联视图拆为独立组件，表单状态提取为 hook，数据渲染拆为纯展示组件。

#### 命令补全 — Tab 键拦截 + 前缀匹配浮层

| 新文件 | 功能 |
| --- | --- |
| `hooks/use-command-completion.ts` | `extractCurrentWord()` / `findMatches()` / `getCursorScreenPosition()` / `applyCompletion()` 工具函数 |
| `components/terminal-completion/terminal-completion-overlay.tsx` | 浮动补全浮层（VS Code 风格、↑↓/Tab/Enter/Esc 导航） |
| 修改 `hooks/use-terminal.ts` | Tab 键拦截（`data === '\t'` 时调用 `onTabPress` 回调，不发往后端） |
| 修改 `terminal-container/container.tsx` | Tab 补全状态 + 浮层渲染 |

**工作方式：** 在 xterm `onData` 层拦截 Tab → 提取当前词 → 前缀匹配 SQLite 历史 → 显示浮层 → Tab/↑↓ 循环选择 → 替换当前词。

#### 跨设备同步 — 导出/导入/同步流程完善

| 改动 | 说明 |
| --- | --- |
| `service/sync.ts`：`importDataFromFile()` | 原来占位符 (TODO) 替换为完整实现：按依赖顺序导入 groups/hosts/snippets/ssh_keys/known_hosts/workspaces，支持 merge/replace 模式 |
| `service/sync.ts`：新增 `syncToServer()` | 收集全部数据 → 上传 `terminal-sync-{timestamp}.json` + `terminal-latest.json` 到存储服务 |
| `service/sync.ts`：新增 `downloadFromServer()` | 从存储服务下载 `terminal-latest.json` → 调用 `importDataFromFile()` 写入本地 DB |
| `service/sync.ts`：新增 `getLastSyncTime()` / `formatLastSyncTime()` | 从 localStorage 读取并格式化上次同步时间 |
| `settings-dialog/storage-settings-dialog.tsx` | 新增「Sync Now」+「Restore from Server」按钮 + 同步状态指示器（last sync 时间 + restore mode 选择） |
| `view/settings/storage-settings.tsx` | 同上，settings 页面版 |
| i18n 补键 | `settings.lastSync` / `never` / `restoreMode` / `restoreFromServer` / `restoring` 中英法三语 |

**存储路径约定：** `terminal-latest.json`（始终最新） + `terminal-sync-{iso-timestamp}.json`（时间戳备份）。

**新增/修改文件：**
- 新增：`packages/frontend/src/hooks/use-command-completion.ts`、`packages/frontend/src/components/terminal-completion/terminal-completion-overlay.tsx`、`packages/frontend/src/view/teams/components/{team-list-sidebar,disabled-teams-view}.tsx`、`packages/frontend/src/view/hosts/components/render-list-body.tsx`、`packages/frontend/src/view/snippets/use-script-form.ts`、`packages/frontend/src/view/keychain/use-key-form.ts`、`packages/frontend/src/components/host-list/{host-form-basic,host-form-actions}.tsx`
- 修改：`packages/frontend/src/{hooks/use-terminal.ts,service/sync.ts,components/settings-dialog/storage-settings-dialog.tsx,view/settings/storage-settings.tsx,features/terminal/components/terminal-container/container.tsx,locales/{en,cn,fr}/settings.ts}`

---

## 待办事项

### P0 - 必须完成

- [x] ~~实现 SSH 密钥认证后端 (使用 russh-keys)~~ ✅ 已完成
- [x] ~~实现 SFTP 后端功能 (使用 russh-sftp)~~ ✅ 已完成

### P1 - 应该完成

- [x] ~~实现端口转发后端~~ ✅ 已有 `port_forward_*` 与 `-L/-R/SOCKS` 等实现；复杂场景与边界见 `docs/issue.md` Issue #3「待完善」
- [x] ~~清理 Rust 编译警告~~ ✅ `cargo check` 0 警告（2026-05-02 Phase 6.2 / tracing + dead_code 精细化）
- [x] ~~ssh_resize 实际生效~~ ✅ `session_resize`：`LocalSession` 调 `pty.resize`；`SshSession` 发 `CSI … t` 窗口尺寸序列（`session/ssh.rs`）

### P2 - 建议完成

- [x] ~~**SSH Agent 作为认证方式连接主机**~~ ✅ 已实现（2026-05-03）：`session_create_ssh_agent` + `SessionService.createSshAgent`；`jump_host.target_auth_type === 'agent'` 正确路由到 `authenticate_with_agent`；Pageant 与实机回归见 Issue #21
- [x] ~~实现主机链功能~~ ✅ `session_create_ssh_jump` + `SshSession::new_with_jump`
- [x] ~~命令快速补全~~ ✅ Tab 拦截 + 历史前缀匹配 + 路径补全 + shell 子命令补全（2026-05-03）
- [x] ~~Vault 加密存储~~ ✅ `vault_*` 命令集

### P3 - 未来考虑

- [x] ~~命令面板完善~~ ✅（与 Phase 3 一致；持续小优化不阻塞）
- [x] ~~多工作区~~ ✅
- [ ] **跨设备同步**：设置里可配 WebDAV/S3/REST；后端 `StorageManager` 已注入并由 `storage_*` 命令走真实后端（2026-05-02）；`importDataFromFile()` 已完整实现；`syncToServer()` / `downloadFromServer()` 已接线；上层流程仍可按产品迭代

---

## 问题追踪

详细问题列表请查看 [docs/issue.md](docs/issue.md)。

### 关键问题

| #   | 问题                   | 严重程度     | 状态                   |
| --- | ---------------------- | ------------ | ---------------------- |
| 1   | SFTP 后端未实现        | 🔴 Critical  | ✅ 已实现 (2026-03-19) |
| 2   | SSH 密钥认证后端未实现 | 🔴 Critical  | ✅ 已实现 (2026-03-19) |
| 3   | 端口转发后端未实现     | 🔴 Critical  | ✅ 已实现 (2026-03-26) |
| 4   | Rust 编译警告需清理    | 🟡 Important | ✅ 已清理 (2026-03-26) |
| 5   | Agent 认证未实现       | 🟡 Important | ✅ 已实现 (2026-03-26) |
| 6   | SSH 证书认证未实现     | 🟡 Important | ✅ 已实现 (2026-03-26) |

---

## 数据库表结构

### hosts 表

```sql
CREATE TABLE hosts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hostname TEXT NOT NULL,
  port INTEGER DEFAULT 22,
  username TEXT NOT NULL,
  auth_type TEXT DEFAULT 'password',
  password TEXT,
  private_key TEXT,
  group_id TEXT,
  is_favorite INTEGER DEFAULT 0,
  color TEXT,
  tags TEXT,
  port_forwards TEXT,
  startup_command TEXT,
  environment TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
```

### groups 表

```sql
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  color TEXT,
  inherit_settings INTEGER DEFAULT 1,
  settings TEXT,
  "order" INTEGER DEFAULT 0
);
```

### command_history 表

```sql
CREATE TABLE command_history (
  id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  session_id TEXT,
  created_at INTEGER
);
```

### snippets / snippet_packages 表

```sql
CREATE TABLE snippet_packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER
);

CREATE TABLE snippets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  script TEXT NOT NULL,
  package_id TEXT,
  created_at INTEGER
);
```

### settings 表

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

### known_hosts 表

```sql
CREATE TABLE known_hosts (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL,
  port INTEGER DEFAULT 22,
  fingerprint TEXT NOT NULL,
  created_at INTEGER
);
```

### teams / team_members / team_shared_hosts 表（团队协作）

```sql
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  mode TEXT DEFAULT 'local',
  endpoint TEXT,
  api_token TEXT,
  auto_sync INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE team_members (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT,
  user_email TEXT,
  role TEXT DEFAULT 'member',
  joined_at INTEGER,
  UNIQUE(team_id, user_id)
);

CREATE TABLE team_shared_hosts (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  host_data TEXT NOT NULL,
  shared_by TEXT NOT NULL,
  permission TEXT DEFAULT 'readonly',
  created_at INTEGER
);

CREATE TABLE team_shared_snippets (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  snippet_data TEXT NOT NULL,
  shared_by TEXT NOT NULL,
  permission TEXT DEFAULT 'readonly',
  created_at INTEGER
);

CREATE TABLE team_invites (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  type TEXT NOT NULL,
  code TEXT UNIQUE,
  link_token TEXT UNIQUE,
  email TEXT,
  role TEXT DEFAULT 'member',
  created_by TEXT NOT NULL,
  expires_at INTEGER,
  used_at INTEGER,
  created_at INTEGER
);

CREATE TABLE team_audit_logs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT,
  host_name TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at INTEGER
);

CREATE TABLE sync_queue (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  type TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  data TEXT,
  status TEXT DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  error TEXT,
  created_at INTEGER,
  synced_at INTEGER
);

CREATE TABLE user_profile (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);
```

---

## Team Server (NestJS 后端)

团队协作服务端，位于 `packages/team-server/` 目录。

### 技术栈

| 层级     | 技术            |
| -------- | --------------- |
| 框架     | NestJS 10.x     |
| ORM      | Prisma 7.x      |
| 数据库   | PostgreSQL 16   |
| API 文档 | Swagger/OpenAPI |
| 容器     | Docker          |

### 部署指南

详细部署说明请参考 `docs/team-server-deploy.md`，包含：

- Docker Compose 快速部署
- 生产环境配置（资源限制、备份策略）
- Nginx / Caddy 反向代理配置
- 数据库维护（备份、恢复、迁移）
- 安全加固清单（TLS、限流、网络隔离）
- 故障排查指南

### 启动方式

```bash
cd packages/team-server

# Docker 部署 (推荐)
docker-compose up -d

# 本地开发
npm install
npx prisma generate
npx prisma migrate dev
npm run start:dev
```

### 前端连接

前端通过 `src/service/team-api.ts` 连接服务端：

```typescript
import { teamApi } from '@/service/team-api'

// 配置 API
teamApi.configure('http://localhost:3000', 'your-api-token', 'user-id')

// 使用 API
const response = await teamApi.listTeams()
```

在设置对话框中配置服务端地址和 API Token。配置成功后会自动同步团队数据。

### API 端点

| 模块 | 前缀                 | 方法   | 端点        | 说明             |
| ---- | -------------------- | ------ | ----------- | ---------------- |
| 认证 | /auth                | POST   | /register   | 注册用户         |
| 认证 | /auth                | POST   | /tokens     | 创建 API Token   |
| 认证 | /auth                | GET    | /tokens     | 获取 Token 列表  |
| 认证 | /auth                | DELETE | /tokens/:id | 撤销 Token       |
| 团队 | /teams               | GET    | /           | 获取我的团队     |
| 团队 | /teams               | POST   | /           | 创建团队         |
| 团队 | /teams               | GET    | /:id        | 获取团队详情     |
| 团队 | /teams               | PUT    | /:id        | 更新团队         |
| 团队 | /teams               | DELETE | /:id        | 删除团队         |
| 成员 | /teams/:id/members   | GET    | /           | 获取成员列表     |
| 成员 | /teams/:id/members   | POST   | /           | 添加成员         |
| 成员 | /teams/:id/members   | PUT    | /:memberId  | 更新角色         |
| 成员 | /teams/:id/members   | DELETE | /:memberId  | 移除成员         |
| 共享 | /teams/:id/shares    | GET    | /           | 获取共享列表     |
| 共享 | /teams/:id/shares    | POST   | /           | 创建共享         |
| 共享 | /teams/:id/shares    | PUT    | /:shareId   | 更新权限         |
| 共享 | /teams/:id/shares    | DELETE | /:shareId   | 删除共享         |
| 邀请 | /teams/:id/invites   | POST   | /           | 创建邀请         |
| 邀请 | /teams/:id/invites   | GET    | /           | 获取邀请列表     |
| 邀请 | /invites/join        | POST   | /           | 通过邀请码加入   |
| 邀请 | /invites/link/:token | GET    | /           | 获取链接邀请信息 |
| 审计 | /teams/:id/audit     | GET    | /           | 获取审计日志     |
| 同步 | /sync                | GET    | /           | 获取增量更新     |
| 同步 | /sync                | POST   | /           | 推送本地更改     |

---

_文档更新时间: 2026-05-03 (Phase 6.6: TODO清理 + 端口转发数据库集成 + 工作区布局保存/加载 + SSH Agent完善 + 新增3个测试文件 + 文档对齐)_
