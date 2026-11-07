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
| **docs/release/**             | 发布与证据规则（`workflow-rules.md`，必读）、CI 审计、三级发布模式、签名密钥、Release 操作指南（Nightly 通道已移除）、最近一次 CI 报告 | 改动发布链路或源码指纹路径时必读 |
| **docs/phase9-5/**            | Phase 9.5 交付：Phase 9.4.2 归档、PR #6/#7 集成方案、真实 dev.1→dev.2 与 dev.1→当前源码升级 E2E、双版本 harness、corrupt/read-only/restart/backup 故障恢复、独立 worker 真实 crash 矩阵与恢复重试、进程树 quiescence、隔离卷 ENOSPC、签名与身份迁移阻塞项 | 接手升级、数据完整性或发布准备时必读 |
| **docs/phase9-4/**            | Phase 9.4 / 9.4.1 / 9.4.2 交付：macOS 远程冷启动 300 次压力统计（F 轮 298/300）、8 秒 fallback deadline 错传、跨样本 journal 污染、恢复仲裁状态机与分段 trace、provenance fail-closed、RSA 威胁模型、安装升级与身份迁移前置、RC 判定 | 接手冷启动、恢复仲裁或 RC 收尾时必读 |
| **docs/phase9-3/**            | Phase 9.3 / 9.3.1 交付：bootstrap 配置探测饥饿（#166）、ENOTEMPTY 竞态（#167）、证据重采（#168）、REMOTE 旧密文与 REST BigInt（#169/#170）、yanked 扫描完整性、前端依赖 25→0、冷启动 20% 失败率量化 | 接手启动链路、同步或证据采集链时必读 |
| **docs/phase9-2/**            | Phase 9.2 交付：同步冲突五处 P0 根因、双客户端真实 PG 端到端、依赖安全整改台账、证据门禁、身份迁移方案、最终报告（PASS/FAIL/NOT_RUN 分列） | 接手同步、安全或验收证据相关工作时必读 |
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

### Phase 9.4 - RC 可靠性 🔄 进行中

- ✅ 冷启动压力采样工作流（300 样本、`--expected-samples`、verdict 门禁）已落盘
- ✅ F 轮 run `41683645429`（`7600963`）：**298/300（0.67%）**，首次点估计低于 1%；`terminal-mounted=300`，late-tab 修复在这一轮生效
- ✅ **两个失败已定位为确定性缺陷，不是 WebKit 崩溃**：228 = App chunk 的 8 秒 deadline 被错传成 terminal fallback deadline；229 = 共享 WKWebView localStorage 的 local-only recovery journal 污染（两个样本的 `local-1793728115282` tab id 生成时间早于 229 的 `capturedAt`）
- ✅ Phase 9.4.2 代码：`startup-recovery-arbiter` 状态机；layout 读取失败抛错重试；workspace/layout 3 秒超时；`loadHosts` generation 竞态；用户输入与程序化写入区分；journal 不再遮蔽 remote 布局；fallback 与用户 tab 合并
- ✅ 测量链：失败样本补 `binarySha256`/fixture/stages；checkout `fetch-depth: 2`；汇总器 `--require-provenance` / SHA / timeout / mount fail-closed；每样本前清空 WebKit 数据；新增 1 ms 强制超时 + 正常样本的隔离验证
- ✅ 本地门禁：前端 **153 文件 / 1393 项**、冷启动相关脚本 **83 项**、typecheck、ESLint、source-size **568 文件**、actionlint 通过；本机真实回归 **10/10 remote、0 local**，隔离验证 **ISOLATION_PASS**
- ✅ **G 轮真实 runner（run `41838269784`，`ac01091`）：300/300（100%），`RELIABILITY_PASS`**；`remote=300`、0 个 local；中位 3412 ms / p95 3722 ms；隔离验证 **ISOLATION_PASS**
- ✅ **第二轮 artifact 复算（run `41843065808`）：300/300**；首次 remote 299/local 1（样本 37 的临时 local 在 5124 ms 被 remote 替换），最终 remote 300；旧首次挂载门禁已修
- ✅ **clean 轮（run `41850205866`，`d4a972a`）：300/300（100%）**；首次与最终均 `remote=300`；中位 3721 ms / p95 5482 ms；三个 run 合计 **900 样本，0 个最终 local**
- ✅ **WebKit CRASHSTRING 已排除为失败信号**：控制组成功样本各 1 次 `CRASHSTRING`、0 个 `processExits`
- ✅ 六份验收证据已由真实矩阵 run `41841781191` 重采（`ac01091`，指纹 `d14fb1d1…`，debug `0eb823fa…`、release `a1cf8181…`），门禁 **0 problem**；最终 CI `41850097122`（`d4a972a`）**11/11 success**
- 📋 Phase 9.4.2 冷启动收口完成；剩余 RC 阻断是跨版本升级/回滚、Windows/Pageant/串口/物理键盘/IME、签名/公证、身份迁移与真实 Vault 解锁（NOT_RUN/BLOCKED_EXTERNAL）

### Phase 9.5 - Integration Closure & Real Upgrade Foundation ✅ 基础完成

- 分支 `feat/phase9-5-upgrade-integrity`，已重放到 PR #7 `00715d6`
- ✅ PR #6：**已合并**为 `9a0ca15`（2026-11-05T03:24:04Z），main 已更新；合并前 `CLEAN`、11/11、evidence 0
- ✅ PR #7：已 rebase 到 main（18/18、0 冲突、证据门禁 0、source-size 568），head `00715d6`，base 已改为 `main`
- ✅ PR #8：已重放到 `00715d6`，head `1f04c91`，5 commits、40 文件，仍为 Draft
- ✅ 真实 A→B：发布 `0.0.1-dev.1`（`73cf7483…`）→ 发布 `0.0.1-dev.2`（`2c9a0ca3…`）PASS；dev.1 → 当前源码 `0.0.1-dev.3-local`（`66f2465d…`）PASS
- ✅ schema：hosts 20→22 列（`agent_forwarding`、`shell_integration`）；settings 全键、workspaces/layout、Team Sync 本地 5 表、vault 文件逐字段 PASS
- ✅ 当前 B 的 `pre-migration-<epoch>.db` 已生成且可读回；dev.2 无备份能力，标 NOT_RUN
- ✅ 故障：损坏 DB、只读数据目录、重复启动、备份可读均 PASS；迁移中断/磁盘满/自动恢复/B→A 降级 NOT_RUN
- ✅ CI：`Upgrade E2E` run `41954815468` **success**（A→B + corrupt/read-only/restart）；PR #8 重放后 run `41961803808` 也 **success**；普通 CI `Repository gates` 已加入 `scripts/verify-install/*.test.mjs`
- 🟡 Linux/Windows 升级适配器 NOT_RUN；Windows APPDATA 实际未隔离且现有脚本会删除真实目录，禁止在真实 profile 上跑
- 🟡 真实 Vault 解锁、Team Sync 服务端同步、updater 运行时下载/安装/重启、签名/公证、身份迁移、RC/Release 均未闭合
- 📋 Phase 9.5.1：Linux fail-closed 适配器、Windows 一次性 profile/VM、迁移中断/磁盘满/恢复 E2E、updater 升级链、把升级证据纳入 release 指纹

### Phase 9.5.1 - Cross-Platform Upgrade & Recovery Hardening 🟡 实现完成，平台证据待补

- ✅ 故障五事实（`FAULT_INJECTED` / `APPLICATION_FAILURE_OBSERVED` / `ORIGINAL_DATA_PRESERVED` / `NO_PARTIAL_MIGRATION` / `RECOVERY_SUCCEEDED`）与 5 项负测试；独立 `check-upgrade-evidence.mjs` 门禁
- ✅ 当前 HEAD CI 升级 run `42003371472`：5/5 job success、macOS current 7/7；B=`0.0.1-dev.4-local`、source `78dd0d8`、DMG SHA `dcd865d1…`；普通 CI `42003381820` 11/11
- ✅ 真实中途迁移中断：`agent_forwarding` 提交后、`shell_integration` 前 SIGKILL；重启收敛、字段级验证 PASS
- ✅ 备份恢复：复制 `pre-migration-<epoch>.db`、删除 WAL/SHM、A 启动读回、SHA 一致
- ✅ Linux x64 DEB：真实 `apt-get`/dpkg、`dpkg-query` 版本变化、字段级数据 PASS（run `41972602296`）
- 🟡 Linux AppImage：payload-only job success，**报告为 PARTIAL**（同路径替换 + 替换后 SHA PASS）；headless Xvfb 下 bundled WebKit EGL 启动失败，系统 WebKit 回退又受 bundled GStreamer/GLib 符号版本阻断，启动/迁移显式 NOT_RUN；详见 `docs/phase9-5/linux-upgrade-verification.md`
- 🟡 Windows：只读隔离预检在 `windows-latest` 正确 fail-closed；升级 E2E 仍 NOT_RUN，需一次性 profile/VM
- ✅ 六份实机证据因 smoke-only 迁移延迟变为指纹 `b73c5fd2…`，已用官方流程重采（run `41970525110`，0 problem）；未手改旧 manifest
- 📋 未完成：Windows 升级 E2E、Linux AppImage stock 启动、磁盘满/Linux 故障注入、真实 Vault 解锁、Team Sync 服务端、签名/公证/updater/身份迁移

### Phase 9.5.2 - Upgrade Trust & Secure Data Continuity 🟡 实现完成，外部环境待补

- ✅ 六份证据因 `vault_tests.rs` 已知答案测试改变源码指纹，已用官方流程 run `41998303201` 重采（`fd9cc8ac…`，0 problem）；未手改旧 manifest
- ✅ 场景级升级证据契约：10 个场景、22 项契约/负测试；`PASS` 必须全部 required checks/facts PASS，只有 AppImage payload-only 允许 `PARTIAL`；校验 `sourceSha`/`runId`/artifact status/problems/expected SHA、恢复后 A 启动、降级 B 列保留、中断缺失列
- ✅ 备份恢复加固：checkpoint busy/log/checkpointed 校验、先删 sidecar 再 rename、最早 `pre-migration-*` 备份、恢复前 A 快照校验、A 启动证据
- ✅ Vault：Node 24 Argon2id/AES-GCM 独立 fixture + Rust 已知答案测试；升级后 B 文件中的加密条目可解密、错误密码拒绝（app-level unlock 仍 NOT_RUN）
- ✅ Team Sync：修复 TeamMember `joinedTxid` BigInt HTTP 序列化；新增 full AppModule + 真实 Nest HTTP + 真实 PostgreSQL 同步测试（PG 12 文件/96 项）
- 🟡 Windows：身份+路径+owner+reparse+existing data+cleanup+VM attestation 状态机，8 项负测试；共享 runner fail-closed；一次性 profile/VM 与 A→B **NOT_RUN**
- 🟡 降级：A 读取加法 schema + B 快照字段保留 PASS；未来不兼容 schema 拒绝 **NOT_RUN**
- 🟡 磁盘满/busy checkpoint/恢复 crash point/**ENOSPC** **NOT_RUN**
- 🟡 Updater：latest.json 静态契约/负测试；运行时下载/验签/安装/重启 **NOT_RUN**；release manifest deb/arm64/签名验证缺陷仍存在
- 📋 代码 HEAD `78dd0d8`（文档 `eccabe6`）；最终 CI/证据重采结果见 `docs/phase9-5/phase9-5-2-implementation.md`

### Phase 9.5.3 - Process Lifecycle & Crash-Safe Recovery 🟡 P0 完成，外部环境待补

- ✅ 异步进程生命周期：`process-lifecycle.mjs`，真实 exit/close、SIGTERM→SIGKILL、日志 close 后写入、7 项 dummy child 测试；不再用 `Atomics.wait`；E2E `42019746261` 11 次 stop 全 graceful、0 forced
- ✅ 恢复状态机：`PREPARE→QUIESCE→VERIFY_BACKUP→STAGE→VERIFY_STAGED→COMMIT→VERIFY→COMPLETE`，crash point 仅 `TERMINAL_TEST_CRASH=1` 启用；报告记录 `backup restore stages`
- ✅ busy checkpoint：真实第二个 SQLite 连接持读事务，checkpoint 非零退出
- 🟡 进程组/WebKit/PTY/lsof quiescence **NOT_RUN**；crash point 真实逐点执行 **NOT_RUN**
- 🟡 磁盘满/ENOSPC、Windows disposable profile/VM、Vault app-level、Team Sync 跨版本客户端、updater 运行时 **NOT_RUN**
- 🟡 AppImage 仍 payload-only（stock 启动 NOT_RUN）
- ✅ 最终 E2E `42019746261` 5/5、CI `42019753323` 11/11；代码 HEAD `d958e28`；判定见 `docs/phase9-5/phase9-5-3-implementation.md`

### Phase 9.5.4 - Crash Recovery Evidence & Upgrade Safety Closure 🟡 P0 门禁完成，真实 crash 矩阵已通过

- ✅ 严格 `requireStopped`：拒绝 spawn-error/timeout/exit/close/logError/非预期信号；A/B、恢复、降级、Linux 路径统一 `stopChecked`
- ✅ 终止语义拆分：clean-exit / terminated-by-sigterm / forced-sigkill / spawn-error / timeout；日志写在 close 内且失败独立诊断
- ✅ quiescence：PROCESS_EXITED/STREAMS_CLOSED/**OWNED_CHILDREN_SETTLED**/DB_HANDLES_RELEASED 四事实；E2E `42047193259` 的 10 份报告全 PASS（含 Linux WebKitGTK 子进程）；Windows 无 pgrep，仍 NOT_RUN
- ✅ **真实 crash 矩阵**：`restore-worker.mjs` 独立进程在 8/8 阶段真实 `SIGKILL` + control；父进程断言 PID 归属、`signal=SIGKILL`/`code=null`、精确文件集 SHA、`integrity_check` 与内容读回；**8/8 PASS**
- ✅ **恢复重试**：崩溃后独立 retry 进程，6 阶段 `restored`、2 阶段 `already-restored`，最终文件集恰好 `{terminal.db: 备份 SHA}`；产品启动时自动恢复仍 **NOT_RUN**
- ✅ 恢复状态机 8 阶段 + `backup restore stages`；Harness 恢复改为 spawn `restore-worker.mjs`，与矩阵共用一份实现；busy checkpoint 真实第二连接测试 **PASS**
- ✅ `raceAfter()` 清理 `Promise.race` 遗留计时器，脚本测试不再被 30s 定时器拖住；`process-lifecycle` 10/10
- ✅ **staged restore ENOSPC**：真实 64 MB HFS+ DMG（Linux 用 size-capped tmpfs，无 sudo 显式 skip）上 restore 失败后主库 SHA 不变且可读，释放空间后 retry `restored`，伪造 staging 被丢弃
- ✅ **产品迁移 disk-full（Phase 9.5.5）**：64 MB DMG + 24 MB A 时代 DB + 约 8 MB 空闲；B 满卷未完成迁移（0/2 新列），A 数据可读，释放空间后迁移收敛并生成可读备份；E2E `42061498904` 五事实 PASS；`0602541` 起报告纳入归档与阻塞门禁；安装 B/目录 fsync 仍 **NOT_RUN**
- 🔴 Windows disposable、Vault app-level、Team Sync 跨版本、updater 运行时、AppImage stock **NOT_RUN/PARTIAL**
- 📋 判定见 `docs/phase9-5/phase9-5-4-implementation.md` 与 `real-crash-point-matrix.md`

