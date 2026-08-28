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
| 状态管理   | Zustand                   |
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

| 文档                           | 用途                                  | 何时查阅           |
| ------------------------------ | ------------------------------------- | ------------------ |
| **docs/project.md**            | 完整项目结构、实现状态、数据库结构    | 每次开发前必读     |
| **docs/issue.md**              | 所有已知问题、BUG、待修复项           | 解决问题时查阅     |
| **docs/design.md**             | 产品设计、功能规划、优先级            | 新功能设计时查阅   |
| **docs/todo.md**               | 开发待办事项清单                      | 规划开发任务时查阅 |
| **docs/xterm.md**              | xterm.js 完整 API 文档与插件指南      | 终端开发时必读     |
| **docs/ui/**                   | UI/功能规格与界面描述（便于 AI 阅读） | 实现或还原 UI 时   |
| **docs/shadcn-components.md**  | shadcn/ui 全部组件索引与用法说明      | 查阅组件选型与用法 |
| **docs/build-optimization.md** | 构建体积分析与优化指南                | 优化打包时查阅     |
| **AGENTS.md**                  | 本文件 - Agent 使用指南               | 初次接手项目时阅读 |

---

## 项目结构概览

```
terminal/
├── packages/
│   ├── frontend/                 # React + TypeScript 前端
│   └── team-server/              # NestJS + Prisma 团队服务端
├── src-tauri/                    # 后端源代码 (Rust)
├── scripts/                      # 发布门禁脚本
└── docs/                         # 项目文档
    ├── project.md                 # 项目文档索引 (你在这里)
    ├── issue.md                   # 问题追踪
    ├── design.md                  # 设计文档
    ├── todo.md                    # 待办事项
    ├── build-optimization.md       # 构建优化指南
    ├── shadcn-components.md        # shadcn/ui 全部组件索引
    └── ui/                        # UI/功能规格（便于 AI 阅读实现 UI）
```

### 前端 `packages/frontend/src/` 结构

```
src/
├── view/                         # 页面组件
│   ├── hosts/                   # 主机列表视图
│   ├── sftp/                    # SFTP 视图
│   ├── vaults/                  # 保险库视图
│   ├── keychain/                # 密钥管理视图
│   ├── port-forward/            # 端口转发视图
│   ├── snippets/                # 代码片段视图
│   ├── known-hosts/             # 已知主机视图
│   ├── app-logs/                # 日志视图
│   ├── settings/                # 设置视图
│   └── teams/                   # 团队视图
├── features/terminal/           # xterm、终端容器、会话服务与类型
├── components/                    # 可复用组件
│   ├── ui/                       # 基础 UI 组件
│   ├── app-sidebar/              # 左侧导航栏
│   ├── top-toolbar/              # 顶部工具栏
│   ├── view-container/           # 视图容器组件
│   ├── host-list/                # 主机列表
│   ├── command-history/          # 命令历史
│   ├── snippet-manager/          # Snippet 管理
│   ├── port-forward/             # 端口转发
│   ├── split-pane/              # 分屏组件
│   ├── workspace-switcher/       # 工作区切换器
│   └── settings-dialog/           # 设置对话框
├── store/                        # Zustand 状态管理
├── service/                      # 业务服务 (SSH, 数据库等)
├── hooks/                        # 自定义 React Hooks
├── utils/                        # 工具函数
├── locales/                      # 国际化 (en/fr/cn)
├── router/                       # React Router 路由配置
└── layout/                       # 布局组件 (主布局、标签页等)
```

### 后端 `src-tauri/` 结构

```
src-tauri/
├── src/
│   ├── main.rs                   # 二进制入口
│   ├── lib.rs                    # 库入口 (命令注册)
│   ├── commands.rs               # Tauri 会话命令
│   ├── session/                  # SSH / 本地 PTY / 会话管理
│   ├── sftp.rs                   # SFTP
│   ├── serial.rs                 # 串口
│   └── port_forward.rs           # 端口转发
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
;<Select value={form.type} onValueChange={v => setForm({ type: v })}>
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

| 需求          | 使用组件                                |
| ------------- | --------------------------------------- |
| 下拉选择      | `Select`                                |
| 多行文本输入  | `Textarea`                              |
| 布尔开关      | `Switch`（设置类）或 `Checkbox`（表单） |
| 单选/多选列表 | `RadioGroup` / `Checkbox`               |
| 搜索式下拉    | `Command` + `Combobox` 模式             |

**其他禁止项：**

| 需求         | 错误写法                          | 正确写法          |
| ------------ | --------------------------------- | ----------------- |
| 标签         | `<label>` 原生标签                | `Label` 组件      |
| 输入框按钮组 | 原生 `div` + `position: absolute` | `InputGroup` 组件 |
| 分割线       | `<hr>` 或 `border-t` div          | `Separator` 组件  |

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
   import { useTerminal } from '@/hooks/use-terminal'
   import { AppStore } from '@/store/app'
   ```

2. **状态管理**: 使用 Zustand store，按 selector 订阅所需状态

   ```typescript
   const count = useAppStore(state => state.count)
   const increment = useAppStore(state => state.increment)
   ```

3. **国际化**: 使用 `react-i18next` 进行国际化

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

## 跨平台兼容性规范

> ⚠️ **重要**: 本项目需要同时支持 macOS、Windows 和 Linux。开发任何新功能时，**必须**考虑跨平台兼容性。

### 平台检测

项目已在 `vite.config.ts` 中定义了平台检测常量：

```typescript
// 在前端代码中使用
IS_MACOS // macOS
IS_WINDOWS // Windows
IS_LINUX // Linux

// 示例
if (IS_MACOS) {
  // macOS 特定代码
} else if (IS_WINDOWS) {
  // Windows 特定代码
}
```

### Rust 后端跨平台

#### 1. Unix 特定代码必须使用条件编译

```rust
#[cfg(unix)]
{
    // Unix 特定代码 (macOS, Linux)
    use std::os::unix::net::UnixStream;
}

#[cfg(windows)]
{
    // Windows 特定代码
    use std::os::windows::net::TcpStream;
}
```

#### 2. 常见平台差异处理

| 功能             | macOS/Linux                      | Windows                    |
| ---------------- | -------------------------------- | -------------------------- |
| SSH Agent Socket | `SSH_AUTH_SOCK` Unix socket | OpenSSH named pipe，失败后回退 Pageant |
| 串口设备路径     | `/dev/tty.*`                     | `COM1`, `COM2`, ...        |
| 环境变量分隔符   | `:`                              | `;`                        |
| 路径分隔符       | `/`                              | `\`                        |
| 行尾符           | `\n`                             | `\r\n`                     |

#### 3. SSH Agent 当前实现

- Unix：通过 `AgentClient::connect_env()` 连接 `SSH_AUTH_SOCK`。
- Windows：优先连接 OpenSSH Agent named pipe，再通过 `AgentClient::connect_pageant()` 回退到 Pageant。
- 以上代码路径已实现；Windows OpenSSH Agent 与 Pageant 仍必须按 `docs/release-readiness.md` 做实机验证。

#### 4. 串口当前实现

- 使用 `serialport` crate 统一枚举 macOS、Windows 和 Linux 设备，不手工扫描 `/dev` 或注册表。
- 枚举、打开、读取和写入均避免阻塞 Tokio worker；写入使用 `write_all`，拔线或 EOF 会清理 session。
- 设备命名、流控、精确写入和运行中拔线仍必须使用真实硬件验证。

### 前端跨平台

#### 1. 平台检测钩子

```typescript
// src/hooks/use-platform.ts
import { useMemo } from 'react'

export function usePlatform() {
  return useMemo(() => {
    const userAgent = navigator.userAgent.toLowerCase()
    const isMac = userAgent.includes('mac')
    const isWindows = userAgent.includes('win')
    const isLinux =
      userAgent.includes('linux') && !userAgent.includes('android')

    return {
      isMac,
      isWindows,
      isLinux,
      isDesktop: isMac || isWindows || isLinux,
    }
  }, [])
}
```

#### 2. 快捷键差异

```typescript
// macOS 使用 Cmd (⌘)，其他平台使用 Ctrl
const shortcut = isMac ? '⌘K' : 'Ctrl+K'

// 修饰键映射
const modKey = isMac ? 'metaKey' : 'ctrlKey'
```

#### 3. 系统路径差异

```typescript
// Windows 路径格式化
function normalizePath(path: string): string {
  if (isWindows) {
    return path.replace(/\//g, '\\')
  }
  return path
}

// 获取用户目录
async function getHomeDirectory(): Promise<string> {
  // 使用 Tauri 的 path API
  const { homeDir } = await import('@tauri-apps/plugin-os')
  return homeDir()
}
```

### Tauri 跨平台配置

#### 1. Cargo.toml 特性

```toml
[dependencies]
portable-pty = "0.9"
serialport = "4.9"
```

#### 2. tauri.conf.json 配置

```json
{
  "bundle": {
    "active": true,
    "targets": "all",
    "windows": {
      "webviewInstallMode": {
        "type": "embedBootstrapper"
      }
    }
  }
}
```

### 跨平台检查清单

> 开发任何新功能时，请检查以下事项：

- [ ] **Rust 后端**: 是否使用了 `#[cfg(unix)]` / `#[cfg(windows)]` 条件编译？
- [ ] **路径处理**: 是否正确处理了不同平台的路径分隔符？
- [ ] **环境变量**: 是否正确处理了不同平台的环境变量格式？
- [ ] **串口设备**: 是否处理了 macOS (`/dev/tty.*`) 和 Windows (`COM*`) 的差异？
- [ ] **快捷键**: 是否处理了 macOS (⌘) 和 Windows/Linux (Ctrl) 的差异？
- [ ] **UI 显示**: 是否有平台特定的 UI 元素需要调整？

### 已知的跨平台问题

> 在 `docs/issue.md` 中记录已发现的跨平台问题

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

### Phase 2 - 核心功能 ✅ 已完成

- ✅ SSH 密钥认证（前后端完整接线）
- ✅ SFTP 文件传输（上传、下载及文件操作）
- ✅ 端口转发基础实现（Local / Remote / SOCKS）
- ✅ 命令历史、Snippet、分屏模式

### Phase 3/4 - 高级与企业功能 ✅ 代码完成，外部实机待验证

- ✅ SSH Agent 登录认证；主机链主终端入口支持 password/key/agent/cert；Vault 加密
- ✅ Agent forwarding 独立 opt-in、显式请求、handler 授权、连接池隔离与共享边界已实现
- ✅ 多工作区、远程存储、团队云同步、冲突处理和离线队列
- ✅ 本地 PTY 创建、shell 启动及写入、resize、关闭控制 I/O 已移入 blocking pool，避免阻塞 Tokio worker
- ✅ 串口连接、SSH 证书认证和高级脚本
- ⚠️ Windows/Linux、Pageant、Jump Host、本地 PTY 和串口硬件仍需实机验证

### 发布就绪门禁 ✅ 本机自动化、容器运行时与远端发布通过

- ✅ `pnpm install --frozen-lockfile` 可重复安装
- ✅ `pnpm verify`：前端 859、Team Server 103、Rust 164 项单测 + 3 项集成测试、Node smoke 脚本 36 项及 lint/typecheck/build/源码行数门禁全部通过
- ✅ 生产依赖审计为 0 个已知漏洞
- ✅ 462 个生产源码文件均满足行数限制
- ✅ GitHub Actions CI `31409070480`：macOS、Windows、Linux Tauri 编译，Team Server PostgreSQL 迁移和 Docker 镜像构建全部通过
- ✅ `.github/workflows/release.yml` 为 macOS、Windows、Linux 的 x64/ARM64 建立原生 runner 打包、确定性资产命名、非空校验和 SHA-256 清单
- ✅ Release `v0.0.1-dev.1`：工作流 `31554163901` attempt 2 全绿，8 个安装包与 `SHA256SUMS.txt` 均非空，GitHub 服务端 digest 与清单一致
- ⚠️ Release 工作流通过只能证明对应目标可编译和打包；Windows/Linux/Pageant/PTY/串口交互仍按实机矩阵验证
- ⚠️ 未配置 Apple notarization 与 Windows Authenticode；开发版 DMG/NSIS 必须在 Release 说明中标为未签名/未公证
- ✅ Docker Desktop 29.7.2 + PostgreSQL 16.15 容器生命周期通过：2 个迁移、health/readiness、closed/token/open、非法环境 fail-closed、SIGTERM 退出码 0 与健康恢复均已验证

---

## 当前关键问题

> 详细问题列表请查看 `docs/issue.md`

| #     | 问题                                         | 严重程度     | 优先级 |
| ----- | -------------------------------------------- | ------------ | ------ |
| 57    | 真实 SSH 认证矩阵 ✅ macOS 本机 + macOS/Linux runner CI 全矩阵通过 | 🟡 Important | P1 |
| 58    | 物理键盘 30 轮重叠 `a/s/d` 注入待 Accessibility 授权或人工键入 | 🟡 Important | P1 |
| 21/39 | Windows/Pageant/串口硬件实机矩阵（macOS/Linux 已 CI 全绿） | 🟡 Important | P1 |

---

## 有用链接

- [Tauri 2.x 文档](https://tauri.app/)
- [React 19 文档](https://react.dev/)
- [shadcn/ui 文档](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [xterm.js](https://xtermjs.org/)
- [xterm.js API 参考](https://xtermjs.org/docs/api/terminal/classes/terminal/) - 详细 API 文档
- [russh](https://github.com/warpdotdev/russh)
- [russh-keys](https://docs.rs/russh-keys/)
- [russh-sftp](https://docs.rs/russh-sftp/)

---

## xterm.js 开发规范

终端功能基于 xterm.js 实现，**开发终端相关功能前必须先阅读 `docs/xterm.md`**。

### 已集成的插件

| 插件                     | 用途             | 使用方式                              |
| ------------------------ | ---------------- | ------------------------------------- |
| `@xterm/addon-fit`       | 自动调整终端大小 | `fitAddon.fit()` 在容器大小变化时调用 |
| `@xterm/addon-search`    | 终端内搜索       | `searchAddon.findNext()`              |
| `@xterm/addon-web-links` | 链接检测         | 自动检测 URL，点击打开                |
| `@xterm/addon-webgl`     | WebGL 加速       | GPU 加速渲染                          |
| `@xterm/addon-image`     | 图片支持         | 通过六字节序列显示图片                |
| `@xterm/addon-unicode11` | Unicode 11       | 支持新 Unicode 字符                   |
| `@xterm/addon-ligatures` | 连字字体         | 编程字体连字支持                      |

### 常用 API

```typescript
// 终端实例创建
const term = new Terminal({ cursorBlink: true, fontSize: 14 })

// 打开到 DOM
term.open(container)

// 写入数据（支持 VT 序列）
term.write('\x1b[2K') // 清除行

// 事件监听
term.onData(data => sshService.write(sessionId, data))
term.onResize(({ cols, rows }) => sshService.resize(sessionId, cols, rows))

// 缓冲区操作
term.buffer.active.getLine(y).getCell(x)

// 插件加载
term.loadAddon(new FitAddon())
```

### 性能注意事项

1. 大量数据写入时使用流控或批量写入
2. 容器大小变化后必须调用 `fitAddon.fit()`
3. 使用 `term.dispose()` 清理资源

---

## UI 实现参考

开发或还原界面时，**功能与 UI 描述以 `docs/ui/` 目录为准**：

| 文档                                  | 内容                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `docs/ui/00-design-system.md`         | 主题、颜色、字体、图标、间距、交互状态                                                         |
| `docs/ui/01-layout-and-navigation.md` | 顶栏、侧栏导航、主内容区、工具栏布局                                                           |
| `docs/ui/02-views.md`                 | Hosts、Terminal、SFTP、Logs、Port Forwarding、Known Hosts、Keychain、Snippets 的功能与 UI 说明 |

- 每个视图章节按「功能概述 → UI 组成 → 交互」结构描述，便于直接对照实现。
- 关键词统一（侧栏项、按钮、占位符文案），便于 AI 检索与理解。
- `02-views.md` 末尾有视图与前端路由/组件的对照表。

---

## React Router 使用规范

### 路由结构

项目使用 React Router 6 进行页面路由管理，所有路由配置在 `src/router/index.tsx` 中。

### 布局结构

```
┌─────────────────────────────────────────────────────────────┐
│  TopToolbar (顶栏)                                           │
│  - WorkspaceSwitcher                                         │
│  - Host / SFTP 导航按钮                                      │
│  - 标签页 (MenuTabs)                                        │
├──────────────┬──────────────────────────────────────────────┤
│              │                                              │
│  AppSidebar  │  主内容区 (Outlet)                          │
│  (左侧导航)   │  - Hosts 视图                               │
│              │  - SFTP 视图                                │
│  - Hosts     │  - Terminal 视图                           │
│  - Keychain  │  - Keychain 视图                           │
│  - Port Fwd  │  - Snippets 视图                           │
│  - Snippets  │  - Logs 视图                               │
│  - Known Hosts│  - 等等...                                │
│  - Logs      │                                              │
│              │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

### 路由配置

| 路由            | 组件              | 说明              |
| --------------- | ----------------- | ----------------- |
| `/` 或 `/hosts` | `HostsView`       | 主机列表页面      |
| `/terminal`     | `TerminalView`    | 终端会话页面      |
| `/sftp`         | `SftpView`        | SFTP 文件传输页面 |
| `/keychain`     | `KeychainView`    | SSH 密钥管理      |
| `/port-forward` | `PortForwardView` | 端口转发管理      |
| `/snippets`     | `SnippetsView`    | 代码片段管理      |
| `/known-hosts`  | `KnownHostsView`  | 已知主机管理      |
| `/logs`         | `LogsView`        | 日志查看页面      |

### 添加新视图规范

1. **创建视图文件**: 在 `src/view/` 下创建新文件夹，如 `src/view/example/`

```typescript
// src/view/example/index.tsx
import { ViewContainer, ViewToolbar, ViewContent, ViewHeader, EmptyState } from "@/components/view-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExampleIcon, Plus } from "lucide-react";

const ExampleView: React.FC = () => {
  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <Input placeholder="Search..." className="max-w-xs h-9" />
        <div className="flex-1" />
        <Button size="sm">
          <Plus className="size-4 mr-1" data-icon="inline-start" />
          New Item
        </Button>
      </ViewToolbar>

      <ViewContent className="p-6">
        <ViewHeader title="Example" description="Example view description" />
        {/* Content here */}
      </ViewContent>
    </ViewContainer>
  );
};

