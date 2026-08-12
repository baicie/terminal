# Terminal 前端架构设计方案

> 文档版本: v1.0
> 创建日期: 2026-04-15
> 状态: 待实施

---

## 一、现状问题分析

### 1.1 文件行数统计

| 文件路径 | 当前行数 | 问题类型 | 优先级 |
|---------|---------|---------|--------|
| `service/ssh.ts` | 517 | 职责过重 | P0 |
| `hooks/use-terminal.ts` | 302 | 职责过重 | P0 |
| `components/terminal-tool-sidebar/index.tsx` | 319 | 职责过重 | P1 |
| `view/terminal/terminal-container.tsx` | 313 | 职责过重 | P1 |
| `service/serial.ts` | 131 | 可接受 | P2 |

### 1.2 具体问题

#### 问题 1: `service/ssh.ts` 职责过重

```
service/ssh.ts (517行)
├── SSH 连接管理
├── 本地终端管理
├── SFTP 操作 (connect, list, upload, download, mkdir, delete, rename)
├── 端口转发操作 (start, stop, list)
├── 命令历史记录
├── 连接日志管理
└── 事件监听 (onData, onClose, onExit)
```

**问题**: 一个文件承担了 6 个不同业务域的职责。

#### 问题 2: `hooks/use-terminal.ts` 职责过重

```
hooks/use-terminal.ts (302行)
├── 连接类型判断 (local/ssh/serial)
├── Shell 启动逻辑
├── 数据流处理
├── 事件监听
├── Resize 处理
└── 清理逻辑
```

**问题**: Hook 中混合了连接逻辑、数据流处理、事件监听等多种关注点。

#### 问题 3: `terminal-container.tsx` 组件过大

```
view/terminal/terminal-container.tsx (313行)
├── xterm.js 初始化
├── 插件加载 (FitAddon, SearchAddon, WebLinksAddon, Unicode11Addon, ClipboardAddon)
├── 主题切换
├── ResizeObserver 处理
├── 移动端键盘栏集成
└── 全屏模式支持
```

**问题**: 组件承担了过多非 UI 逻辑。

#### 问题 4: `terminal-tool-sidebar` 职责过重

```
components/terminal-tool-sidebar/index.tsx (319行)
├── Snippet 列表展示
├── Snippet 执行 + 变量替换
├── 命令历史列表
├── 命令重新执行
├── 搜索过滤
└── Tab 切换
```

**问题**: Snippet 和历史命令混在一起，各自有独立逻辑。

---

## 二、架构设计目标

### 2.1 设计原则

| 原则 | 说明 |
|------|------|
| **单一职责** | 每个模块只负责一件事 |
| **关注点分离** | UI 逻辑、业务逻辑、数据逻辑分离 |
| **高内聚低耦合** | 相关代码放一起，不相关代码分开 |
| **可测试性** | 拆分后各模块可独立测试 |
| **可维护性** | 未来修改只需改一个地方 |

### 2.2 行数控制目标

| 文件类型 | 最大行数 |
|---------|---------|
| Service 类 | 150 行 |
| Hook | 100 行 |
| UI 组件 | 200 行 |
| 工具函数 | 100 行 |

---

## 三、新架构设计

### 3.1 整体目录结构