### Phase 9.6 - Product Recovery & Cross-Platform RC Closure 🟡 P0 产品恢复完成，外部平台待补

- ✅ **产品启动自动恢复**：`src-tauri/src/db_recovery.rs`；迁移前标记、启动检测、快照校验、8 阶段恢复、脱敏状态；部分迁移自动恢复，无有效快照 MANUAL 且不覆盖；二次启动幂等
- ✅ E2E `42146486221`（`b460faf`）**5/5**，interrupted 报告 `product recovery after interruption=PASS`（真实 B 启动检测并恢复快照）
- ✅ 恢复 UI：启动查询状态，MANUAL/RESTORE_INTERRUPTED 阻断主界面并显示脱敏 state/reason；不提供危险覆盖操作
- ✅ 证据重采：`real-machine-matrix` run `42158238718` 3/3，新指纹 `47c25a03…`，官方门禁 0 problem；CI `42160597380`（`8a7a0e4`）**11/11**
- 🟡 Windows NSIS、Vault app-level、Team Sync 跨版本、updater 运行时、安装 ENOSPC、AppImage stock **NOT_RUN/PARTIAL**
- 📋 判定见 `docs/phase9-6/implementation.md`

### Phase 9.6.1 - Recovery Safety Audit & Startup Gate Hardening 🟡 P0 门禁完成，外部平台待补

