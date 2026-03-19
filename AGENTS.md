# Terminal Project - Agent 指南

## 项目概述

这是一个基于 **Tauri 的终端应用程序**，提供 SSH/SFTP 连接功能，带有现代化的 UI。它结合了 React 前端和 Rust 后端。

### 技术栈

| 层级       | 技术                      |
| ---------- | ------------------------- |
| 前端框架   | React 19 + TypeScript     |
| 构建工具   | Vite 8.x                  |
| **UI 库**  | **shadcn/ui + Tailwind**  |
| 终端模拟器 | xterm.js                  |
| 状态管理   | MobX                      |
| 依赖注入   | tsyringe                  |
| 样式       | Tailwind CSS + Sass       |
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

| 文档                         | 用途                               | 何时查阅           |
| ---------------------------- | ---------------------------------- | ------------------ |
| **docs/project.md**          | 完整项目结构、实现状态、数据库结构 | 每次开发前必读     |
| **docs/issue.md**            | 所有已知问题、BUG、待修复项        | 解决问题时查阅     |
| **docs/design.md**           | 产品设计、功能规划、优先级         | 新功能设计时查阅   |
| **docs/todo.md**             | 开发待办事项清单                   | 规划开发任务时查阅 |
| **docs/ui/**                 | UI/功能规格与界面描述（便于 AI 阅读）| 实现或还原 UI 时  |
| **docs/shadcn-components.md** | shadcn/ui 全部组件索引与用法说明    | 查阅组件选型与用法 |
| **AGENTS.md**                | 本文件 - Agent 使用指南             | 初次接手项目时阅读 |

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
    ├── todo.md                   # 待办事项
    ├── shadcn-components.md      # shadcn/ui 全部组件索引
    └── ui/                       # UI/功能规格（便于 AI 阅读实现 UI）
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

### UI 组件规范 (shadcn/ui)

> **强制要求**: 所有 UI 组件必须使用 shadcn/ui，禁止使用 Ant Design 或其他 UI 库。

#### 使用流程

1. **添加组件**: 使用 `pnpm dlx shadcn@latest add <component>` 添加组件
2. **复用现有**: 优先使用 shadcn/ui 已安装组件，而非自定义实现
3. **组件组合**: 使用 shadcn/ui 组件组合构建复杂 UI
4. **查阅文档**: 详细用法见 `docs/shadcn-components.md`，或执行 `pnpm dlx shadcn@latest docs <component>` 查看组件文档

#### 组件选择参考

| 需求       | 使用组件                                            |
| ---------- | --------------------------------------------------- |
| 按钮       | `Button`                                            |
| 表单输入   | `Input`, `Select`, `Switch`, `Checkbox`, `Textarea` |
| 数据展示   | `Table`, `Card`, `Badge`, `Avatar`                  |
| 导航       | `Tabs`, `Breadcrumb`, `Pagination`                  |
| 模态框     | `Dialog`                                            |
| 侧边栏面板 | `Sheet`                                             |
| 确认对话框 | `AlertDialog`                                       |
| 消息提示   | `sonner` (toast)                                    |
| 加载占位   | `Skeleton`                                          |
| 分割线     | `Separator`                                         |

#### 组件优先级规范（强制）

> **禁止使用原生 HTML 表单元素**，所有 UI 必须使用 shadcn/ui 组件。

**正确示例：**

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

<Select value={form.type} onValueChange={(v) => setForm({ type: v })}>
  <Label htmlFor="type">Type</Label>
  <SelectTrigger id="type">
    <SelectValue placeholder="Select type" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="a">Option A</SelectItem>
    <SelectItem value="b">Option B</SelectItem>
  </SelectContent>
</Select>
```

**错误示例（严格禁止）：**

```tsx
// ❌ 禁止：原生 <select>
<select value={form.type} onChange={(e) => setForm({ type: e.target.value })}>
  <option value="a">Option A</option>
  <option value="b">Option B</option>
</select>

// ❌ 禁止：原生 <input type="checkbox/radio">
<input type="checkbox" checked={form.enabled} onChange={(e) => ...} />

// ❌ 禁止：原生 <textarea>
<textarea value={form.content} onChange={(e) => ...} />
```

**表单控件对应关系：**

| 需求           | 使用组件                         |
| -------------- | -------------------------------- |
| 下拉选择       | `Select`                         |
| 多行文本输入   | `Textarea`                       |
| 布尔开关       | `Switch`（设置类）或 `Checkbox`（表单） |
| 单选/多选列表  | `RadioGroup` / `Checkbox`        |
| 搜索式下拉     | `Command` + `Combobox` 模式      |

**其他禁止项：**

| 需求         | 错误写法                     | 正确写法              |
| ------------ | ---------------------------- | --------------------- |
| 标签         | `<label>` 原生标签           | `Label` 组件          |
| 输入框按钮组 | 原生 `div` + `position: absolute` | `InputGroup` 组件     |
| 分割线       | `<hr>` 或 `border-t` div     | `Separator` 组件      |

#### 样式规范

- 使用 `className` 进行布局，**禁止覆盖组件颜色**
- 使用语义化颜色：`bg-primary`, `text-muted-foreground` 等
- 使用 `cn()` 处理条件类名
- 使用 `gap-*` 替代 `space-y-*` / `space-x-*`
- 尺寸相同时使用 `size-*` 而非 `w-* h-*`

#### 图标规范

- 项目使用 `lucide-react` 图标库
- 图标置于 Button 内时使用 `data-icon="inline-start"` / `data-icon="inline-end"`
- 图标作为独立元素时不设置尺寸类，组件会自动处理

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

5. **样式**: 使用 Tailwind CSS 工具类，配合 shadcn/ui 组件使用

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
- [shadcn/ui 文档](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [xterm.js](https://xtermjs.org/)
- [russh](https://github.com/warpdotdev/russh)
- [russh-keys](https://docs.rs/russh-keys/)
- [russh-sftp](https://docs.rs/russh-sftp/)

---

_文档更新时间: 2026-03-19_

---

## UI 实现参考

开发或还原界面时，**功能与 UI 描述以 `docs/ui/` 目录为准**：

| 文档                       | 内容                                    |
| -------------------------- | --------------------------------------- |
| `docs/ui/00-design-system.md` | 主题、颜色、字体、图标、间距、交互状态 |
| `docs/ui/01-layout-and-navigation.md` | 顶栏、侧栏导航、主内容区、工具栏布局 |
| `docs/ui/02-views.md`     | Hosts、Terminal、SFTP、Logs、Port Forwarding、Known Hosts、Keychain、Snippets 的功能与 UI 说明 |

- 每个视图章节按「功能概述 → UI 组成 → 交互」结构描述，便于直接对照实现。
- 关键词统一（侧栏项、按钮、占位符文案），便于 AI 检索与理解。
- `02-views.md` 末尾有视图与前端路由/组件的对照表。

---

## shadcn/ui Skill

项目已配置 shadcn/ui skill，位于 `.agents/skills/shadcn/`。详细规范请参考该 skill 文件。常用命令：

```bash
# 添加组件
npx shadcn@latest add button card dialog

# 查看组件文档
npx shadcn@latest docs button dialog select

# 搜索组件
npx shadcn@latest search @shadcn -q "sidebar"
```