```
src/
├── features/
│   └── terminal/
│       ├── components/                    # 终端 UI 组件
│       │   ├── terminal-container/        # 终端容器
│       │   │   ├── index.tsx              # 入口导出
│       │   │   ├── container.tsx          # 主容器组件 (~150行)
│       │   │   ├── plugins.ts              # xterm 插件配置 (~80行)
│       │   │   ├── theme.tsx               # 主题处理 (~50行)
│       │   │   └── keyboard-bar.tsx        # 移动端键盘栏
│       │   │
│       │   ├── terminal-tool-sidebar/     # 工具侧边栏
│       │   │   ├── index.tsx              # 入口导出
│       │   │   ├── sidebar-tabs.tsx        # Tab 切换
│       │   │   ├── snippet-panel.tsx        # Snippet 面板
│       │   │   ├── history-panel.tsx        # 历史命令面板
│       │   │   └── variable-replacer.ts    # 变量替换逻辑
│       │   │
│       │   └── serial-dialog/              # 串口对话框
│       │       ├── index.tsx              # 入口导出
│       │       ├── port-select.tsx         # 端口选择
│       │       └── config-form.tsx         # 配置表单
│       │
│       ├── hooks/                         # 终端相关 Hooks
│       │   ├── use-terminal-session.ts     # 会话管理核心 (~100行)
│       │   ├── use-terminal-events.ts      # 事件处理 (~80行)
│       │   ├── use-terminal-resize.ts     # Resize 处理 (~50行)
│       │   └── index.ts                   # 统一导出
│       │
│       ├── services/                      # 终端业务服务
│       │   ├── session.ts                  # 会话管理 (~150行)
│       │   ├── sftp.ts                    # SFTP 操作 (~120行)
│       │   ├── port-forward.ts             # 端口转发 (~60行)
│       │   ├── serial.ts                  # 串口操作 (~80行)
│       │   ├── connection-log.ts           # 连接日志 (~50行)
│       │   └── index.ts                   # 统一导出
│       │
│       ├── stores/                        # 状态管理
│       │   ├── terminal-session.ts         # 会话状态 (~100行)
│       │   ├── terminal-settings.ts        # 终端设置 (~60行)
│       │   └── index.ts                   # 统一导出
│       │
│       ├── contexts/                      # React Context
│       │   ├── terminal-write-context.ts   # 终端写入上下文
│       │   ├── terminal-theme-context.ts   # 主题上下文
│       │   └── index.ts                   # 统一导出
│       │
│       ├── types/                         # 类型定义
│       │   ├── session.ts                 # 会话类型
│       │   ├── sftp.ts                    # SFTP 类型
│       │   ├── port-forward.ts            # 端口转发类型
│       │   ├── serial.ts                  # 串口类型
│       │   └── index.ts                  # 统一导出
│       │
│       └── utils/                        # 工具函数
│           ├── themes.ts                  # 终端主题 (~200行)
│           ├── escape.ts                  # 特殊字符转义
│           └── index.ts                  # 统一导出
│
├── shared/                              # 共享模块
│   └── components/
│       └── serial-dialog/                 # 串口对话框 (如需全局使用)
│
└── view/
    └── terminal/                         # 视图入口
        ├── index.tsx                      # 导出聚合
        └── terminal-settings.tsx          # 设置面板 (~150行)
```

### 3.2 架构分层图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           视图层 (View Layer)                           │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  view/terminal/                                                 │  │
│  │  ├── TerminalSettings                                          │  │
│  │  └── TerminalView (入口)                                        │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                  │                                     │
│                                  ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  features/terminal/components/                                   │  │
│  │  ├── TerminalContainer ────────────────────▶ xterm.js 实例       │  │
│  │  ├── TerminalToolSidebar ────────────────▶ Snippet/历史面板     │  │
│  │  └── SerialDialog ───────────────────────▶ 串口连接表单         │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Hook 层 (Hook Layer)                           │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  features/terminal/hooks/                                        │  │
│  │  ├── useTerminalSession ────────────────▶ 会话生命周期管理       │  │
│  │  ├── useTerminalEvents ────────────────▶ 数据流 & 事件监听      │  │
│  │  └── useTerminalResize ────────────────▶ ResizeObserver 处理    │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           服务层 (Service Layer)                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  features/terminal/services/                                     │  │
│  │  ├── session.ts ─────────────────────────▶ 会话 CRUD 操作        │  │
│  │  ├── sftp.ts ──────────────────────────▶ SFTP 操作              │  │
│  │  ├── port-forward.ts ──────────────────▶ 端口转发               │  │
│  │  ├── serial.ts ─────────────────────────▶ 串口操作              │  │
│  │  └── connection-log.ts ─────────────────▶ 连接日志               │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           状态层 (State Layer)                          │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  features/terminal/stores/                                       │  │
│  │  ├── terminal-session.ts (Zustand) ──────▶ 多会话状态管理       │  │
│  │  └── terminal-settings.ts (Zustand) ─────▶ 设置状态管理          │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Tauri 后端 (Rust)                             │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  src-tauri/src/                                                 │  │
│  │  ├── session_* (会话命令)                                       │  │
│  │  ├── sftp_* (SFTP 命令)                                        │  │
│  │  ├── serial_* (串口命令)                                        │  │
│  │  └── port_forward_* (端口转发命令)                               │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 四、核心模块设计