- ✅ **启动门禁 fail-closed**：`StartupGate` 根组件只有 HEALTHY/RECOVERED 才挂载业务 App；Tauri 状态异常/非法对象一律阻断；`getDb()` 在 pending/blocked 抛错；前端 14 项负向测试
- ✅ **裁决持久化**：`RecoveryVerdict` 保存本次启动状态，`db_recovery_status` 只读，`db_recovery_retry` 显式重跑
- ✅ **标记 v2**：Core/Team 共用 `targets[]`+`migrationId`，合并写入、v1 兼容；完成清除由后端校验目标列 + integrity
- ✅ **备份边界**：canonicalization 拒绝备份目录外符号链接与 live DB
- ✅ **Windows 目录 fsync**：`FILE_FLAG_BACKUP_SEMANTICS`，仅 `ERROR_INVALID_FUNCTION` 容忍
- ✅ E2E `42174132285`（`bf6e392`）5/5；证据矩阵 `42174128131` 3/3，指纹 `fbfa5a00…`，门禁 0
- 🟡 多实例恢复锁、真实 Windows `cargo test`、Team 应用级崩溃 E2E **NOT_RUN**
- 📋 判定见 `docs/phase9-6/phase9-6-1-safety-closure.md`

### Phase 9.6.2 - Migration Transaction & Recovery Concurrency Closure 🟡 标记/锁/门禁收口完成，真实多进程 E2E 待补

