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

| 命令 | 功能 | 状态 |
|------|------|------|
| `ssh_connect` | SSH 密码连接 | ✅ 已实现 |
| `ssh_connect_key` | SSH 密钥连接 | ✅ 已实现 (2026-03-19) |
| `ssh_connect_agent` | SSH Agent 连接 | 🔴 返回未实现 |
| `ssh_shell` | 打开交互式 shell | ✅ 已实现 |
| `ssh_write` | 写入数据 | ✅ 已实现 |
| `ssh_resize` | 调整终端大小 | ⚠️ 空实现 |
| `ssh_disconnect` | 断开连接 | ✅ 已实现 |
| `ssh_execute` | 执行单条命令 | ✅ 已实现 |
| `local_shell` | 本地终端 | ✅ 已实现 |
| `local_write` | 本地终端写入 | ✅ 已实现 |
| `local_resize` | 本地终端调整大小 | ✅ 已实现 |
| `local_disconnect` | 本地终端断开 | ✅ 已实现 |
| `sftp_connect` | 初始化 SFTP 会话 | ✅ 新增 (2026-03-19) |
| `sftp_list` | SFTP 列出目录 | ✅ 已实现 |
| `sftp_upload` | SFTP 上传 | ✅ 已实现 |
| `sftp_download` | SFTP 下载 | ✅ 已实现 |
| `sftp_mkdir` | SFTP 创建目录 | ✅ 已实现 |
| `sftp_delete` | SFTP 删除 | ✅ 已实现 |
| `sftp_rename` | SFTP 重命名 | ✅ 已实现 |
| `port_forward_start` | 启动端口转发 | ✅ 新增 (2026-03-19) |
| `port_forward_stop` | 停止端口转发 | ✅ 新增 (2026-03-19) |
| `port_forward_list` | 列出活动转发 | ✅ 新增 (2026-03-19) |
| `serial_list` | 列出可用串口 | ✅ 新增 (2026-03-20) |
| `serial_baud_rates` | 获取常用波特率 | ✅ 新增 (2026-03-20) |
| `serial_connect` | 连接串口 | ✅ 新增 (2026-03-20) |
| `serial_write` | 写入串口 | ✅ 新增 (2026-03-20) |
| `serial_write_raw` | 原始写入串口 | ✅ 新增 (2026-03-20) |
| `serial_is_connected` | 检查串口连接状态 | ✅ 新增 (2026-03-20) |
| `serial_disconnect` | 断开串口 | ✅ 新增 (2026-03-20) |

---

## 实现状态

### Phase 1 - MVP ✅ 已完成

| 功能 | 前端 | 后端 | 说明 |
|------|------|------|------|
| SSH 密码连接 | ✅ | ✅ | russh 实现 |
| SSH 密钥认证 | ✅ | ✅ | russh-keys 实现 (2026-03-19) |
| 终端模拟 (xterm.js) | ✅ | ✅ | FitAddon, SearchAddon, WebLinksAddon |
| 多标签页 | ✅ | - | AppStore 管理 |
| 主机保存 (SQLite) | ✅ | ✅ | hosts 表 |
| 组管理 | ✅ | ✅ | 支持嵌套组 |
| 收藏夹 | ✅ | ✅ | isFavorite 字段 |
| 本地终端 | ✅ | ✅ | portable-pty |

### Phase 2 - 核心功能 ✅ 已完成

| 功能 | 前端 | 后端 | 说明 |
|------|------|------|------|
| SFTP 文件传输 | ✅ | ✅ | russh-sftp 实现 (2026-03-19) |
| 端口转发 | ✅ | ⚠️ | UI 完成，后端基础实现 (2026-03-19) |
| ssh_resize | ✅ | ✅ | 使用 escape sequence 实现 (2026-03-19) |
| 命令历史 | ✅ | ✅ | SQLite 存储 |
| Snippet | ✅ | ✅ | 完整实现 |
| 分屏模式 | ✅ | ✅ | 水平/垂直分屏 |

### Phase 3 - 高级功能 ✅ 已完成

> 2026-03-19 完成 Phase 3 所有高级功能

| 功能 | 状态 |
|------|------|
| Agent 转发 | ✅ 已实现 (2026-03-19) |
| 主机链 (Jump Host) | ✅ 已实现 (2026-03-19) |
| Vault 加密存储 | ✅ 已实现 (2026-03-19) |
| 命令面板 | ✅ 已实现 (2026-03-19) |
| 多工作区 | ✅ 已实现 (2026-03-19) |
| 跨设备同步 | ✅ 已实现 (2026-03-19) |

### Phase 4 - 企业功能 ⚠️ 部分完成

> 2026-03-24 完成 Phase 4 部分功能

| 功能 | 状态 |
|------|------|
| 团队协作 | 📋 待开发 |
| SSH 证书认证 | 📋 待开发 |
| 串口连接 | ✅ 已实现 (2026-03-20) |
| SSH 密钥生成 | ✅ 已实现 (2026-03-24) |
| 高级脚本 | 📋 待开发 |
| 终端工具侧栏 (Snippets + 历史) | ✅ 已实现 (2026-03-24) |
| xterm.js ClipboardAddon | ✅ 已实现 (2026-03-24) |
| 主机环境变量编辑 | ✅ 已实现 (2026-03-24) |
| SFTP Kind 列 + 权限显示 | ✅ 已实现 (2026-03-24) |

---

## 待办事项

### P0 - 必须完成

- [x] ~~实现 SSH 密钥认证后端 (使用 russh-keys)~~ ✅ 已完成
- [x] ~~实现 SFTP 后端功能 (使用 russh-sftp)~~ ✅ 已完成

### P1 - 应该完成

- [ ] 实现端口转发后端
- [ ] 清理 Rust 编译警告
- [ ] ssh_resize 实际生效

### P2 - 建议完成

- [ ] 实现 Agent 认证
- [ ] 实现主机链功能
- [ ] 命令快速补全
- [ ] Vault 加密存储

### P3 - 未来考虑

- [ ] 命令面板完善
- [ ] 多工作区
- [ ] 跨设备同步

---

## 问题追踪

详细问题列表请查看 [docs/issue.md](docs/issue.md)。

### 关键问题

| # | 问题 | 严重程度 | 状态 |
|---|------|---------|------|
| 1 | SFTP 后端未实现 | 🔴 Critical | ✅ 已实现 (2026-03-19) |
| 2 | SSH 密钥认证后端未实现 | 🔴 Critical | ✅ 已实现 (2026-03-19) |
| 3 | 端口转发后端未实现 | 🔴 Critical | 🔴 未实现 |
| 4 | Rust 编译警告需清理 | 🟡 Important | ⚠️ 需清理 |
| 5 | Agent 认证未实现 | 🟡 Important | 🔴 未实现 |

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
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER
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

---

*文档更新时间: 2026-03-24*
