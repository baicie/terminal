# Terminal 项目文档

> 本文档记录项目的完整结构、实现状态和待办事项

---

## 目录

- [当前进度与当前目标](#当前进度与当前目标) - 最近一次开发快照与后续验证边界
- [项目结构](#项目结构) - 完整代码结构
- [实现状态](#实现状态) - 功能实现进度
- [待办事项](#待办事项) - 未来开发计划
- [问题追踪](#问题追踪) - 已知问题列表

---

## 当前进度与当前目标

> 快照日期：2026-08-28；当前分支：`feat/mvp`。

| 项目 | 状态 |
| --- | --- |
| 当前目标 | 🔄 完成 macOS 物理键盘 30 轮重叠按键注入；在 Linux runner 首跑 real-machine 工作流；继续 Windows/Pageant/串口人工矩阵与 Shell Integration 配置 |
| 当前进度 | Phase 6.20 已把「打开应用后 10 秒内进入可靠终端」变成三层门禁：`firstConnectionMs` 进入 smoke 结果契约并由前端、Rust、runner 同时强制 < 10 秒。真实 SSH 认证矩阵（password/key/agent/cert/jump + 断线重连）在本机 macOS 全部通过，7 个用例首次连接 1.7–3.3 秒。物理键盘资格门禁完成应用侧自动化（本地 PTY 探针协议 + CGEvent 重叠注入驱动 + Accessibility 检查），等待宿主进程授权后执行 30 轮 `a/s/d`。Linux 已接线（fixture/runner 可移植 + `TERMINAL_SMOKE_TMP`），新增 `.github/workflows/real-machine-matrix.yml` 供 macOS/Linux 原生 runner 执行。 |
| 自动化基线 | `pnpm verify` 全绿：前端 99 个测试文件/859 项、Team Server 25 个文件/103 项、Rust 164 个单测 + 3 个桌面配置集成测试，以及 lint/typecheck/build/fmt/Clippy/源码门禁；Node smoke 脚本 36 项测试通过。`smoke:ssh-matrix` 7 用例全绿（首次连接 1764–3261 ms）。 |
| 下一验证目标 | 授予宿主进程辅助功能权限后执行 `pnpm smoke:input-probe`（30 轮重叠 `a/s/d` + expected/received hex）；首次 dispatch real-machine 工作流完成 Linux Xvfb 实机 smoke；Windows OpenSSH/Pageant/PTY/串口按 issue.md 人工清单；为常见 shell 提供显式 Shell Integration 配置 |

终端工作台方案见 [`docs/plans/terminal-workbench-rebuild.md`](plans/terminal-workbench-rebuild.md)，可靠性规格见 [`docs/plans/terminal-reliability-rebuild.md`](plans/terminal-reliability-rebuild.md)；当前完成项见 [`docs/todo.md`](todo.md) Phase 6.20，安全修复与验证边界见 [`docs/issue.md`](issue.md) Issue #57/#58。

---

## 项目结构

```text
terminal/
├── packages/
│   ├── frontend/                 # React 19、Vite、Zustand、shadcn/ui
│   └── team-server/              # NestJS、Prisma、PostgreSQL
├── src-tauri/                    # Tauri 2、Rust、russh
├── scripts/                      # 发布与源码规模门禁
├── docs/                         # 项目、问题、待办、UI 与发布文档
├── package.json                  # pnpm workspace 根脚本
└── pnpm-lock.yaml
```

---

## `packages/frontend/src/` 前端结构

```text
src/
├── components/                   # 通用与 shadcn/ui 组件
├── features/terminal/            # xterm、终端容器、会话服务与类型
├── hooks/                        # React hooks 与终端数据流
├── layout/                       # 主布局与标签页
├── locales/                      # en / fr / cn
├── router/                       # React Router
├── service/                      # SSH、SQLite、同步与 Team API
├── store/                        # Zustand stores
├── types/                        # 公共 TypeScript 类型
└── view/                         # Hosts、SFTP、Vaults、Teams 等视图
```

---

## `src-tauri/` Rust 后端结构

```text
src-tauri/
├── src/
│   ├── main.rs                    # 二进制入口
│   ├── lib.rs                     # 命令与插件注册
│   ├── commands.rs                # 会话命令
│   ├── session/                   # SSH、本地 PTY、连接池与类型
│   ├── sftp.rs                    # SFTP
│   ├── serial.rs                  # 串口
│   └── port_forward.rs            # 端口转发
├── Cargo.toml
├── tauri.conf.json
└── capabilities/
```

### Rust 核心命令

| 命令                  | 功能             | 状态                   |
| --------------------- | ---------------- | ---------------------- |
| `session_create_ssh_password` | SSH 密码连接 | ✅ 已实现 |
| `session_create_ssh_key` | SSH 密钥连接 | ✅ 已实现 |
| `session_create_ssh_agent` | SSH Agent 登录 | ✅ 已实现；Windows/Pageant 待实机 |
| `session_create_ssh_cert` | SSH 证书直连 | ✅ 已实现 |
| `session_create_ssh_jump` | Jump Host | ✅ password/key/agent/cert 已接线；真实服务待验证 |
| `session_create_local` | 本地终端 | ✅ 已实现 |
| `session_write` | 会话写入 | ✅ 已实现 |
| `session_resize` | 调整终端大小 | ✅ 本地 PTY resize；SSH RFC 4254 `window-change` |
| `session_close` | 关闭会话 | ✅ 已实现 |
| `session_exec` | 执行单条命令 | ✅ 已实现 |
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
| ssh_resize    | ✅   | ✅   | 本地 PTY resize；SSH 使用 RFC 4254 `window-change` |
| 命令历史      | ✅   | ✅   | SQLite 存储                            |
| Snippet       | ✅   | ✅   | 完整实现                               |
| 分屏模式      | ✅   | ✅   | 水平/垂直分屏                          |

### Phase 3 - 高级功能 ✅ 代码完成，实机待验证

> Agent forwarding 与 Jump Host certificate 已完成自动化代码验收；真实 SSH 服务和跨平台行为仍按发布矩阵验证。

| 功能               | 状态                   |
| ------------------ | ---------------------- |
| Agent 转发         | ✅ 独立 opt-in 设置、显式请求、handler 授权、连接池隔离与团队导入安全边界已实现；待实机 |
| 主机链 (Jump Host) | ✅ 主终端入口与 SQLite 已接线；跳板端和目标端支持 password/key/agent/cert；待 Windows/Linux 实机验证 |
| Vault 加密存储     | ✅ 已实现 (2026-03-19) |
| 命令面板           | ✅ 已实现 (2026-03-19) |
| 多工作区           | ✅ 已实现 (2026-03-19) |
| 跨设备同步         | ✅ 已实现 (2026-03-19) |

### Phase 4 - 企业功能 ✅ 已完成

> 2026-03-25 完成团队协作本地模式全部功能；2026-05-03 完成云端增量同步、离线队列、加密分享

| 功能                           | 状态                        |
| ------------------------------ | --------------------------- |
| 团队协作 - 本地模式            | ✅ 已实现 (2026-03-25)      |
| 敏感数据加密共享               | ✅ 已实现 (2026-03-25)      |
| 团队协作 - 云端模式           | ✅ 已实现 (2026-05-03) — NestJS 增量同步 + 离线队列 + 加密分享 |
| 数据存储服务 (WebDAV/S3/REST) | ✅ 后端已接线 (2026-05-02)，全量同步 UX 完成 (2026-05-03) |
| 增量同步 + 冲突检测           | ✅ 已实现 (2026-05-03)      |
| 离线操作队列                  | ✅ 已实现 (2026-05-03) — SyncQueue Prisma 模型 + 原子 claim、processing token 租约和陈旧任务恢复 |
| 加密分享 (AES-256-GCM)       | ✅ 已实现 (2026-05-03) — vault_encrypt_for_team / vault_decrypt_for_team |
| SSH 证书认证                   | ✅ 已实现 (2026-03-26)      |
| 串口连接                       | ✅ 已实现 (2026-03-20)      |
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

### Phase 6.5 - Agent 错误细化 + 命令补全修复 + 串口显示 + 云同步 UX + NestJS 部署文档 ✅ 已完成

> 2026-05-03：Agent 错误语义细化、前端按错误类型分发 14 种人类可读文案、命令补全完善、Windows 串口端口显示增强、云同步 UX 完善、NestJS 自托管部署文档。

#### Agent 认证失败 UI 细化

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
| `use-command-completion.test.ts` | 新增 `findAliasMatches` / `findFunctionMatches` / `getCompletionTypeLabel` 单元测试 |

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

### Phase 6.6 - TODO清理 + 端口转发持久化 + SSH Agent完善 + 测试覆盖 + 文档对齐 ✅ 已完成

> 2026-05-03：清理前端所有 TODO 占位符、端口转发规则接入数据库、工作区布局保存/加载、单元测试增强。

#### Issue #34: 前端 TODO 占位符清理 ✅ 已修复

| 文件 | 修复 |
| --- | --- |
| `service/ssh.ts:saveCommandHistory` | 改为调用 `addCommandHistory`（数据库已实现） |
| `workspace-switcher/index.tsx` | 切换工作区时调用 `saveLayout` + `loadLayout` |
| `view/port-forward/index.tsx` | 新增 `port_forward_rules` 表 + CRUD，接入数据库持久化 |

#### Issue #35: 端口转发数据库持久化 ✅ 已实现

- `port_forward_rules` 表：独立表存储转发规则，与主机解耦
- CRUD 操作：`createPortForwardRule` / `getPortForwardRules` / `updatePortForwardRule` / `deletePortForwardRule`
- 前端集成：`PortForwardView` 的 `loadForwards` 从 DB 读取，`handleStartForward` 写入 DB

#### Issue #36: 工作区布局保存/加载 ✅ 已实现

`workspace-switcher/index.tsx` 的 `handleSelectWorkspace`：
1. 切换前调用 `workspaceStore.saveLayout` 持久化当前布局
2. 切换后调用 `workspaceStore.loadLayout` 恢复新工作区布局

#### Issue #37: SSH Agent 认证接入统一 API ✅ 已实现

- `SessionService.createSshAgent`：调用 `session_create_ssh_agent`，含连接日志
- Jump Host 目标 Agent：`connect_via_jump` 接收 `use_target_agent` 参数
- `SshSession::create` 签名：新增 `use_target_agent: bool` 参数，区分跳板机自身认证与目标主机认证

#### Issue #38: 单元测试覆盖增强 ✅ 已完成

| 文件 | 覆盖 |
| --- | --- |
| `service/database/command-history.test.ts` | `addCommandHistory` / `getCommandHistory` / `searchCommandHistory` / `clearCommandHistory` |
| `service/database/port-forward-rules.test.ts` | 全套 CRUD，含字段映射和 host_id=null 边界 |
| `store/workspace.test.ts` | `loadWorkspaces` / `setActiveWorkspace` / `deleteWorkspace` / `loadLayout` / `saveLayout` |

**结果**：14 测试文件，333 测试，全部通过。

### Phase 6.7 - 测试覆盖增强 + 文档完善 + 移动端优化 + 超大文件拆分 + SSH 证书认证增强 ✅ 已完成

> 2026-05-03：补全 shell-rc / sync / command-completion 纯函数测试，更新项目文档，更新 AGENTS.md 文件拆分清单。

#### 测试覆盖增强

| 文件 | 覆盖 |
| --- | --- |
| `service/shell-rc.test.ts` | `toCompletionItems` / `matchRCItems` — alias/function 转换、过滤、去重、截断 |
| `service/sync.test.ts` | `previewTeamPackage` / `previewImportData` / `getLastSyncTime` / `formatLastSyncTime` — 全部边界（已有） |
| `hooks/use-command-completion.test.ts` | 补充 `findAliasMatches` / `findFunctionMatches` / `getCompletionTypeLabel('alias'/'function')` |

**最新结果**：15 测试文件，356 测试，全部通过。

#### 文档完善

| 改动 | 说明 |
| --- | --- |
| `docs/project.md` | 补充 Phase 6.5 / 6.6 / 6.7 章节；修正 `ssh_resize` 状态描述 |
| `AGENTS.md` 文件拆分清单 | `view/settings/index.tsx` (163 行) 和 `components/settings-dialog/index.tsx` (278 行) 已拆分至 300 行以内，移出待拆分清单 |
| `docs/issue.md` | 确认所有 Critical / Important 问题均已标记 ✅ |

#### 移动端体验

见「任务 3」章节。

#### 超大文件拆分确认

| 文件 | 原行数 | 限制 | 当前行数 | 状态 |
| --- | --- | --- | --- | --- |
| `view/settings/index.tsx` | 1203 | 300 | 163 | ✅ 已拆分（导入 6 个子 Tab 组件） |
| `components/settings-dialog/index.tsx` | 1221 | 400 | 278 | ✅ 已拆分（导入 6 个子组件） |

#### SSH 证书认证增强

| 改动 | 说明 |
| --- | --- |
| `session/ssh.rs` | `authenticate_with_cert` 支持带证书的密钥认证 |
| `commands.rs` | `session_create_ssh_cert` 命令支持密钥 + 证书参数 |
| 冲突处理 UI | ✅ 已实现（Phase 6.8，见下方章节） |

---

### Phase 6.8 - NestJS 云端同步完善 + 加密分享 + 构建优化 + UX 增强 ✅ 已完成

> 2026-05-03：完善 NestJS 增量同步 + 离线队列；前端 Team Store 双向同步 + 冲突追踪；Prisma SyncQueue 模型；团队加密分享（vault_encrypt_for_team）；前端构建优化（storage-settings 导航修复）。

#### NestJS 服务端增强

| 改动 | 说明 |
| --- | --- |
| `prisma/schema.prisma` | 新增 `SyncQueue` 模型；`Share` 新增 `encryptedData`/`isSensitive` 字段 |
| `sync/sync.service.ts` | 增量同步（`getChanges` 含 `deletedShareIds`）；乐观并发（`baseVersion`）；离线队列增删改查 + 原子 claim（最多 50 条）；`processingToken` 租约校验与 15 分钟陈旧任务恢复；冲突检测 + 解决（LOCAL/REMOTE）；加密数据支持 |
| `sync/sync.controller.ts` | 新增 5 个离线队列 REST 端点 |
| `sync/sync.controller.test.ts` | 13 个单元测试 |
| `shares/shares.service.ts` | `create`/`update` 支持加密数据；`delete` 写入 `SHARE_DELETED` 审计日志 |
| `shares/shares.controller.ts` | `create`/`update` 支持加密数据参数 |
| `main.ts` | CORS credentials 支持；`CORS_ORIGINS` 多值解析 |
| `docker-compose.yml` | 新增 `CORS_ORIGINS` 环境变量 |

#### 前端增量同步

| 改动 | 说明 |
| --- | --- |
| `service/team-api.ts` | `pushChanges` 支持加密数据 + `deleteShares`；新增 5 个离线队列方法 |
| `store/team.ts` | `sync()` 双向同步；新增 `syncConflicts`/`offlineQueueCount` 状态；新增冲突解决 + 离线队列方法 |

#### Rust 加密命令

| 改动 | 说明 |
| --- | --- |
| `vault.rs` | 新增 `vault_encrypt_for_team` / `vault_decrypt_for_team` / `vault_can_encrypt_for_team` |
| `lib.rs` | 注册 3 个新 vault 命令 |

#### 构建优化

| 改动 | 说明 |
| --- | --- |
| `team-server/vitest.config.ts` | 移除 `*.service.ts` 排除，使 service 层可被测试覆盖 |

#### UX 增强

| 改动 | 说明 |
| --- | --- |
| `layout/index.tsx` | 订阅 `shortcut:next-tab` / `shortcut:prev-tab` 事件，实现 Ctrl+Tab / Ctrl+Shift+Tab 切换标签（含 URL 同步） |
| `container.tsx` | xterm 设置从 `appStore.config` 读取 `terminalCursorBlink`/`terminalFontSize`/`terminalFontFamily`/`terminalScrollback`，终端初始化时注入；`useEffect` 动态更新 fontSize 和 cursorBlink（无需重建终端） |
| `top-toolbar/index.tsx` | SFTP 按钮增加传输中徽章，显示 `running`/`queued` 状态的传输任务数量 |

---

### Phase 6.9 - SSH Key 生成 + 命令执行 + i18n 补全 + 文档完善 ✅ 已完成

> 2026-05-03：实现 SSH 密钥生成后端；重构命令执行可靠性；补全三语种翻译；重写用户文档。

#### SSH 密钥生成

| 改动 | 说明 |
| --- | --- |
| `commands.rs` | 新增 `key_generate` Tauri 命令，支持 Ed25519/RSA/ECDSA 全类型，使用 `ssh_key` crate 生成私钥、公钥指纹 |
| `types.rs` | 新增 `KeyGenResult` 结构体和 `KeyGenerationFailed` 错误变体 |
| `lib.rs` | 注册 `key_generate` 命令，导出 `KeyGenResult` |
| `ssh.ts` (frontend) | `generateSSHKey` 改为调用 `invoke('key_generate')`，完整实现 Ed25519/RSA 2048/RSA 4096/ECDSA P-256/P-384/P-521 |
| `generate-dialog.tsx` | UI 已存在，调用链已接通 |

#### SSH 证书认证

| 改动 | 说明 |
| --- | --- |
| `ssh.rs` | `authenticate_with_cert` 已完整实现，使用 `russh::keys::Certificate::from_openssh` + `authenticate_openssh_cert` |
| `session_create_ssh_cert` | Tauri 命令已注册，接线完成 |
| `Signer trait` | `authenticate_certificate_with` 委托签名为未来扩展点，已在 Issue #5 中标注 |

#### 命令执行可靠性

| 改动 | 说明 |
| --- | --- |
| `ssh.ts` (frontend) | `execute()` 重构：移除 PTY shell hack，改用 `invoke('session_exec')` 调用后端 exec channel；捕获真实 exit code；默认超时 30s（可配置）；移除竞态条件监听器设置 |

#### i18n 三语种补全

| 改动 | 说明 |
| --- | --- |
| `fr/cmdPalette.ts` | 新增 17 个缺失键（SFTP 会话、传输队列、工作区切换等） |
| `fr/teams.ts` | 修复 `enterInviteCode` 中的西班牙语拼写错误（"invitación" → "code d'invitation"） |
| `fr/settings.ts` | 新增 4 个缺失键（连接状态提示） |
| `cn/snippets.ts` | 新增 4 个缺失键（执行历史时间/持续时间） |

#### 用户文档

| 改动 | 说明 |
| --- | --- |
| `README.md` | 完全重写：项目介绍、核心功能、快捷键速查、项目结构、技术栈、快速开始 |
| `package.json` | 新增 `description` 字段 |

---

### Phase 6.10 - 跨平台 SSH / 串口 / 本地终端可靠性 ✅ 代码已完成

> 2026-08-09：修复主机密钥验证、Jump Host 目标认证、Windows Agent 传输、串口阻塞与短写、PTY 生命周期及快捷键冲突。详见 `docs/issue.md` Issue #39。

| 领域 | 改动 |
| --- | --- |
| SSH 安全 | 按 host/port 严格校验系统 `known_hosts`；未知主机和密钥变化返回错误 |
| Jump Host | 在 `direct-tcpip` 流内建立目标 SSH 会话；连接池区分并保留跳板 transport |
| Windows Agent | OpenSSH named pipe + `russh` 原生 Pageant 回退；Agent channel 双向桥接 |
| 串口 | blocking pool I/O、`write_all`、精确字节写入、断开/拔线清理 session |
| 本地 PTY | 所有平台从用户主目录启动；PTY 初始化、shell 启动及控制 I/O 使用 blocking pool；EOF 后标记不存活 |
| 前端 | 移除冲突的系统级快捷键；垂直分屏改为 `Ctrl+Shift+\`；结构化 IPC 错误可读化 |

**验证状态**：Rust 44 项测试、格式、check、Clippy；前端 408 项测试、typecheck、production build；`git diff --check` 均通过。Windows/Linux、Pageant、Jump Host 和串口硬件场景仍需实机回归。

---

### Phase 6.11 - 发布就绪 + Team Server 安全加固 ✅ 本机自动门禁完成

> 2026-08-09 至 2026-08-10：建立统一发布门禁，清零生产源码超限文件，并完成 Team Server 认证、授权、输入验证、敏感同步、运行时与依赖安全收尾。

| 领域 | 完成内容 |
| --- | --- |
| 统一门禁 | 新增 `pnpm verify`，串行验证前端、Team Server、Rust 与源码行数；CI 覆盖 Linux Rust、三平台 Tauri、PostgreSQL 迁移和 Docker 构建 |
| 代码规模 | 拆分超限组件、视图、store、hook 和服务；447 个生产源码文件全部满足 `AGENTS.md` 限制 |
| Team Server 认证 | Token 仅存 SHA-256 摘要并兼容迁移旧记录；Token 管理路由受保护；重复注册返回冲突 |
| Team Server 授权 | 修复成员、共享、邀请、同步、冲突与离线队列的跨团队访问；敏感共享、冲突和队列保持明确安全状态，完成项清空 payload，终态失败不自动重试 |
| HTTP 安全 | 生产 CORS fail-closed、Helmet、全局及注册限流、Swagger 生产默认关闭、1MB body limit、DTO 与路径/查询验证 |
| 运行可靠性 | 数据库不可用时 health/readiness 返回 503；Compose 使用 readiness；启用 shutdown hooks；删除与审计 tombstone 在同一事务中提交；离线队列并发 claim 使用 token 租约并恢复陈旧任务 |
| 错误边界 | API Key 数据库故障保留 5xx；同步响应、离线队列和服务日志不返回或记录原始 Prisma 错误 |
| 供应链 | 锁定已修补的传递依赖；`pnpm audit --prod --audit-level high` 报告 0 个已知漏洞 |
| 远程存储 | 修正 S3 SigV4 scope、canonical URI/query、string-to-sign、列表 URL 与 UTF-8 编码；固定向量测试通过，真实 S3 仍待外部验证 |
| 高级脚本 | timeout 秒值正确转换并传递，`retry_count` 生效；interval/once/cron 非法配置 fail-closed，防重入并捕获异步异常 |
| Tauri 打包 | 注册 dialog/fs 插件，仅开放选定文本文件读写；CSP 允许用户配置的 HTTP(S) Team endpoint，并有静态配置测试 |

**本机验证环境**：macOS 15.7.7、Node.js 24.16.0、pnpm 10.34.3、Rust/Cargo 1.96.0。

**最终自动验证**：前端 31 个测试文件、408 项测试；Team Server 25 个测试文件、95 项测试；Rust 45 项测试；Prisma schema、lint、typecheck、前端 bundle 预算、Team Server build、Rust fmt/check/Clippy 和 447 个生产源码文件行数门禁全部通过。Bundle 初始 gzip 227.36 KB（预算 240 KB），总 gzip 510.09 KB（预算 550 KB），最大 JS chunk raw 390.87 KB（预算 500 KB）。

**后续验证边界**：2026-08-19 已补完成 Docker/PostgreSQL 容器、迁移、readiness、注册准入与关停恢复验收；macOS 本地 PTY 此后已由 Phase 6.17 的底层 round-trip 和 Tauri/xterm smoke 验证。Windows/Linux 本地 PTY、Pageant、真实 SSH/Jump Host 与串口硬件仍按 Issue #39/#46/#48 矩阵待实机执行；S3 仍只有固定向量测试。

---

### Phase 6.12 - v0.0.1-dev.0 多平台发布自动化 ✅ 已完成

> 2026-08-11：发现 GitHub Release `v0.0.1-dev.0` 没有资产，且 Windows Tauri CI 因 SSH 创建与 Agent 签名 Future 的 `Send` 生命周期约束失败；源码修复现已通过三平台 CI。

| 领域 | 改动 |
| --- | --- |
| Windows 编译 | 连接池异步 API 与 `SshSession::new_with_*` 改为拥有 `Arc`、`String` 和 `Option<String>`；Agent public key 与 identity 在 `await` 前转为拥有值，`OwnedIdentityAgentSigner` 隔离上游借用式签名 Future；新增 `Send + 'static` 编译期回归断言 |
| 发布矩阵 | 新增 `.github/workflows/release.yml`，使用六个原生 runner 覆盖 macOS/Windows/Linux 的 x64 与 ARM64 |
| 安装包 | macOS 生成 DMG，Windows 生成 NSIS，Linux 生成 AppImage 与 DEB；资产名固定包含版本、系统和架构 |
| 完整性 | 上传前逐项校验资产存在且非空，随后生成并上传 `SHA256SUMS.txt`；未配置 updater JSON、Apple notarization 或 Windows Authenticode |

**当前证据**：提交 `83cd4e8` 的 GitHub Actions CI `31409070480` 全绿，前端、Team Server、源码规模、Rust、Docker 镜像、PostgreSQL 迁移以及 macOS、Windows、Linux Tauri 原生编译全部通过。本机 Rust 为 45 项测试，包含五个 SSH command Future 的 `Send + 'static` 编译回归；YAML 解析与 `actionlint` 已通过。标签 `v0.0.1-dev.0` 指向 `6965f3a`，Release 工作流 `31431531040` 的六个原生打包任务和最终校验全部通过；8 个安装包与 `SHA256SUMS.txt` 均非空，GitHub 服务端 SHA-256 digest 与清单逐项一致。

**实机边界**：Windows/Linux 安装包构建成功不等于 OpenSSH Agent、Pageant、Jump Host、本地 PTY、快捷键或串口硬件实机通过；这些项目继续保留在 Issue #39。

---

### Phase 6.13 - 终端会话架构重构 ✅ 已完成

> 2026-08-12：参考 SideX 与 nyala-studio 的会话生命周期设计，完成终端数据流与工作台承载方式重构；视觉界面保持项目自绘。

| 领域 | 改动 |
| --- | --- |
| 会话生命周期 | 新增 `TerminalSessionManager`，按 `tabId` 持有本地、SSH、串口会话；React 路由切换只隐藏终端视图，不销毁 PTY/SSH 会话 |
| 事件流 | 新增 `TerminalSessionEvents`，按终端类型集中注册 Tauri data/close/exit 监听，并处理连接建立前的输出缓冲 |
| React 边界 | `useTerminal` 收口为 xterm surface 的输入、输出、resize 和状态绑定；启动、断开、重连由会话服务负责 |
| 工作台 UI | TerminalByUrl 常驻于主布局，支持多标签和分屏的隐藏/显示；新增自绘桌面工具栏、查找、清屏、字号、工具侧栏和全屏操作 |
| 命令投递 | `terminalEmitter` 按活动 `tabId` 定向写入，避免命令面板或 Snippet 把命令发送到错误标签 |
| 验证 | 新增会话管理器单测；前端测试、typecheck、lint、源码规模门禁通过；浏览器预览确认桌面/移动布局，浏览器环境缺少 Tauri IPC 的连接错误属于预期边界 |

---

### Phase 6.14 - v0.0.1-dev.1 开发版发布 ✅ 已完成

> 2026-08-12：终端会话架构重构完成后统一版本元数据，通过本机与远端门禁并发布新一版跨平台 prerelease。

| 领域 | 结果 |
| --- | --- |
| 版本 | 根包、Frontend、Team Server、Cargo 与 Tauri 配置统一为 `0.0.1-dev.1`；标签 `v0.0.1-dev.1` 指向提交 `412136d` |
| 本机门禁 | `pnpm verify` 全绿：前端 411、Team Server 95、Rust 45 项测试及 lint/typecheck/build/Clippy/源码规模门禁通过 |
| 远端 CI | Push CI `31553345929` 与 PR CI `31553348495` 全绿，包含三平台 Tauri 编译、Docker 镜像和 PostgreSQL 迁移 |
| 发布 | Release 工作流 `31554163901` attempt 2 全绿；macOS/Windows/Linux 双架构共 8 个安装包均非空 |
| 完整性 | `SHA256SUMS.txt` 为 862 bytes、包含 8 行；逐项匹配 GitHub 服务端 SHA-256 digest |

**Release**：`https://github.com/baicie/terminal/releases/tag/v0.0.1-dev.1`，状态为 prerelease、非草稿。macOS DMG 仍未公证，Windows NSIS 仍未 Authenticode 签名；跨平台构建成功不替代 Issue #39 的真实设备与硬件验证。

---

### Phase 6.15 - nyala-studio 终端工作台交互重构 ✅ 已完成

> 2026-08-17：参考本地 `nyala-studio` 的实例/分组/活动面板模型，重构终端工作台的前端状态与交互；沿用本项目 shadcn/ui、Lucide、语义色和主题系统，不迁移其 Workbench 框架或视觉代码。

| 领域 | 改动 |
| --- | --- |
| 活动会话 | `activeTabId` 统一控制活动 pane、焦点、标签选中态、URL `?tab=` 与命令投递；Snippet、History 和命令面板严格单播到当前标签 |
| 会话承载 | 无标签启动时不加载终端入口；首个标签出现后按需加载并保持常驻，非终端路由仅隐藏工作台；`/terminal` 的空 Outlet 层不可见且不可命中，标签/分屏切换不再因 React 视图显隐销毁 xterm 会话 |
| 分屏约束 | 每组最多两个 pane，串口标签禁止分屏；异常持久化布局自动归一化，关闭或移出分组后重新选择有效活动标签 |
| 分隔条 | 可见宽度 4px、交互命中区 20px；支持 Pointer、方向键、Home/End 和双击复位，比例限制在 20/80 并写回工作区布局 |
| 标签与面板头 | 标签改用 shadcn `ContextMenu`，支持重排、关闭、水平/垂直分屏及键盘导航；原状态条与工具栏合并为紧凑 pane header |
| 焦点与移动端 | 切换标签/点击 pane 后聚焦 xterm，活动 pane 具备 `aria-current` 与 ring；搜索、菜单和工具侧栏关闭后恢复焦点；移动端提供 44px 会话栏、底栏与安全区避让，全屏终端通过 portal 覆盖导航层并在路由/失活时退出 |
| 工作区切换 | 使用共享切换事务：保存当前布局、预载目标布局后再提交，失败时回滚；顶栏挂载工作区切换器 |

**验证边界**：前端 59 个测试文件、547 项测试通过，覆盖布局归一化、双分屏上限、标签/URL 同步、严格命令单播、焦点恢复、全屏往返节点连续性、活动 pane 语义状态、分隔条、移动会话栏/键盘、终端层按需加载/常驻及工作区切换/回滚；lint、typecheck、production build、源码行数与差异检查均通过。首屏/总 gzip 为 237.66/524.17 KB，满足 240/550 KB 预算。浏览器已检查 1440×900、1024×768、390×844、360×800 与 639/640px 断点，并覆盖深浅主题、底栏避让和全屏层级。本轮未修改 Rust、数据库 schema 或 Tauri capability；浏览器预览不能证明真实 SSH、本地 PTY、Windows/Linux、Pageant 或串口硬件交互，这些场景仍按 Issue #39 的实机矩阵执行。

---

### Phase 6.17 - 终端可靠性重建 🟡 macOS 本地核心链路完成，外部实机矩阵待验证

> 2026-08-19 至 2026-08-20：参考 MIT 项目 Nyaterm（固定提交 `70306b5c83e9f58c85a4f86a00440cd2be2cd57a`）的输出 ACK、高低水位、PTY pause/resume 和前后台排空思路，在本项目架构内重建终端数据链路；不复制其产品代码。

| 领域 | 当前结果 |
| --- | --- |
| 输入 | 恢复并精确固定 `@baicie/xterm@0.1.7`，由其 xterm 内部 `AppleWebKit` 分支处理 macOS WKWebView 重叠按键；删除前端伪历史/补全拦截，文本 `onData`、Tab、方向键、Ctrl、粘贴和 IME 原样进入单写者 FIFO；`onBinary` 原始字节复制为 `Uint8Array` 后进入同一 FIFO；不再叠加 DOM `input` fallback，避免与修复版 core 的 input handler 双发 |
| 尺寸与设置 | 创建前使用 `proposeDimensions()`，connecting 阶段缓存 latest-wins resize；`cursorStyle`、字体、scrollback、`allowProposedApi` 实时作用于当前 xterm core |
| 输出 | Rust 流式 UTF-8 解码、有界泵和 16ms/32 KiB 批处理；前端把单次 `xterm.write` 限制为 32 KiB，超大事件按 Unicode code point 边界拆分，单写入在途且 callback 后才 ACK；前台优先 RAF，受流控输出同时以 microtask 防止调度器 RAF/timer 双重暂停，fallback 中在 callback 内追加下一批并跨越短暂空队列，确保无字节计数尾批次仍可进入 xterm；Rust 以 1 MiB/128 KiB 水位暂停/恢复，并把 10 秒 watchdog 定义为“持续无 ACK 进展”而非总排空时长 |
| 生命周期 | 自然 EOF、主动关闭和重复重连幂等清理 session/meta/channel；本地 child 在初始化失败、EOF 和 close 路径统一 kill/wait/reap，关闭任务设 deadline；旧 generation 不得污染新标签；localhost OpenSSH smoke 会先终止独立 session 进程组再重启 daemon，确保测试触发真实 TCP 断线 |
| SSH | TCP、认证、Jump Host 隧道、channel/PTY/shell、exec、写入和 resize 共用阶段或绝对 deadline；writer 过期命令不再后台执行，fatal completion 会结束 reader、上报 `terminal-error` 并触发生命周期清理，自然 EOF 会先 close/join writer 再释放 transport；交互连接启用 TCP_NODELAY，连接池按 forwarding 权限隔离 |
| renderer/依赖 | 隐藏终端不持有 WebGL context，context loss 回退默认 renderer；运行时与 CSS 统一使用精确固定的 `@baicie/xterm@0.1.7`，保留 typings shim 与官方 `@xterm/addon-*`，依赖契约测试禁止直接安装上游 core |

**验证状态**：恢复修复版 core 并增加 manifest/分包契约后，历史 `pnpm verify` 全绿；本次增量前端 93 个测试文件/801 项、typecheck 通过，Rust 依赖收口后的 `cargo check --locked --all-targets --all-features` 与 `cargo test --locked --lib` 143 项通过。macOS `portable-pty` 自动化已验证默认回显、`read` Unicode、`stty size=31 97` 与退出回收。2026-08-24 普通 Tauri/xterm smoke 再次通过：8,388,608 字节、10 轮会话、97×31 resize、资源回收，耗时 5.4 秒。localhost OpenSSH 重连 smoke 通过：真实断开后建立不同 session，10 轮共 11 个唯一 session，旧 generation 输出被拒绝且资源回收，耗时 6.7 秒；脚本回归 23 项覆盖异常 PID/PGID fail-closed 与宽限期后的 `SIGKILL`。上述结果仍不能证明物理重叠按键或 IME；password/agent/cert/Jump、Windows/Linux/Pageant、串口、vim/nano、连续 resize、SGR mouse、bracketed paste 与非 UTF-8 原始输入仍按实机矩阵验收。

---

## 待办事项

### P0 - 必须完成

- [x] ~~实现 SSH 密钥认证后端 (使用 russh-keys)~~ ✅ 已完成
- [x] ~~实现 SFTP 后端功能 (使用 russh-sftp)~~ ✅ 已完成

### P1 - 应该完成

- [x] ~~实现端口转发后端~~ ✅ 已有 `port_forward_*` 与 `-L/-R/SOCKS` 等实现；复杂场景与边界见 `docs/issue.md` Issue #3「待完善」
- [x] ~~清理 Rust 编译警告~~ ✅ `cargo check` 0 警告（2026-05-02 Phase 6.2 / tracing + dead_code 精细化）
- [x] ~~ssh_resize 实际生效~~ ✅ `session_resize`：`LocalSession` 调 `pty.resize`；`SshSession` 发 RFC 4254 `window-change(cols, rows, 0, 0)`（`session/ssh.rs`）

### P2 - 建议完成

- [x] ~~**SSH Agent 作为认证方式连接主机**~~ ✅ 已实现（2026-05-03）：`session_create_ssh_agent` + `SessionService.createSshAgent`；`jump_host.target_auth_type === 'agent'` 正确路由到 `authenticate_with_agent`；Pageant 与实机回归见 Issue #21
- [x] ~~**SSH Agent forwarding 显式启用**~~ ✅ 独立 opt-in 设置、`channel.agent_forward(...)`、handler 授权与连接池模式隔离（2026-08-19）
- [x] ~~实现主机链功能~~ ✅ `session_create_ssh_jump` + `SshSession::new_with_jump`
- [x] ~~**Jump Host certificate**~~ ✅ 跳板端和目标端均复用 OpenSSH certificate 认证并验证证书/私钥输入（2026-08-19）
- [x] ~~命令快速补全~~ ✅ Tab 拦截 + 历史前缀匹配 + 路径补全 + shell 子命令补全（2026-05-03）
- [x] ~~Vault 加密存储~~ ✅ `vault_*` 命令集

### P3 - 未来考虑

- [x] ~~命令面板完善~~ ✅（与 Phase 3 一致；持续小优化不阻塞）
- [x] ~~多工作区~~ ✅
- [x] ~~**跨设备同步**~~ ✅ 存储服务配置 UI 完整（WebDAV/S3/REST）；`StorageManager` + `storage_*` 命令走真实后端；`importDataFromFile()` / `syncToServer()` / `downloadFromServer()` / `previewServerData()` 完整实现；团队视图存储连接配置 UI；S3 后端已接线（2026-05-02）；增量同步 + 离线队列 + 冲突检测（2026-05-03）

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
| 39  | 跨平台 SSH/串口/PTY 可靠性 | 🟡 Important | ✅ 代码已修复，待实机矩阵 (2026-08-09) |
| 42  | 发布终审的同步、存储、脚本与桌面配置问题 | 🟡 Important | ✅ 本机可验证问题已修复，外部项待验证 (2026-08-10) |
| 43  | 多平台 Release 资产缺失与 Windows Tauri 编译失败 | 🟡 Important | ✅ 已修复并发布 8 个安装包与校验清单 (2026-08-11) |
| 44  | 终端会话生命周期与 React 视图耦合 | 🟡 Important | ✅ 已重构为按 tabId 管理，跨平台交互仍需实机验证 (2026-08-12) |
| 45  | 终端工作台状态割裂、分屏失控与焦点丢失 | 🟡 Important | ✅ 前端交互已重构，真实连接仍待实机矩阵 (2026-08-17) |
| 48  | 终端输入失真、输出失控与生命周期泄漏 | 🔴 High | 🟡 核心链路与 macOS Tauri/xterm smoke 已通过，跨平台、协议与硬件矩阵待验收 (2026-08-20) |
| 55  | 重连 smoke 未断开独立 SSH session 进程组 | 🔴 High | ✅ 已修复并通过真实 localhost OpenSSH 重连 (2026-08-24) |

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
  certificate TEXT,
  group_id TEXT,
  is_favorite INTEGER DEFAULT 0,
  color TEXT,
  tags TEXT,
  port_forwards TEXT,
  startup_command TEXT,
  environment TEXT,
  jump_host_id TEXT,
  jump_host_auth_type TEXT,
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
| 框架     | NestJS 11.x     |
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
docker compose up -d

# 本地开发
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm exec prisma migrate dev
pnpm start:dev
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

以下前缀均位于 `/api/v1` 下，例如注册接口为
`POST /api/v1/auth/register`。

| 模块 | 前缀                 | 方法   | 端点        | 说明             |
| ---- | -------------------- | ------ | ----------- | ---------------- |
| 认证 | /auth                | POST   | /register   | 按 closed/token/open 策略注册用户 |
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

_文档更新时间: 2026-08-24 (Phase 6.19：真实 SSH 重连 smoke 收口，物理输入与外部矩阵待验证)_