- ✅ **损坏/未知版本标记 fail-closed**：`read_marker` + `validate_marker`，绝不覆盖未知事务；备份失败只回滚本次创建的标记，合并时保留旧快照
- ✅ **活动快照 pin**：`active_snapshot` 固定保留标记引用的快照；标记不可读时跳过清理
- ✅ **跨进程恢复锁**：`RecoveryLock`（OS 文件锁），启动有标记先加锁、第二实例 fail-closed；句柄级测试通过，**两个真实进程并发 E2E NOT_RUN**
- ✅ **前端门禁缓存绕过修复**：`getDb` 先断言门禁，`select` 不再把门禁拒绝吞成 `[]`；4 项新测试
- ✅ **Windows 原生恢复测试**：windows-latest job `127803321020` 实跑 `cargo test --lib db_recovery` **9 passed / 0 failed**（含 Windows-only 目录 flush）；修复 `ERROR_ACCESS_DENIED`
- ✅ E2E `42189361366`（`af33ea2`）**5/5**；证据 `42214762202`（`7df9e3a`）指纹 `c138d564…`，官方门禁 0 problem；旧 CI `42191186517` 为 10/11（仅证据未提交）
- 🟡 Team 应用级 SIGKILL、Windows 完整文件系统矩阵/NSIS A→B **NOT_RUN/PARTIAL**
- 📋 判定见 `docs/phase9-6/phase9-6-2-recovery-concurrency.md`

### Phase 9.6.3 - Final Recovery Safety Closure & Phase 9.7 Entry Gate 🟡 数据安全闭环，平台项待补

- ✅ **事务所有权**：标记 v3（`transaction_id`/`owner_pid`/`owner_token`）；跨进程或旧版本标记拒绝合并；扩展前验证快照不含新目标列；真实只读目录注入 `VACUUM INTO` 失败后标记逐字节回滚，下一次启动恢复事务 A
- ✅ **恢复互斥**：`RecoveryLock` = OS 文件锁 + tokio 进程内互斥 + `migration_active`；启动每次探测锁、第二实例 fail-closed；真实双进程 E2E（持锁拒绝、SIGKILL 释放、ALTER 中被杀后恢复、并发启动只恢复一次）
- ✅ **完成语义**：完成/清除核对事务 ID；标记清除失败返回 `RestoreInterrupted`；retry 的锁失败与迁移进行中均写入一致的阻断裁决
- ✅ **Windows**：windows-latest `cargo test --lib db_recovery` **19 passed**，含目录写探测与“打开中数据库不得半替换”
- ✅ **Team 应用级 SIGKILL**：1/3/5/10 目标点、Core 完成/Team 部分、快照/恢复/幂等/字段级数据全部 PASS；E2E `42249215589`（`65299c8`）**5/5 jobs success**
- 🟡 已运行实例在另一实例恢复期间的普通写入、Windows reparse/ACL/NSIS A→B 仍 PARTIAL/NOT_RUN
- 📋 判定见 `docs/phase9-6/phase9-6-3-final-data-safety.md`

### Phase 9.7 - Cross-Platform Product Acceptance & RC Hardening 🔄 P0-A 完成，产品验收进行中