export default ExampleView;
```

2. **注册路由**: 在 `src/router/index.tsx` 中添加新路由

```typescript
import { lazy } from "react";
const ExampleView = lazy(() => import("../view/example"));

// 在 routes 数组中添加
{
  path: "example",
  element: warpCom(ExampleView),
},
```

3. **添加导航项**: 在 `src/components/app-sidebar/index.tsx` 中添加导航链接

```typescript
const navItems: NavItem[] = [
  // ... existing items
  {
    path: "/example",
    label: "Example",
    icon: <ExampleIcon className="size-5" />,
  },
];
```

### 路由最佳实践

1. **使用懒加载**: 使用 `React.lazy` 和 `Suspense` 进行代码分割
2. **状态管理**: 标签页和会话状态使用 Zustand 管理，不依赖 URL
3. **布局组件**: 使用 `ViewContainer` 及其子组件保持 UI 一致性
4. **导航链接**: 使用 `NavLink` 和 `useNavigate` 进行编程式导航

### 主题（明暗）

- **单一数据源**：`AppStore.theme`（`light` | `dark` | `system`），启动时由 `app.hydrateFromDatabase()` 从 SQLite `app_settings` 同步。
- **应用到 DOM**：`App.tsx` 根据 `app.theme` 切换 `document.documentElement` 的 `dark` class；`system` 时监听 `prefers-color-scheme` 变化。
- **设置对话框**：修改主题时须同时调用 `app.setTheme()`（立即生效）并在保存时写入 `saveAppSettings`。
- **Toast**：`components/ui/sonner.tsx` 通过 `MutationObserver` 跟随 `dark` class，**不要**依赖未包裹的 `next-themes` `ThemeProvider`。

### 主导航布局

- **顶栏**：`WorkspaceSwitcher` 可使用 `variant="vaults"` 对齐产品参考图；主区为 SFTP 入口 + 会话标签 +「新建标签」；次要入口收入「更多」菜单。
- **左侧栏**：`AppSidebar` 宽度可拖拽调整，像素值持久化到 `localStorage` 键 `terminal.sidebar.width`（约 200–420px）。

---

## 代码质量规范

### 文件大小限制

> **强制要求**: 为了保持代码可维护性，**严格限制单个文件的最大行数**。

#### 行数限制规则

| 文件类型 | 最大行数 | 说明 |
| --- | --- | --- |
| 视图文件 (`view/**/index.tsx`) | **300 行** | 包含大量 JSX 的页面组件 |
| 组件文件 (`components/**/index.tsx`) | **400 行** | 可复用组件 |
| 普通组件 (`.tsx`) | **200 行** | 其他 React 组件 |
| 工具/服务文件 (`.ts`) | **300 行** | 纯逻辑文件 |

#### 拆分触发条件

当文件接近或超过限制时，**必须**进行拆分：

- 单个组件超过 **150 行** → 考虑拆分内部子组件
- 单个文件超过 **300 行** → 必须拆分
- 文件内存在 **独立对话框/弹窗** → 拆分为独立文件
- 文件内存在 **可复用列表项组件** → 拆分为独立文件
- 同一文件中存在 **多个功能区域** → 按功能拆分

#### 拆分目录结构规范

```
src/view/example/
├── index.tsx           # 主视图 (导入子组件，组合布局)
├── components/         # 该视图专用的子组件
│   ├── toolbar.tsx    # 工具栏组件
│   ├── list.tsx       # 列表组件
│   ├── dialog.tsx     # 对话框组件
│   └── card.tsx       # 卡片组件
└── hooks/              # 该视图专用的 hooks (可选)
    └── use-example.ts
