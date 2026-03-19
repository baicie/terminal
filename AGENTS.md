# Terminal Project - Agent 指南

## 项目概述

这是一个基于 **Tauri 的终端应用程序**，提供 SSH/SFTP 连接功能，带有现代化的 UI。它结合了 React 前端和 Rust 后端。

### 技术栈

| 层级       | 技术                      |
| ---------- | ------------------------- |
| 前端框架   | React 19 + TypeScript     |
| 构建工具   | Vite 8.x                  |
| UI 库      | Ant Design 6.x            |
| 终端模拟器 | xterm.js                  |
| 状态管理   | MobX                      |
| 依赖注入   | tsyringe                  |
| 样式       | UnoCSS + Sass             |
| 国际化     | i18next (en, fr, cn)      |
| 后端       | Tauri 2.x (Rust)          |
| SSH/SFTP   | russh                     |
| 数据库     | SQLite (tauri-plugin-sql) |

---

## AI助手使用规范

### 语言要求

- **所有回复都使用中文**：在与用户交互时，始终使用中文进行回复和说明

## 项目文档索引

> **重要**: 开始任何开发工作前，请先查阅相关文档

| 文档                | 用途                               | 何时查阅           |
| ------------------- | ---------------------------------- | ------------------ |
| **docs/project.md** | 完整项目结构、实现状态、数据库结构 | 每次开发前必读     |
| **docs/issue.md**   | 所有已知问题、BUG、待修复项        | 解决问题时查阅     |
| **docs/design.md**  | 产品设计、功能规划、优先级         | 新功能设计时查阅   |
| **docs/todo.md**    | 开发待办事项清单                   | 规划开发任务时查阅 |
| **AGENTS.md**       | 本文件 - Agent 使用指南            | 初次接手项目时阅读 |

---

## 项目结构概览

```
terminal/
├── src/                          # 前端源代码 (React + TypeScript)
├── src-tauri/                    # 后端源代码 (Rust)
└── docs/                         # 项目文档
    ├── project.md                # 项目文档索引 (你在这里)
    ├── issue.md                  # 问题追踪
    ├── design.md                 # 设计文档
    └── todo.md                   # 待办事项
```

### 前端 `src/` 结构

```
src/
├── view/                         # 页面组件
│   ├── terminal/                 # 终端视图
│   ├── sftp/                    # SFTP 视图
│   ├── vaults/                   # 保险库视图
│   └── home/                     # 首页
├── components/                    # 可复用组件
│   ├── ui/                       # 基础 UI 组件
│   ├── host-list/                # 主机列表
│   ├── command-history/          # 命令历史
│   ├── snippet-manager/          # Snippet 管理
│   ├── port-forward/             # 端口转发
│   ├── split-pane/              # 分屏组件
│   └── settings-dialog/           # 设置对话框
├── store/                        # MobX 状态管理
├── service/                      # 业务服务 (SSH, 数据库等)
├── hooks/                        # 自定义 React Hooks
├── utils/                        # 工具函数
├── locales/                      # 国际化 (en/fr/cn)
├── router/                       # React Router
└── layout/                       # 布局组件
```

### 后端 `src-tauri/` 结构

```
src-tauri/
├── src/
│   ├── main.rs                   # 二进制入口
│   ├── lib.rs                    # 库入口 (命令注册)
│   └── terminal.rs               # SSH/SFTP/PTY 核心逻辑
├── Cargo.toml                     # Rust 依赖
├── tauri.conf.json               # Tauri 配置
└── capabilities/                  # 权限配置
```

---

## Agent 工作规范

### 文档更新规则

完成任何开发工作后，**必须**按以下规则更新相关文档：

#### 1. 完成新功能时

1. 更新 `docs/project.md` 中的"实现状态"部分
2. 如果有遗留问题，创建或更新 `docs/issue.md` 条目
3. 检查 `docs/todo.md` 中对应项是否完成

#### 2. 修复 BUG 时

1. 在 `docs/issue.md` 中标记问题为"已修复"
2. 记录修复方案和日期

#### 3. 添加新待办事项时

1. 在 `docs/todo.md` 中添加新条目
2. 在 `docs/issue.md` 中创建详细说明（如果需要）

### 文档标记说明

