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
| **docs/phase9-5/**            | Phase 9.5 交付：Phase 9.4.2 归档、PR #6/#7 集成方案、真实 dev.1→dev.2 与 dev.1→当前源码升级 E2E、双版本 harness、corrupt/read-only/restart/backup 故障恢复、签名与身份迁移阻塞项 | 接手升级、数据完整性或发布准备时必读 |
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
- ✅ 当前 HEAD CI 升级 run `41980039459`：7/7 报告 PASS；B=`0.0.1-dev.4-local`、source `94f4b32`、DMG SHA `00afd8ff…`
- ✅ 真实中途迁移中断：`agent_forwarding` 提交后、`shell_integration` 前 SIGKILL；重启收敛、字段级验证 PASS
- ✅ 备份恢复：复制 `pre-migration-<epoch>.db`、删除 WAL/SHM、A 启动读回、SHA 一致
- ✅ Linux x64 DEB：真实 `apt-get`/dpkg、`dpkg-query` 版本变化、字段级数据 PASS（run `41972602296`）
- 🟡 Linux AppImage：payload-only job success，**报告为 PARTIAL**（同路径替换 + 替换后 SHA PASS）；headless Xvfb 下 bundled WebKit EGL 启动失败，系统 WebKit 回退又受 bundled GStreamer/GLib 符号版本阻断，启动/迁移显式 NOT_RUN；详见 `docs/phase9-5/linux-upgrade-verification.md`
- 🟡 Windows：只读隔离预检在 `windows-latest` 正确 fail-closed；升级 E2E 仍 NOT_RUN，需一次性 profile/VM
- ✅ 六份实机证据因 smoke-only 迁移延迟变为指纹 `b73c5fd2…`，已用官方流程重采（run `41970525110`，0 problem）；未手改旧 manifest
- 📋 未完成：Windows 升级 E2E、Linux AppImage stock 启动、磁盘满/Linux 故障注入、真实 Vault 解锁、Team Sync 服务端、签名/公证/updater/身份迁移

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
| —     | 🟡 **跨版本升级**：Phase 9.5.1 当前 HEAD CI 7/7 PASS、Linux DEB PASS、真实中途中断/备份恢复 PASS、B→A 读取 PASS；AppImage stock 启动受 headless WebKit EGL 限制、Windows 升级 E2E **NOT_RUN**、磁盘满/Linux 故障注入/自动回滚 **NOT_RUN**。详见 `docs/phase9-5/phase9-5-1-implementation.md` | 🟡 Important（RC） | P1 |
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

_文档更新时间: 2026-11-05 (Phase 9.5.1：故障五事实与独立升级证据门禁；当前 HEAD CI 升级 run `41980039459` 7/7 PASS；真实中途迁移中断、备份恢复、B→A 读取降级 PASS；Linux x64 DEB 真实 dpkg 升级 PASS；AppImage 改为 payload-only（同路径替换/SHA PASS，启动/迁移 NOT_RUN，headless WebKit EGL 限制）；Windows 只读隔离预检 fail-closed，升级 E2E NOT_RUN；六份证据因 smoke-only 迁移延迟重采为指纹 `b73c5fd2…`（run `41970525110`，0 problem）；签名/公证/updater/身份迁移/真实 Vault/Team Sync 服务端仍未闭合；详见 `docs/phase9-5/phase9-5-1-implementation.md`)_

_历史更新 2026-11-03: (Phase 9.3：bootstrap 的五个配置探测由串行改并发，修掉「一个慢 IPC 饿死其余」——这是 real-machine run `41437956656` 上 `nano-edit`「从未写 result.json」的根因；冷启动测量目录清理改带重试，修掉 `ENOTEMPTY` 假红；6 份证据随 run `41478709578` 重采为指纹 `c4faedfb…`，门禁 0 problem；交付 `docs/phase9-3/bootstrap-probe-starvation.md`)_

_历史更新 2026-11-02: (Phase 9.2：修复同步冲突五处 P0 缺陷并加双客户端真实 PG 回归 80 项；`cargo audit` 42 → 13 条（修 29 条，剩 1 条全平台真实且上游无修复），`cargo-audit` 改为阻塞门禁；证据门禁接入 CI 阻塞步骤并在真实 runner 重采 6 份证据（run `41434165000`，指纹 `365bdee7…`，0 problem）；Linux zsh 探针与 macOS 冷启动由真实 runner 实测通过；交付 `docs/phase9-2/` 八份文档)_

_历史更新 2026-11-01: (依赖升级修掉 2/27 条并记录其余 25 条的卡点；Linux zsh P0 定位到 compinit/read -q 机制但闭合为 NOT_RUN；许可证清单已取得，135 个生产依赖零 copyleft；前端漏洞审计仍 NOT_RUN 且更正了归因——是沙箱 403 而非镜像不支持；6 份实机证据因源码指纹变化失效需重采；撤回「生产依赖审计为 0 个已知漏洞」的错误声明；测试基数对齐 `docs/phase9/final-report.md`；补记实机矩阵 Linux 产品门禁仍失败)_

_历史更新 2026-10-30: (六份实机证据改由 GitHub macOS runner 产出，本机不再弹窗采集，门禁绑定 CI manifest；终端配色预设扩到深 16 / 浅 10 并加对比度门禁；浅色默认主题 solarized-light → github-light；本地终端 Shell Integration 改 ZDOTDIR / --rcfile 静默注入，不再回显脚本；release 为 macOS 分架构 DMG（aarch64 / x86_64 各一份），Nightly 通道已移除；人工验收清单见 docs/manual-acceptance-checklist.md)_