```

#### 拆分示例

**拆分前 (单文件，500+ 行)**:

```tsx
// src/view/settings/index.tsx
const SettingsView = () => { /* 500+ 行代码 */ }
const SyncSettings = () => { /* 同步设置 */ }
const StorageSettings = () => { /* 存储设置 */ }
const ExportDialog = () => { /* 导出对话框 */ }
```

**拆分后 (多文件，每个 <300 行)**:

```tsx
// src/view/settings/index.tsx
import SyncSettings from './components/sync-settings'
import StorageSettings from './components/storage-settings'
import ExportDialog from './components/export-dialog'

const SettingsView = () => {
  return (
    <>
      <SyncSettings />
      <StorageSettings />
      <ExportDialog />
    </>
  )
}
```

#### 已有文件待拆分清单

> ✅ 所有文件均已拆分至限制以内（2026-08-19 自动门禁覆盖 462 个生产源码文件）

| 文件 | 原行数 | 限制 | 当前行数 |
| --- | --- | --- | --- |
| `view/teams/index.tsx` | 1583 | 300 | 273 ✅ |
| `view/settings/index.tsx` | 1203 | 300 | 163 ✅ |
| `components/settings-dialog/index.tsx` | 1221 | 400 | 283 ✅ |
| `components/snippet-manager/index.tsx` | 778 | 400 | 311 ✅ |
| `view/hosts/index.tsx` | 876 | 300 | 208 ✅ |
| `view/snippets/index.tsx` | 828 | 300 | 242 ✅ |
| `view/keychain/index.tsx` | 801 | 300 | 237 ✅ |
| `components/host-list/host-dialog.tsx` | 609 | 200 | 198 ✅ |

---

### 移动端适配规范

> **强制要求**: 所有新增或修改的视图和组件**必须**同时支持桌面端和移动端。

#### 响应式断点

```typescript
// 断点定义
sm:  640px  // 小平板、手机横屏
md:  768px  // 平板
lg:  1024px // 桌面
xl:  1280px // 大桌面
```

#### 必须适配的元素

##### 1. 布局适配

| 元素 | 桌面端 | 移动端 | 适配方式 |
| --- | --- | --- | --- |
| 侧边栏 | 固定显示，可拖拽调整宽度 | 隐藏，通过汉堡菜单触发 | 使用 `AppSidebar` 组件 |
| 表格 | 多列完整显示 | 单列或卡片列表 | 使用响应式表格或 Cards 替代 |
| 表单 | 多列布局 | 单列堆叠 | 使用 `grid grid-cols-2` → `grid-cols-1` |

##### 2. 组件尺寸适配

```tsx
// 桌面端
<Button className="px-4 py-2">Action</Button>