| 标记 | 含义            | 示例                                 |
| ---- | --------------- | ------------------------------------ |
| ✅   | 已完成          | SSH 连接 ✅ 已实现                   |
| ⚠️   | 部分实现        | SSH 密钥认证 ⚠️ 前端完成，后端未实现 |
| 🔴   | 未实现/严重问题 | SFTP 后端 🔴 未实现                  |
| 📋   | 待开发/计划中   | Agent 转发 📋 待开发                 |
| 🔄   | 进行中          | 正在修复...                          |
| ❌   | 已废弃/不可用   | ❌ 不推荐使用                        |

### 状态徽章

| 徽章 | 含义             |
| ---- | ---------------- |
| ✅   | 功能已完成       |
| 🟡   | 部分完成或警告   |
| 🔴   | 严重问题或未实现 |
| 📋   | 待开发           |

---

## 关键约定

### 前端 (React/TypeScript)

1. **路径别名**: 使用 `@/` 作为从 `src/` 目录导入的前缀

   ```typescript
   import { useTerminal } from "@/hooks/use-terminal";
   import { AppStore } from "@/store/app";
   ```

2. **依赖注入**: 使用 tsyringe 进行依赖注入

   ```typescript
   @injectable()
   class MyService {
     // ...
   }
   ```

3. **状态管理**: 使用 MobX 进行响应式状态管理

   ```typescript
   class AppStore {
     @observable count = 0;
     @action increment() {
       this.count++;
     }
   }
   ```

4. **国际化**: 使用 `react-i18next` 进行国际化

   ```typescript
   const { t } = useTranslation();
   return <div>{t('common.save')}</div>;
   ```

5. **样式**: 推荐使用 UnoCSS 工具类，复杂样式使用 Sass

### 后端 (Rust)

1. **Tauri 命令**: 使用 `#[tauri::command]` 将 Rust 函数暴露给前端

2. **异步**: 使用 `tokio` 进行异步运行时

3. **错误处理**: 使用 `anyhow` 进行错误处理

---

## 常见任务

### 运行应用程序

```bash
# 仅运行前端
pnpm dev

# 运行完整的 Tauri 应用
pnpm tauri dev

# 构建生产版本
pnpm tauri build
```

### 添加新依赖

**前端 (npm):**

```bash
pnpm add <package-name>
```

**后端 (Rust):**
编辑 `src-tauri/Cargo.toml` 并运行 `cargo update`

### 数据库

应用程序使用 SQLite（通过 `tauri-plugin-sql`）。数据库操作从前端使用 SQL 插件 API 完成。

详细表结构请参考 `docs/project.md` 中的"数据库表结构"部分。

---

## 实现状态总览

### Phase 1 - MVP ✅ 已完成

- ✅ SSH 连接 (密码认证)
- ✅ 终端模拟 (xterm.js)
- ✅ 多标签页
- ✅ 主机保存/组管理/收藏夹
- ✅ 本地终端

### Phase 2 - 核心功能 ⚠️ 部分完成

- ⚠️ SSH 密钥认证 (前端完成，后端未实现)
- 🔴 SFTP 文件传输 (后端全占位符)
- ⚠️ 端口转发 (UI 完成，后端未实现)
- ✅ 命令历史、Snippet、分屏模式

### Phase 3/4 - 高级功能 🔴 未实现

- 🔴 Agent 转发、主机链、Vault 加密
- 🔴 多工作区、跨设备同步
- 🔴 串口连接、团队协作等

---

## 当前关键问题

> 详细问题列表请查看 `docs/issue.md`

| #   | 问题                   | 严重程度     | 优先级 |
| --- | ---------------------- | ------------ | ------ |
| 1   | SFTP 后端未实现        | 🔴 Critical  | P0     |
| 2   | SSH 密钥认证后端未实现 | 🔴 Critical  | P0     |
| 3   | 端口转发后端未实现     | 🔴 Critical  | P1     |
| 4   | Rust 编译警告需清理    | 🟡 Important | P1     |
| 5   | Agent 认证未实现       | 🟡 Important | P2     |

---

## 有用链接

- [Tauri 2.x 文档](https://tauri.app/)
- [React 19 文档](https://react.dev/)
- [Ant Design](https://ant.design/)
- [xterm.js](https://xtermjs.org/)
- [russh](https://github.com/warpdotdev/russh)
- [russh-keys](https://docs.rs/russh-keys/)
- [russh-sftp](https://docs.rs/russh-sftp/)

---

_文档更新时间: 2026-03-19_