### 4.1 Services 层

#### 4.1.1 SessionService (`services/session.ts`)

```typescript
// 会话管理 - 核心服务
export class SessionService {
  // 创建会话
  createLocal(cols: number, rows: number): Promise<string>
  createSshPassword(config: SshConfig): Promise<string>
  createSshKey(config: SshKeyConfig): Promise<string>
  createSshJump(config: JumpHostConfig): Promise<string>

  // 会话操作
  write(sessionId: string, data: string): Promise<void>
  resize(sessionId: string, cols: number, rows: number): Promise<void>
  close(sessionId: string): Promise<void>

  // 会话查询
  list(): Promise<SessionInfo[]>
  get(sessionId: string): Promise<SessionInfo | null>
}
```

#### 4.1.2 SftpService (`services/sftp.ts`)

```typescript
// SFTP 操作服务
export class SftpService {
  connect(sessionId: string): Promise<void>
  disconnect(sessionId: string): Promise<void>

  // 文件操作
  list(sessionId: string, path: string): Promise<SftpFile[]>
  upload(sessionId: string, local: string, remote: string): Promise<void>
  download(sessionId: string, remote: string, local: string): Promise<void>
  mkdir(sessionId: string, path: string): Promise<void>
  delete(sessionId: string, path: string, isDir: boolean): Promise<void>
  rename(sessionId: string, oldPath: string, newPath: string): Promise<void>
}
```

#### 4.1.3 PortForwardService (`services/port-forward.ts`)

```typescript
// 端口转发服务
export class PortForwardService {
  start(sessionId: string, config: PortForwardConfig): Promise<void>
  stop(forwardId: string): Promise<void>
  list(): Promise<PortForwardInfo[]>
}
```

#### 4.1.4 SerialService (`services/serial.ts`)

```typescript
// 串口操作服务
export class SerialService {
  // 端口管理
  listPorts(): Promise<SerialPort[]>
  getBaudRates(): number[]

  // 连接管理
  connect(config: SerialConfig): Promise<string>
  disconnect(sessionId: string): Promise<void>
  isConnected(sessionId: string): Promise<boolean>

  // 数据操作
  write(sessionId: string, data: string): Promise<void>
  writeRaw(sessionId: string, data: Uint8Array): Promise<void>

  // 事件监听
  onData(callback: (data: string) => void): Promise<UnlistenFn>
  onClose(callback: (sessionId: string) => void): Promise<UnlistenFn>
}
```

### 4.2 Hooks 层

#### 4.2.1 useTerminalSession (`hooks/use-terminal-session.ts`)

```typescript
// 会话生命周期管理
export function useTerminalSession(options: {
  tabType: 'local' | 'remote' | 'serial'
  host?: Host
  serialSessionId?: string
  cols?: number
  rows?: number
}): {
  sessionId: string | null
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
  error: string | null
  connect: () => Promise<void>
  disconnect: () => Promise<void>
}
```

#### 4.2.2 useTerminalEvents (`hooks/use-terminal-events.ts`)

```typescript
// 终端事件处理
export function useTerminalEvents(options: {
  term: Terminal | null
  sessionId: string | null
  tabType: 'local' | 'remote' | 'serial'
}): {
  write: (data: string) => void
  cleanup: () => void
}
```

#### 4.2.3 useTerminalResize (`hooks/use-terminal-resize.ts`)

```typescript
// 终端 Resize 处理
export function useTerminalResize(options: {
  term: Terminal | null
  sessionId: string | null
  containerRef: RefObject<HTMLElement>
}): void
```

### 4.3 Stores 层

#### 4.3.1 TerminalSessionStore (`stores/terminal-session.ts`)

```typescript
// 会话状态管理 (Zustand)
interface TerminalSessionStore {
  // State
  sessions: Map<string, TerminalSession>

  // Actions
  createSession(tabId: string, terminal: XTerminal): string
  connect(sessionId: string, host: Host | null, cols?: number, rows?: number): Promise<Result>
  disconnect(sessionId: string): Promise<void>
  removeSession(sessionId: string): void
  updateTerminal(sessionId: string, terminal: XTerminal): void

  // Selectors
  getSession(sessionId: string): TerminalSession | undefined
  getSessionByTabId(tabId: string): TerminalSession | undefined
}
```