- ✅ **单实例**：`tauri-plugin-single-instance v2.5.5` 首个注册插件；第二次启动激活/重建主窗口；`instance.lock` 在任何数据库访问前持有，`RuntimeLockHandle` 校验 inode，锁文件被删除/替换即失效
- ✅ **Retry 绕过封堵**：`retry_recovery(..., runtime_held)`、完成迁移、备份命令与前端 `getDb` 全部校验运行时锁；未持锁不得升级为 HEALTHY
- ✅ **P0-A.2 会话锁闭合**：`getDb` 每次调用（含缓存/初始化中）校验锁；锁失效即关闭缓存句柄并阻断。锁身份取自已加锁 fd，Unix 对比 inode、拒绝 symlink/替换；Windows 用 creation_time+size 近似（PARTIAL）。plugin-sql 直接命令的信任边界已记录（不做前端万能声明）
- ✅ **真实三进程 E2E**：从 B DMG 安装并校验 SHA；第二次启动 code 0 并激活首进程、仅一个 DB；SIGKILL 后第三进程取得锁、读到并改写 probe 行；E2E `42344829575`（`c68aebb`）**5/5**
- ✅ **Vault 服务级应用链路**：smoke 构建 + 隔离标记触发的 `VaultService` probe，覆盖创建/锁定/错误密码/改密/重启持久化；结果经 `smoke-vault-probe` feature 写文件；密码/秘密不入日志。UI 自动化与 A→B 跨版本 **NOT_RUN**
- ✅ **WP3 Team Sync 跨版本已实跑**：`v0.0.1-dev.2` 源码（固定 `835fae82…`）与当前 HEAD 各自独立进程，真实 HTTP/PG/磁盘 SQLite。A 首次推送/拉取 PASS，当前客户端在 A 数据库上升级并推送脏行 PASS；**A 的第二次同步 FAIL**：服务端把毫秒游标判为超出安全水位并返回全量窗口，历史客户端裸 `INSERT` 命中 `UNIQUE constraint failed`。已记录 finding 与复现脚本；CI 中该步骤是诊断（`continue-on-error`），不冒充产品门禁
- ✅ **WP4 Updater 运行时（macOS arm64）**：`smoke-updater` feature 下的 Rust 探针完成 check → download → minisign 验签 → install → restart；临时密钥、loopback HTTP、两次真实构建、测试 identifier 隔离。9 用例全 PASS（正向安装重启、数据保留、7 个负向拒绝且无半安装）；Windows/Linux 运行时与正式签名仍 NOT_RUN/BLOCKED_EXTERNAL。见 `docs/phase9-7/updater-runtime.md`
- ✅ **路由切换闪烁修复**：`RouteTransition` 改为同步按 pathname 设 key（消除新页面先挂载再重挂），外层不透明、动画只作用于内层内容；Vault 等页面不再透出背后的终端层。回归测试 `route-transition.test.tsx`，旧实现会让它失败
- 🟡 窗口焦点（headless）、Windows NSIS、AppImage stock 仍 **NOT_RUN/BLOCKED_EXTERNAL**
- ✅ 最终 E2E `42365420354`（`64db332`）5/5，此前 `42356452096`（`49e9903`）同为 5/5；证据矩阵 `42399093877`（`e9858c9`）3/3，指纹 **`7f426434…`**（debug `893c6c6f…`、release `5c4f92b4…`），门禁 0 problem；最终 CI 见 PR
- ✅ **Vault Escape 竞态修复**：窗口 `keydown` 监听改为注册一次并通过 ref 读取当前层级，消除告警刚渲染、effect 尚未重注册时 Escape 被旧闭包忽略的一帧；`packages/frontend/src` 因此变更，六份证据按规则重采为 `7f426434…`
- 📋 WP3 交付见 `docs/phase9-7/team-sync-cross-version.md`；跨版本兼容性**未通过**，是 RC 阻塞项
- ✅ **夜间 P0 修复**：SFTP 会话绑定 hostKey、切换即关闭旧会话并丢弃过期 generation 响应（双主机竞态测试旧实现失败/新实现通过）；云团队创建改走真实 `POST /teams` 并持久化服务端 id（失败不提示成功）；历史毫秒游标按最低版本策略返回 426（ADR `adr-legacy-sync-policy.md`）
- ✅ **夜间数据安全修复（代码审查）**：云同步不再删除 local/其他 endpoint 的共享；敏感态冲突返回 `SENSITIVE_STATE_MISMATCH`；`operation=DELETE` push 明确拒绝；不完整 resync 不再清理本地行；SFTP 在途会话复用/卸载关闭；端口转发读写拆分消除全双工死锁
- ✅ **夜间 UI 修复**：Settings loading/ready/error + 重试 + 未保存回滚；Hosts 加载失败重试；Host Dialog 改 shadcn Dialog（焦点/Esc/未保存确认）；侧栏 Arrow/Home/End 键盘调整；设置/主机/端口转发/钥匙串/SFTP/片段/团队/命令面板全量中文化（bundle 预算 577→588 KB，按预算注释逐次说明）
- 🟡 未修但已记录（`docs/phase9-7/overnight-review-findings.md`）：-R 远端转发未接线、SSH writer 超时竞态、协议 1 无游标首同步截断、teamApi 单例跨 endpoint、上传截断远端文件、SFTP mtime；UI 截图因本机无辅助功能/录屏权限 NOT_RUN
- ✅ **Vault 生产构建门禁**：无 feature 时 `vault_probe_report` no-op；生产 bundle 无 probe 常量、smoke overlay 有 probe，均有构建断言
- 📋 判定见 `docs/phase9-7/phase9-7-product-acceptance.md`、`single-instance-e2e.md`、`vault-app-e2e.md`、`session-lock-safety.md`

### 发布就绪门禁 ⚠️ 同步、安全与实机证据门禁已闭合；Phase 9.4 冷启动、证据重采与外设实机未闭合

