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

## 项目结构

```
terminal/
├── src/                          # 前端源代码
│   ├── view/                     # 页面组件
│   │   ├── terminal/             # 终端视图
│   │   ├── sftp/                # SFTP 视图
│   │   └── vaults/              # 保险库/连接视图
│   ├── layout/                  # 布局组件
│   ├── hooks/                   # 自定义 React hooks
│   ├── store/                   # MobX 状态存储
│   ├── service/                 # API 服务
│   ├── utils/                   # 工具函数 (logger, axios)
│   ├── locales/                 # 国际化翻译
│   │   ├── en/
│   │   ├── fr/
│   │   └── cn/
│   ├── router/                  # React Router 配置
│   ├── di.ts                    # 依赖注入容器配置
│   └── App.tsx                  # 根组件
├── src-tauri/                   # Rust 后端
│   ├── src/
│   │   ├── lib.rs               # 库入口
│   │   ├── main.rs              # 二进制入口
│   │   └── terminal.rs          # SSH 终端逻辑
│   ├── Cargo.toml               # Rust 依赖
│   ├── tauri.conf.json          # Tauri 配置
│   └── capabilities/             # Tauri 权限配置
└── package.json                 # Node 依赖
```

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

---

## 当前已知问题

1. **russh API 兼容性**: `src-tauri/src/terminal.rs` 中的 SSH 代码使用了较旧版本的 russh API。需要更新代码以兼容 russh 0.57.1。

---

## 有用链接

- [Tauri 2.x 文档](https://tauri.app/)
- [React 19 文档](https://react.dev/)
- [Ant Design](https://ant.design/)
- [xterm.js](https://xtermjs.org/)
- [russh](https://github.com/warpdotdev/russh)