#### 4.3.2 TerminalSettingsStore (`stores/terminal-settings.ts`)

```typescript
// 终端设置状态管理 (Zustand)
interface TerminalSettingsStore {
  // State
  fontSize: number
  fontFamily: string
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
  scrollback: number
  theme: TerminalThemePreset

  // Actions
  setFontSize(size: number): void
  setFontFamily(family: string): void
  setCursorStyle(style: 'block' | 'underline' | 'bar'): void
  setCursorBlink(blink: boolean): void
  setScrollback(lines: number): void
  setTheme(theme: TerminalThemePreset): void

  // Computed
  getXtermOptions(): TerminalInitOnlyOptions
}
```

### 4.4 Types 层

#### 4.4.1 session.ts

```typescript
// 会话相关类型
export interface SessionInfo {
  id: string
  session_type: 'local' | 'ssh'
  is_alive: boolean
  created_at: number
}

export interface ShellOutput {
  session_id: string
  data: string
  is_stderr: boolean
}

export interface SshConfig {
  host: string
  port: number
  username: string
  password: string
  cols?: number
  rows?: number
}

export interface SshKeyConfig extends SshConfig {
  privateKey: string
}

export interface JumpHostConfig {
  targetHost: string
  targetPort: number
  targetUsername: string
  targetPassword?: string
  targetPrivateKey?: string
  jumpHost: {
    host: string
    port: number
    username: string
    authType: 'password' | 'key'
    password?: string
    privateKey?: string
  }
}
```

#### 4.4.2 sftp.ts

```typescript
// SFTP 相关类型
export interface SftpFile {
  name: string
  path: string
  is_directory: boolean
  size: number
  modified_time: number
  permissions: string
}
```

#### 4.4.3 serial.ts

```typescript
// 串口相关类型
export interface SerialPort {
  name: string
  port_type: string
}

export interface SerialConfig {
  name: string
  baudRate: number
  dataBits: 5 | 6 | 7 | 8
  stopBits: 1 | 2
  parity: 'none' | 'even' | 'odd'
  flowControl: 'none' | 'hardware' | 'software'
}
```

---

## 五、组件拆分设计

### 5.1 TerminalContainer 拆分

```
components/terminal-container/
├── index.tsx              # 入口，组合各部分 (~50行)
├── container.tsx          # 核心: xterm 实例管理 (~120行)
├── plugins.ts             # 插件配置 (~80行)
├── theme.tsx              # 主题处理 (~50行)
└── keyboard-bar.tsx       # 移动端虚拟键盘 (~200行)
```

#### container.tsx 目标结构

```tsx
// container.tsx - 目标 ~120行
const TerminalContainer: React.FC<Props> = ({ tab, host }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerminal | null>(null)

  // 1. 初始化 xterm 实例
  useEffect(() => {
    const term = new Terminal({ ... })
    term.open(containerRef.current!)
    termRef.current = term
    return () => term.dispose()
  }, [])

  // 2. 加载插件
  useXtermPlugins(termRef.current)

  // 3. 会话连接
  const { sessionId, status, connect, disconnect } = useTerminalSession({
    tabType: tab.type,
    host,
  })

  // 4. 事件处理
  useTerminalEvents({
    term: termRef.current,
    sessionId,
    tabType: tab.type,
  })

  // 5. Resize 处理
  useTerminalResize({
    term: termRef.current,
    sessionId,
    containerRef,
  })

  return <div ref={containerRef} className="h-full w-full" />
}
```

### 5.2 TerminalToolSidebar 拆分

```
components/terminal-tool-sidebar/
├── index.tsx              # 入口，Tabs 切换 (~80行)
├── sidebar-tabs.tsx       # Tab 切换器
├── snippet-panel.tsx      # Snippet 面板 (~120行)
├── history-panel.tsx      # 历史命令面板 (~100行)
└── variable-replacer.ts   # 变量替换逻辑 (~60行)
```

---

## 六、迁移策略

### Phase 1: 类型重构 (预计 0.5 天)

**目标**: 创建统一的类型定义