- ✅ `pnpm install --frozen-lockfile` 可重复安装
- ✅ Phase 9.4 本地门禁快照（文档记录）：前端 **152 文件 / 1371 项**、脚本 **385 项**、**563** 个生产文件行数门禁、bundle budget；Rust / Team Server 以 CI 结果为准。Phase 9.4.2 修复后必须重跑并以实跑数字更新
- ✅ **六份验收证据已在 Phase 9.4.2 的真实 runner 重采**：run `41841781191`（sha `ac01091`），源码指纹 **`d14fb1d1…`**，三平台 3/3 success，debug `0eb823fa…`、release `a1cf8181…`，`check-verification-evidence.mjs` 报 **0 problem**；证据与 manifest 已归档，最终 CI `41850097122` 为 **11/11**。**不得修改旧 evidence 让门禁变绿**；任何 `FINGERPRINT_PATHS` 内改动仍需重采
  - 证据绑定**代码身份**而非"最近一次成功"：任何 `FINGERPRINT_PATHS` 内的改动（包括前端恢复链与采样脚本）都会让旧证据当场失效
- ✅ **证据门禁已是真门禁**：`check-verification-evidence.mjs` 此前只能经 `pnpm verify` 抵达，而 CI 里没有 job 调用它，等于自愿遵守。现在它是 `source-size` job（已改名 `Repository gates (source size, evidence, script tests)`）里的阻塞步骤，**无 `continue-on-error`**
- 🔴 **依赖安全：13 条已记录，1 条真实不可修**：`cargo audit` 从 42 条（25 vulnerabilities + 9 unmaintained + 4 unsound + 4 yanked）降到 **13 条（8 + 4 + 1 + 0）**，修掉 29 条。剩余结构：7 条锁文件残留（不在任何构建图：quinn-proto ×5、rkyv、rsa 0.9.10）；5 条真实但**只在 Linux**（glib、proc-macro-error、zvariant、zbus_names、zvariant_derive，均来自 Tauri 托盘/通知栈，已用 `cargo tree --target` 三平台实测）；**1 条真实、三平台、上游无修复**：`RUSTSEC-2023-0071`（rsa 0.10.0-rc.18，Marvin 攻击，`patched = []`，russh 与 ssh-key 精确钉死该版本）。
  `cargo-audit` job 已从 `continue-on-error: true` 改为**阻塞门禁**，由 `scripts/security-gate.mjs` 以三态退出码裁定（0 全在基线 / 1 有新 advisory 或版本变化 / 2 扫描失败）。门禁键为 `kind|id|crate` + 版本，所以 rsa 的两条不会互相搭便车。台账 `docs/phase9-1/security-advisories.md`，基线 `src-tauri/security-baseline.json`，`src-tauri/deny.toml` 仅作手工参考、**不是 CI 门禁**
  **不得在任何交付材料中声称「生产依赖审计为 0 个已知漏洞」**，也不得把这里的绿读成「没有已知漏洞」——它只表示「没有未记录的 advisory」（详见 `docs/phase9-2/security-remediation.md`）
- ✅ **前端依赖审计已闭合，且它不是「未测量」而是 25 条真实漏洞**（Phase 9.3.1）：Phase 9.2 的 NOT_RUN 结论关于的是**开发机**（本机 npmrc 指向国内镜像），不是项目。对公共 registry 实测为 25 条（1 critical / 12 high / 9 moderate / 3 low），几乎全部经由**我们自己的 `pnpm.overrides`** 把已修复的包钉在脆弱版本上（body-parser / fast-uri / js-yaml / qs / multer / proxy-addr / source-map-js / mysql2）。升级 override 后 `pnpm audit --prod` 报 **No known vulnerabilities found**。新增 `Dependency audit (npm)` CI job（不带 registry 覆盖）。**注意：依赖审计是快照，不是永久性质**
- ✅ 563 个生产源码文件均满足行数限制（Phase 9.4 当前）
- ✅ GitHub Actions CI `41233703193`（sha `3fb006c`）：**9/9 success**；`41230214611`（sha `030fda4`）同为 9/9 success。覆盖前端、Team Server、Team Server 容器、Rust、源码规模门禁与 macOS/Windows/Linux 三平台 Tauri 编译（含安装链与数据保留）。其中 `zsh probe diagnostic` 配置了 `continue-on-error: true`，它的 success **不构成产品门禁**
- ⚠️ **CI `41434168073`（sha `a093fc7`）为 9/10**：除 `Repository gates (source size, evidence, script tests)` 外全部 success（该 job 红的唯一原因是证据还没提交）。证据落盘并推送后需再跑一次 CI 才能看到 10/10；**在该 run 出现之前，不得把这次 CI 记成全绿**。同一 sha 的实机矩阵 run `41434165000` 为 3/3 success（macOS / Linux / Windows）
- 🔴 **CI `41401379387`（sha `84f73b0`）为 failure**：`Team Server quality` 的 `eslint src` 报 `perfectionist/sort-imports`（`client-sync-e2e.pg-spec.ts` 第 20 行 `SharesService` 应排在 `SyncService` 之前）。已在 `84f73b0` 之后的工作树修复并随 `e367e3d` 落地；该 run 其余 8 个 job 全绿
- ✅ **实机矩阵 Linux zsh 已 PASS**：run `41432020659`（sha `e367e3d`）、`41434165000`（sha `a093fc7`）与 `41478709578`（sha `3102093`）的 Linux job 均 success，14 个用例（bash 7 + zsh 7）全绿，含此前超时的 `zsh/readline-history` 360 ms、`zsh/readline-tab` 449 ms、`zsh/pty-resize` 1425 ms。修复是 `3d71988` 的探针夹具 `PROBE_HOME_STARTUP_FILES`/`seedProbeHome()`（Debian `/etc/zsh/zshrc` 的 `compinit` 用 `read -q` 吃掉第一个键入字节，机制见 `docs/phase9/linux-zsh-probe-diagnosis.md`）。**这条绿测的是产品的 shell 注入链，不是「`$HOME` 为空的真实 Debian 新账户也安全」**——那个遗留风险仍未测
- ✅ `.github/workflows/release.yml` 为 macOS（aarch64 / x86_64 各出一个 DMG）、Windows、Linux 的 x64/ARM64 建立原生 runner 分架构打包，共 8 个安装资产 + `SHA256SUMS.txt`，带确定性命名与非空校验；`updater-signed` 模式额外产出逐架构 `.sig` 与唯一 `latest.json`
- ✅ Release `v0.0.1-dev.1`：工作流 `31554163901` attempt 2 全绿，8 个安装包与 `SHA256SUMS.txt` 均非空，GitHub 服务端 digest 与清单一致
- ✅ Release `v0.0.1-dev.2`（2026-10-30T09:54:11Z，draft=false）：**updater-signed 模式**，20 个资产 = 8 个安装包 + 8 个真实 minisign `.sig` + `SHA256SUMS.txt` + `latest.json`。这是目前唯一能自动更新的版本；`latest.json` 只含 4 个平台（darwin-aarch64 / darwin-x86_64 / windows-x86_64 / linux-x86_64），windows-aarch64 与 linux-aarch64 能装不能更新
- ⚠️ Release 工作流通过只能证明对应目标可编译和打包；Windows/Linux/Pageant/PTY/串口交互仍按实机矩阵验证
- ⚠️ 未配置 Apple notarization 与 Windows Authenticode；开发版 DMG/NSIS 必须在 Release 说明中标为未签名/未公证
- ✅ Docker Desktop 29.7.2 + PostgreSQL 16.15 容器生命周期通过：2 个迁移、health/readiness、closed/token/open、非法环境 fail-closed、SIGTERM 退出码 0 与健康恢复均已验证