// 移动端
<Button className="px-3 py-1.5 text-sm">Action</Button>

// 响应式写法
<Button className="px-3 py-1.5 sm:px-4 sm:py-2 text-sm sm:text-base">
  Action
</Button>
```

##### 3. 移动端专用组件

项目已提供以下移动端适配组件：

| 组件 | 用途 | 使用场景 |
| --- | --- | --- |
| `Sheet` | 底部弹出面板 | 工具栏操作、筛选面板 |
| `ResponsiveDialog` | 响应式对话框 | 表单编辑、确认操作 |
| `FAB` | 悬浮操作按钮 | 移动端快速添加 |
| `MobileToolbarSheet` | 底部工具栏 | 替代顶部工具栏 |

##### 4. 移动端适配检查清单

> **开发任何新功能时，必须检查以下所有项**：

- [ ] **侧边栏**: 是否使用 `Sheet` 实现移动端抽屉菜单？
- [ ] **长列表**: 桌面端表格在移动端是否改为卡片列表？
- [ ] **表单布局**: 是否使用 `grid-cols-1 md:grid-cols-2` 等响应式布局？
- [ ] **按钮尺寸**: 是否同时适配移动端小尺寸 (`h-8`, `text-sm`) 和桌面端 (`h-10`, `text-base`)？
- [ ] **对话框**: 是否使用 `ResponsiveDialog` 替代 `Dialog`？
- [ ] **操作入口**: 移动端是否有快速操作入口（如 FAB）？
- [ ] **触摸区域**: 可点击元素是否至少有 `44×44px` 的触摸区域？
- [ ] **间距调整**: 移动端内边距是否使用 `p-3` 或 `p-4`，而非 `p-6`？
- [ ] **文字截断**: 长文本是否使用 `truncate` 和 `line-clamp-*`？

##### 5. 响应式布局示例

```tsx
// ✅ 正确：完整的响应式布局
const HostCard: React.FC<{ host: Host }> = ({ host }) => {
  return (
    <div className="p-3 sm:p-4 rounded-lg border bg-card">
      {/* 移动端单列，桌面端双列 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <h3 className="font-medium truncate">{host.name}</h3>
          <p className="text-sm text-muted-foreground truncate">
            {host.username}@{host.hostname}
          </p>
        </div>
        {/* 桌面端显示详情，移动端隐藏 */}
        <div className="hidden sm:block">
          <p className="text-sm">{host.port}</p>
        </div>
      </div>
    </div>
  )
}