```
1. 创建 features/terminal/types/ 目录
2. 从现有文件中提取类型:
   - service/ssh.ts → types/session.ts
   - service/database/types.ts → types/terminal-settings.ts
3. 创建 index.ts 统一导出
4. 更新所有 import 路径
```

**产物**:
- `types/session.ts` (~50行)
- `types/sftp.ts` (~30行)
- `types/port-forward.ts` (~20行)
- `types/serial.ts` (~30行)
- `types/index.ts` (~20行)

### Phase 2: Services 拆分 (预计 1 天)

**目标**: 将 ssh.ts 拆分为独立服务

```
1. 创建 features/terminal/services/ 目录
2. 提取 session.ts:
   - 会话创建 (createLocal, createSsh*)
   - 会话操作 (write, resize, close)
   - 会话查询 (list)
   - 事件监听 (onData, onClose)
3. 提取 sftp.ts:
   - SFTP 操作 (connect, list, upload...)
4. 提取 port-forward.ts:
   - 端口转发 (start, stop, list)
5. 提取 connection-log.ts:
   - 连接日志 (add, update)
6. 创建 index.ts 导出
7. 更新 ssh.ts 为 facade 或删除
```

**产物**:
- `services/session.ts` (~150行)
- `services/sftp.ts` (~120行)
- `services/port-forward.ts` (~60行)
- `services/connection-log.ts` (~50行)
- `services/index.ts` (~20行)

### Phase 3: Hooks 拆分 (预计 0.5 天)

**目标**: 拆分 use-terminal.ts

```
1. 创建 features/terminal/hooks/ 目录
2. 提取 use-terminal-session.ts:
   - 会话创建逻辑
   - 连接状态管理
3. 提取 use-terminal-events.ts:
   - 数据流处理
   - 事件监听
   - zsh transient prompt 过滤
4. 提取 use-terminal-resize.ts:
   - ResizeObserver 处理
5. 创建 index.ts 导出
```

**产物**:
- `hooks/use-terminal-session.ts` (~100行)
- `hooks/use-terminal-events.ts` (~80行)
- `hooks/use-terminal-resize.ts` (~50行)
- `hooks/index.ts` (~20行)

### Phase 4: 组件拆分 (预计 1 天)

**目标**: 拆分大型组件

```
1. 拆分 terminal-container:
   - container.tsx (~120行)
   - plugins.ts (~80行)
   - theme.tsx (~50行)
   - keyboard-bar.tsx (~200行)
   - index.tsx (~50行)

2. 拆分 terminal-tool-sidebar:
   - index.tsx (~80行)
   - snippet-panel.tsx (~120行)
   - history-panel.tsx (~100行)
   - variable-replacer.ts (~60行)

3. 拆分 serial-dialog:
   - index.tsx (~150行)
   - port-select.tsx (~50行)
   - config-form.tsx (~80行)
```

### Phase 5: Stores 迁移 (预计 0.5 天)

**目标**: 迁移到 features/terminal/stores/

```
1. 迁移 store/terminal.ts → stores/terminal-session.ts
2. 创建 stores/terminal-settings.ts
3. 更新所有引用
```

### Phase 6: 清理与测试 (预计 0.5 天)

**目标**: 删除旧文件，验证功能

```
1. 删除旧文件:
   - service/ssh.ts
   - hooks/use-terminal.ts
   - store/terminal.ts
2. 验证所有功能正常
3. 更新 AGENTS.md 文档
```

---

## 七、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 迁移过程中功能破坏 | 高 | 每个 phase 后验证功能 |
| import 路径变更导致大量错误 | 中 | 使用 IDE 重构工具批量替换 |
| 状态管理逻辑丢失 | 高 | 保留旧 store 直到新 store 验证通过 |
| 移动端键盘栏行为改变 | 中 | 单独测试移动端场景 |

---

## 八、验收标准

### 8.1 功能验收

- [ ] 本地终端连接正常
- [ ] SSH 密码认证连接正常
- [ ] SSH 密钥认证连接正常
- [ ] SFTP 文件传输正常
- [ ] 端口转发正常
- [ ] 串口连接正常
- [ ] 命令历史保存正常
- [ ] Snippet 执行正常
- [ ] 移动端键盘栏正常
- [ ] 主题切换正常