---

## 当前关键问题

> 详细问题列表请查看 `docs/issue.md`

| #     | 问题                                         | 严重程度     | 优先级 |
| ----- | -------------------------------------------- | ------------ | ------ |
| —     | 🔴 依赖安全：`cargo audit` **13 条**已记录（8 vulnerabilities + 4 unmaintained + 1 unsound + 0 yanked），其中 **1 条真实、三平台、上游无修复**（`RUSTSEC-2023-0071` rsa 0.10.0-rc.18）。`cargo-audit` 已是阻塞门禁。阻塞发布，不阻塞合并。台账 `docs/phase9-1/security-advisories.md` | 🔴 Blocker（发布） | P0 |
| —     | ✅ **六份验收证据已重采并归档**：Phase 9.5.1 因 smoke-only 迁移延迟使指纹变为 `b73c5fd2…`，已用 run `41970525110` 官方重采（commit `225c363`），门禁 0 problem；未手改旧 manifest。任何后续 `FINGERPRINT_PATHS` 改动仍需重采 | ✅ 已闭合 | — |
| —     | ✅ P9.2-9 Linux zsh 探针 **PASS**：run `41432020659` / `41434165000` 的 Linux job 均 success，14 用例全绿（含此前三条）。遗留：空 `$HOME` 的真实 Debian 新账户未测 | ✅ 已闭合 | — |
| 60    | ✅ **macOS 远程冷启动已收口**：G 300/300、第二轮 artifact 300/300（最终 remote 300）、clean 300/300；三个 run 共 **900 样本，0 个最终 local**；隔离/控制组/证据/CI 11/11 均 PASS。仍缺：历史 20% 的 Unified Log、跨版本升级、硬件矩阵、签名、身份迁移 | ✅ 已闭合（冷启动） | — |
| —     | 🟡 **跨版本升级**：Phase 9.5.4 已收紧 stop/quiescence，并以独立 worker 完成 8/8 阶段真实 SIGKILL crash 矩阵与恢复重试；staged restore ENOSPC 已 PASS（隔离卷），备份/迁移/安装 ENOSPC、Windows A→B、app-level Vault、Team Sync 跨版本、updater 运行时、AppImage stock 仍 **NOT_RUN/PARTIAL**。详见 `docs/phase9-5/phase9-5-4-implementation.md` | 🟡 Important（RC） | P1 |
| —     | 🔴 **签名/公证/updater**：Apple notarization、Windows Authenticode、Tauri updater `pubkey` 均 **BLOCKED_EXTERNAL**；updater 运行时下载/安装/重启 **NOT_RUN**；历史 `.sig` 不能替代运行时更新链 | 🔴 Blocker（发布） | P0 |
| —     | 🟡 **身份迁移**：`productName=Termius`、`identifier=com.baicie.termius` 未改；T1–T12 **NOT_RUN/BLOCKED_EXTERNAL**；迁移代码不存在 | 🟡 Important（发布） | P1 |
| —     | ✅ 前端依赖审计已闭合（vuln 25 → 0，新增 CI 阻塞 job）；同步接口与 Share REST 的版本契约统一为 JSON number。详见 `docs/phase9-3/merge-blocker-closure.md` | ✅ 已闭合 | — |
| 57    | 真实 SSH 认证矩阵 ✅ 当前源码（run `41478709578`，sha `3102093`）：debug 11/11、release 8/8、shell 交互 14/14（另 Linux 14 + Windows 5，全矩阵 40 个 probe 用例 0 FAILED） | 🟡 Important | P1 |
| 58    | 物理键盘 30 轮重叠 `a/s/d`、中文 IME、Option/dead key 待人工键入（Ctrl+C、vim、nano、PTY resize、行编辑已在本地 PTY **与真实 SSH** 上自动化覆盖） | 🟡 Important | P1 |
| 21/39 | Windows/Pageant/串口硬件实机矩阵（macOS 与 Linux 的 CI 矩阵已全绿，含 Linux shell-probe 14/14；Windows 只有 PowerShell/cmd 矩阵，Pageant 与串口硬件仍未采） | 🟡 Important | P1 |

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