// ❌ 错误：没有移动端适配
const HostCard: React.FC<{ host: Host }> = ({ host }) => {
  return (
    <div className="p-6 rounded-lg border">
      <h3>{host.name}</h3>
      <p>{host.username}@{host.hostname}:{host.port}</p>
    </div>
  )
}
```

##### 6. 移动端对话框示例

```tsx
// ✅ 使用 ResponsiveDialog
import { ResponsiveDialog } from '@/components/ui/responsive-dialog'

const MyEditDialog: React.FC<Props> = ({ open, onClose }) => {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onClose}
      header={<DialogTitle>Edit Item</DialogTitle>}
      footer={
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      }
      mobileHeight="85dvh"  // 移动端全屏
      desktopWidth="sm:max-w-md"  // 桌面端居中
    >
      <div className="space-y-4">
        {/* 表单内容 */}
      </div>
    </ResponsiveDialog>
  )
}

// ❌ 避免使用原生 Dialog 处理复杂表单
const BadDialog: React.FC<Props> = ({ open, onClose }) => {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="p-6">
        {/* 移动端会溢出或样式错乱 */}
      </DialogContent>
    </Dialog>
  )
}
```

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

---

_文档更新时间: 2026-08-28 (Phase 6.21: real-machine 工作流 macOS/Linux runner 全矩阵通过；详见 docs/todo.md)_