### 8.2 代码质量验收

- [ ] 所有 Service 文件 < 150 行
- [ ] 所有 Hook 文件 < 100 行
- [ ] 所有 UI 组件 < 200 行
- [ ] 无 ESLint 错误
- [ ] 类型定义完整

### 8.3 性能验收

- [ ] 终端输入延迟 < 10ms
- [ ] 终端启动时间 < 500ms
- [ ] 无内存泄漏

---

## 九、附录

### A. 文件变更清单

| 操作 | 文件路径 |
|------|---------|
| 新增 | `features/terminal/types/*.ts` |
| 新增 | `features/terminal/services/*.ts` |
| 新增 | `features/terminal/hooks/*.ts` |
| 新增 | `features/terminal/stores/*.ts` |
| 新增 | `features/terminal/components/terminal-container/*.ts` |
| 新增 | `features/terminal/components/terminal-tool-sidebar/*.ts` |
| 新增 | `features/terminal/components/serial-dialog/*.ts` |
| 新增 | `features/terminal/contexts/*.ts` |
| 新增 | `features/terminal/utils/*.ts` |
| 修改 | `view/terminal/*` |
| 删除 | `service/ssh.ts` |
| 删除 | `hooks/use-terminal.ts` |
| 删除 | `store/terminal.ts` |
| 删除 | `components/terminal-tool-sidebar/index.tsx` |
| 删除 | `view/terminal/terminal-container.tsx` |
| 删除 | `view/terminal/terminal-keyboard-bar.tsx` |
| 删除 | `view/terminal/terminal-write-context.ts` |

### B. 依赖关系图 (迁移后)

```
view/terminal/
    │
    ▼
features/terminal/components/
    │
    ├─► TerminalContainer ──────────────► hooks/use-terminal-*
    │                                      │
    │                                      ├─► services/session.ts
    │                                      │
    │                                      ├─► services/sftp.ts
    │                                      │
    │                                      └─► stores/terminal-session.ts
    │
    ├─► TerminalToolSidebar ───────────► services/terminal-emitter.ts
    │                                      │
    │                                      └─► hooks/use-terminal-session.ts
    │
    └─► SerialDialog ───────────────────► services/serial.ts
```

---

## 当前落地状态 (2026-08-12)

本方案中“会话生命周期独立于 React 视图”的核心目标已落地，当前实现采用以下边界：

```text
TerminalByUrl (主布局常驻)
    |
    +-- TerminalContainer (xterm surface / UI)
    |       |
    |       +-- useTerminal (输入、输出、resize、状态绑定)
    |       +-- TerminalToolbar / TerminalToolSidebar (自绘工作台)
    |
    +-- TerminalSessionManager (按 tabId 管理会话)
            +-- TerminalSessionEvents (Tauri 事件监听)
            +-- terminal-launcher (local / SSH / serial 启动)
            +-- sessionService (后端写入、resize、close)
```

- `packages/frontend/src/features/terminal/services/terminal-session-manager.ts` 持有 session 生命周期，不随路由卸载。
- `packages/frontend/src/features/terminal/services/terminal-session-events.ts` 按终端类型复用 data/close/exit 监听，并缓冲 session 建立前的输出。
- `packages/frontend/src/layout/terminal-by-url.tsx` 常驻终端层；非终端路由只隐藏并禁用交互，删除标签时由 `prune()` 回收会话。
- `packages/frontend/src/service/terminal-emitter.ts` 按活动标签定向发送命令。
- `components/terminal-container/` 中的 UI 是项目自绘工作台，参考项目只用于会话生命周期和交互结构，不复用其视觉实现。

当前自动验证覆盖管理器单元测试、typecheck、lint、源码行数门禁和浏览器布局检查。浏览器直开无法提供 Tauri IPC；Windows/Linux、Pageant、Jump Host、本地 PTY 和串口硬件仍需桌面实机验证。

## 十一、文档版本历史

| 版本 | 日期 | 作者 | 变更说明 |
|------|------|------|---------|
| v1.0 | 2026-04-15 | Claude | 初始版本 |
| v1.1 | 2026-08-12 | Codex | 补充按 tabId 管理会话的实际落地架构 |

---

_文档更新时间: 2026-08-12_