_文档更新时间: 2026-11-06 (Phase 9.6.3：标记 v3 事务所有权与逐字节回滚、OS 文件锁 + 进程内互斥、真实双进程 E2E、Team 1/3/5/10 SIGKILL E2E、Windows 19 项恢复测试；E2E `42249215589` 5/5，证据 `42245189022` 指纹 `9bad378d…` 门禁 0；剩余已运行实例并发写入与 Windows reparse/ACL/NSIS 为 PARTIAL/NOT_RUN。历史 Phase 9.6.2：迁移标记 fail-closed（损坏/未知版本不覆盖）、备份失败只回滚本次创建、活动快照 pin、`RecoveryLock` 跨进程锁、前端 `getDb` 门禁前置；Windows runner 实跑 `cargo test --lib db_recovery` 9/9 并修复目录 flush `ERROR_ACCESS_DENIED`；E2E `42189361366` 5/5，证据 `42214762202` 指纹 `c138d564…` 门禁 0；真实双进程 E2E、Team 应用级 SIGKILL、Windows 文件系统矩阵/NSIS 仍 NOT_RUN/PARTIAL。历史 Phase 9.6.1：启动门禁 fail-closed、裁决持久化、标记 v2（Core/Team）、完成校验、备份 canonicalization、Windows 目录 fsync；E2E `42179513200`（`efb96aa`）5/5，证据 `42179506989` 指纹 `3fd0148a…`，门禁 0；历史 Phase 9.6：产品启动 `db_recovery` 状态机、部分迁移自动恢复、脱敏恢复 UI；E2E `42146486221` `product recovery=PASS`，证据重采 `42158238718` 指纹 `47c25a03…`，CI `42160597380` 11/11；Windows NSIS/Vault app-level/TeamSync 跨版本/updater/安装 ENOSPC 仍 NOT_RUN/PARTIAL。历史 Phase 9.5.4：真实独立 worker crash 矩阵 8/8 阶段 SIGKILL + control、恢复重试、精确文件集与 integrity/content 读回；Harness 恢复改为 spawn 同一 worker；修复 `Promise.race` 计时器泄漏；E2E `42030992498` 5/5、CI `42031006776` 11/11 对应 `051f8c6`；独立 worker 接入后 E2E `42035362763` 5/5、CI `42035362783` 11/11 对应 `d4b7759`，macOS runner 报告 `restore crash matrix=PASS`；最终 E2E `42037724319` 5/5、CI `42037724332` 11/11 对应 `df57c0c`（代码 `b069beb`），ubuntu runner 真实执行 ENOSPC 测试 457 ms PASS；Phase 9.5.5 补齐进程树 quiescence：停止前快照后代、退出后 2s 收敛，E2E `42047193259`（`10fffd5`）的 10 份报告四项事实全 PASS（macOS + Linux），CI `42047193385` 11/11；Windows disposable、Vault app-level、Team Sync 跨版本、updater 运行时、备份/迁移/安装 ENOSPC、AppImage stock 仍 NOT_RUN/PARTIAL；详见 docs/phase9-5/phase9-5-4-implementation.md 与 phase9-5-5-implementation.md)_

_历史更新 2026-11-03: (Phase 9.3：bootstrap 的五个配置探测由串行改并发，修掉「一个慢 IPC 饿死其余」——这是 real-machine run `41437956656` 上 `nano-edit`「从未写 result.json」的根因；冷启动测量目录清理改带重试，修掉 `ENOTEMPTY` 假红；6 份证据随 run `41478709578` 重采为指纹 `c4faedfb…`，门禁 0 problem；交付 `docs/phase9-3/bootstrap-probe-starvation.md`)_

_历史更新 2026-11-02: (Phase 9.2：修复同步冲突五处 P0 缺陷并加双客户端真实 PG 回归 80 项；`cargo audit` 42 → 13 条（修 29 条，剩 1 条全平台真实且上游无修复），`cargo-audit` 改为阻塞门禁；证据门禁接入 CI 阻塞步骤并在真实 runner 重采 6 份证据（run `41434165000`，指纹 `365bdee7…`，0 problem）；Linux zsh 探针与 macOS 冷启动由真实 runner 实测通过；交付 `docs/phase9-2/` 八份文档)_

_历史更新 2026-11-01: (依赖升级修掉 2/27 条并记录其余 25 条的卡点；Linux zsh P0 定位到 compinit/read -q 机制但闭合为 NOT_RUN；许可证清单已取得，135 个生产依赖零 copyleft；前端漏洞审计仍 NOT_RUN 且更正了归因——是沙箱 403 而非镜像不支持；6 份实机证据因源码指纹变化失效需重采；撤回「生产依赖审计为 0 个已知漏洞」的错误声明；测试基数对齐 `docs/phase9/final-report.md`；补记实机矩阵 Linux 产品门禁仍失败)_

_历史更新 2026-10-30: (六份实机证据改由 GitHub macOS runner 产出，本机不再弹窗采集，门禁绑定 CI manifest；终端配色预设扩到深 16 / 浅 10 并加对比度门禁；浅色默认主题 solarized-light → github-light；本地终端 Shell Integration 改 ZDOTDIR / --rcfile 静默注入，不再回显脚本；release 为 macOS 分架构 DMG（aarch64 / x86_64 各一份），Nightly 通道已移除；人工验收清单见 docs/manual-acceptance-checklist.md)_
