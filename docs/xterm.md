# xterm.js AI 使用指南

> 本文档详细说明 xterm.js 的 API、插件系统和使用规范，供 AI Agent 开发时参考
> 官方文档: https://xtermjs.org/
> 上游 API 版本: 6.0.0 (2025-12)；项目核心包: `@baicie/xterm@0.1.7`
> 文档更新时间: 2026-08-26

---

## 一、项目现状

### 已集成的插件

项目已在 `package.json` 中配置以下 xterm.js 插件：

| 插件                     | 版本   | 用途                                  | 状态      |
| ------------------------ | ------ | ------------------------------------- | --------- |
| `@baicie/xterm`          | 0.1.7  | WKWebView 重叠按键兼容核心（精确固定） | ✅ 已使用 |
| `@xterm/addon-fit`       | 0.11.0 | 自动调整终端大小                      | ✅ 已使用 |
| `@xterm/addon-search`    | 0.16.0 | 终端内搜索                            | ✅ 已使用 |
| `@xterm/addon-web-links` | 0.12.0 | 链接检测与点击                        | ✅ 已使用 |
| `@xterm/addon-clipboard` | ^0.2.0 | 剪贴板集成                            | ✅ 已使用 |
| `@xterm/addon-webgl`     | 0.19.0 | WebGL 加速渲染                        | ✅ 已安装 |
| `@xterm/addon-image`     | 0.9.0  | 图片支持                              | ✅ 已安装 |
| `@xterm/addon-unicode11` | 0.9.0  | Unicode 11 支持                       | ✅ 已安装 |
| `@xterm/addon-ligatures` | 0.10.0 | 连字字体支持                          | ✅ 已安装 |

### 核心包兼容契约

`@baicie/xterm@0.1.7` 是项目维护的 WebKit 键盘兼容分支，运行时版本标识为 xterm 6.0.0。它在 xterm 内部 `_keyDown`、`_keyUp` 和 `_inputEvent` 路径使用 `AppleWebKit` 检测，让 macOS Tauri WKWebView 在重叠按键时继续产生原生 `input` 数据；官方 `@xterm/xterm@6.0.0` 不包含这条修复，不能直接替换。

- `packages/frontend/package.json` 必须精确固定 `"@baicie/xterm": "0.1.7"`，禁止使用 `^` 或同时直接依赖 `@xterm/xterm`。
- 构造器和 CSS 必须都从 `@baicie/xterm` 导入；官方 `@xterm/addon-*` 继续使用。
- 发布包 typings 错误地声明上游模块名，必须保留 `packages/frontend/src/types/xterm.d.ts` 的 ambient re-export。
- OSC/CSI 等自定义解析器必须从 `term.parser` 注册，例如 `term.parser.registerOscHandler(...)`；`Terminal` 本身没有 `registerOscHandler`。
- `xterm-package-contract.test.ts` 只锁定依赖契约；jsdom、合成键盘事件和 `term.input()` 都不能证明物理重叠按键。发布前仍需在 macOS WKWebView 中近同时按下 `a/s/d`、快速连续输入并验证物理 IME。
- `0.1.7` 发布物仍含 WebKit 输入 `console.debug`，且 npm 仓库元数据不可追溯；后续应从有明确上游 commit 的源码仓库发布无诊断日志版本。

### 当前使用位置

主要在 `packages/frontend/src/features/terminal/components/terminal-container/` 中使用：

```typescript
import { Terminal } from '@baicie/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@baicie/xterm/css/xterm.css'
```

---

## 二、核心 API 详解

### 2.1 Terminal 构造函数

```typescript
const term = new Terminal(options?: ITerminalOptions);
```

**常用配置选项** (ITerminalOptions):

| 选项                            | 类型                            | 默认值   | 说明                 |
| ------------------------------- | ------------------------------- | -------- | -------------------- |
| `cursorBlink`                   | boolean                         | false    | 光标闪烁             |
| `cursorStyle`                   | "block" \| "underline" \| "bar" | "block"  | 光标样式             |
| `cursorWidth`                   | number                          | -        | bar 光标宽度         |
| `fontSize`                      | number                          | -        | 字体大小             |
| `fontFamily`                    | string                          | -        | 字体系列             |
| `fontWeight`                    | FontWeight                      | "normal" | 字体粗细             |
| `fontWeightBold`                | FontWeight                      | "bold"   | 粗体字体粗细         |
| `letterSpacing`                 | number                          | -        | 字符间距(px)         |
| `lineHeight`                    | number                          | -        | 行高                 |
| `theme`                         | ITheme                          | -        | 颜色主题             |
| `scrollback`                    | number                          | 1000     | 回滚行数             |
| `scrollSensitivity`             | number                          | 1        | 滚动灵敏度           |
| `fastScrollSensitivity`         | number                          | 5        | 快速滚动灵敏度       |
| `scrollOnUserInput`             | boolean                         | true     | 用户输入时滚动到底部 |
| `macOptionIsMeta`               | boolean                         | false    | Option 作为 Meta 键  |
| `macOptionClickForcesSelection` | boolean                         | false    | Option+点击强制选择  |
| `rightClickSelectsWord`         | boolean                         | true     | 右键选择单词         |
| `allowTransparency`             | boolean                         | false    | 透明背景             |
| `disableStdin`                  | boolean                         | false    | 禁用输入             |
| `convertEol`                    | boolean                         | false    | 自动转换换行符       |
| `tabStopWidth`                  | number                          | 8        | Tab 宽度             |
| `screenReaderMode`              | boolean                         | false    | 屏幕阅读器模式       |
| `minimumContrastRatio`          | number                          | 1        | 最小对比度           |
| `allowProposedApi`              | boolean                         | false    | 允许实验性 API       |
| `overviewRuler`                 | IOverviewRulerOptions           | -        | 概览标尺             |

### 2.2 ITheme 主题配置

```typescript
interface ITheme {
  foreground?: string // 默认前景色
  background?: string // 默认背景色
  cursor?: string // 光标颜色
  cursorAccent?: string // 光标强调色（块光标前景色）
  selectionBackground?: string // 选中背景色
  selectionForeground?: string // 选中前景色
  selectionInactiveBackground?: string // 非焦点选中背景
  black?: string // ANSI 黑色
  red?: string // ANSI 红色
  green?: string // ANSI 绿色
  yellow?: string // ANSI 黄色
  blue?: string // ANSI 蓝色
  magenta?: string // ANSI 洋红
  cyan?: string // ANSI 青色
  white?: string // ANSI 白色
  brightBlack?: string // 亮黑色
  brightRed?: string // 亮红色
  brightGreen?: string // 亮绿色
  brightYellow?: string // 亮黄色
  brightBlue?: string // 亮蓝色
  brightMagenta?: string // 亮洋红
  brightCyan?: string // 亮青色
  brightWhite?: string // 亮白色
  extendedAnsi?: string[] // 扩展 ANSI (16-255)
}
```

**项目当前使用的主题** (VS Code Dark+ 风格):

```typescript
const term = new Terminal({
  theme: {
    background: '#1e1e1e',
    foreground: '#cccccc',
    cursor: '#ffffff',
    cursorAccent: '#1e1e1e',
    selectionBackground: '#264f78',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#ffffff',
  },
})
```

### 2.3 核心方法

#### 生命周期

```typescript
// 打开终端到指定 DOM 元素（必须在 DOM 中可见才能正确计算尺寸）
term.open(container: HTMLElement): void

// 释放终端，清理所有事件监听和资源
term.dispose(): void

// 重置终端状态（清屏，重置模式）
term.reset(): void
```

#### 数据读写

```typescript
// 写入数据到终端（支持 VT 序列）
term.write(data: string | Uint8Array): void

// 写入数据并在新行开始（自动添加 \r\n）
term.writeln(data: string): void

// 清除终端内容
term.clear(): void
```

#### 尺寸调整

```typescript
// 调整终端行列数
term.resize(cols: number, rows: number): void

// 获取终端列数
term.cols: number

// 获取终端行数
term.rows: number
```

#### 选择操作

```typescript
// 选中所有内容
term.selectAll(): void

// 选中指定范围
term.select(startColumn: number, endColumn: number, rows: number): void

// 选中指定行
term.selectLines(startLine: number, endLine: number): void

// 获取选中文本
term.getSelection(): string

// 清除选中
term.clearSelection(): void

// 是否已选中
term.hasSelection(): boolean
```

#### 滚动操作

```typescript
// 滚动到顶部
term.scrollToTop(): void

// 滚动到底部
term.scrollToBottom(): void

// 向上滚动指定行
term.scrollLines(lines: number): void

// 向下滚动指定页
term.scrollPages(pages: number): void

// 滚动到指定行
term.scrollToLine(line: number): void
```

#### 光标操作

```typescript
// 聚焦终端
term.focus(): void

// 是否聚焦
term.hasFocus: boolean

// 刷新终端显示
term.refresh(start: number, end: number): void

// 渲染选项
term.renderState: RenderState
```

### 2.4 事件系统

xterm.js 使用 `IEvent` 模式，类似 Node.js 的 EventEmitter：

```typescript
// 常用事件
term.onData(callback: (data: string) => void): IDisposable
// 原始键盘/鼠标控制字节；每个 JS 字符代表一个 0..255 字节
term.onBinary(callback: (data: string) => void): IDisposable
term.onResize(callback: (data: { cols: number; rows: number }) => void): IDisposable
term.onScroll(callback: (scrollY: number) => void): IDisposable
term.onTitleChange(callback: (title: string) => void): IDisposable
term.onBell(callback: () => void): IDisposable
term.onCursorMove(callback: () => void): IDisposable
term.onSelectionChange(callback: () => void): IDisposable
term.onFocusChange(callback: (focused: boolean) => void): IDisposable
term.onKey(callback: (event: { key: string; domEvent: KeyboardEvent }) => void): IDisposable
term.onMouse(e: MouseEventType, callback: MouseCallback): IDisposable
```

**项目中使用的事件示例** (`terminal-container.tsx`):

```typescript
// 处理文本输入；不要在这里解释 Tab、方向键或 shell 历史
terminal.current.onData(data => {
  terminalSession.write(data)
})

// 处理 xterm 无法表示为文本的原始字节
terminal.current.onBinary(data => {
  const bytes = Uint8Array.from(data, char => char.charCodeAt(0) & 0xff)
  terminalSession.writeRaw(bytes)
})

// 处理终端大小变化
terminal.current.onResize(({ cols, rows }) => {
  sshService.resize(sessionId, cols, rows)
})
```

### 2.5 Buffer 缓冲区

终端维护两个缓冲区（活动缓冲区和备用缓冲区）：

```typescript
// 获取活动缓冲区
term.buffer: IBufferNamespace

// 活动缓冲区
term.buffer.active: IBuffer

// 备用缓冲区
term.buffer.alt: IBuffer

// 缓冲区常用属性
term.buffer.active.type: 'primary' | 'alternate'  // 当前缓冲区类型
term.buffer.active.cursorY: number                 // 光标 Y 位置
term.buffer.active.cursorX: number                 // 光标 X 位置
term.buffer.active.length: number                  // 缓冲行数
term.buffer.active.getLine(index: number): IBufferLine | undefined

// 遍历缓冲区行（项目中的使用示例）
const line = term.buffer.active.getLine(cursorY);
if (line) {
  for (let x = 0; x < term.cols; x++) {
    const cell = line.getCell(x);
    const char = cell.getChars();
  }
}
```

---

## 三、插件系统

### 3.1 插件工作原理

插件通过 `loadAddon()` 方法加载：

```typescript
const addon = new SomeAddon()
term.loadAddon(addon)
```

每个插件需要实现 `ITerminalAddon` 接口：

```typescript
interface ITerminalAddon {
  activate(terminal: Terminal): void
  dispose(): void
}
```

### 3.2 FitAddon - 自适应大小

**用途**: 自动调整终端尺寸以填满容器

**安装**: 已安装 `@xterm/addon-fit@^0.11.0`

**使用**:

```typescript
import { FitAddon } from '@xterm/addon-fit'

const term = new Terminal()
const fitAddon = new FitAddon()
term.loadAddon(fitAddon)

term.open(document.getElementById('terminal-container'))

// 首次打开时调用
fitAddon.fit()

// 容器大小变化时调用
window.addEventListener('resize', () => {
  fitAddon.fit()
})
```

**项目中的使用方式** (`terminal-container.tsx`):

```typescript
const fitAddon = useRef<FitAddon | null>(null)

useEffect(() => {
  fitAddon.current = new FitAddon()
  terminal.current.loadAddon(fitAddon.current)

  // 打开终端
  terminal.current.open(terminalRef.current)
  fitAddon.current.fit()

  // 监听窗口大小变化
  window.addEventListener('resize', () => {
    fitAddon.current?.fit()
  })

  // 初始 fit 延迟调用确保 DOM 已渲染
  setTimeout(() => fitAddon.current?.fit(), 100)
}, [])
```

### 3.3 SearchAddon - 终端内搜索

**用途**: 在终端输出中搜索文本

**安装**: 已安装 `@xterm/addon-search@^0.16.0`

**使用**:

```typescript
import { SearchAddon } from '@xterm/addon-search'

const term = new Terminal()
const searchAddon = new SearchAddon()
term.loadAddon(searchAddon)

// 搜索下一个
searchAddon.findNext('search_term')

// 搜索上一个
searchAddon.findPrevious('search_term')

// 设置搜索选项
searchAddon.findNext('term', {
  regex: false, // 启用正则
  caseSensitive: false,
  wholeWord: false,
})

// 取消当前搜索的高亮
searchAddon.clearActiveSearch()
```

**项目中的使用方式**:

```typescript
// 初始化时加载
terminal.current.loadAddon(new SearchAddon())

// 配合 Ctrl+F 使用搜索功能
```

### 3.4 WebLinksAddon - 链接检测

**用途**: 自动检测并使终端中的 URL 可点击

**安装**: 已安装 `@xterm/addon-web-links@^0.12.0`

**使用**:

```typescript
import { WebLinksAddon } from '@xterm/addon-web-links'

const term = new Terminal()

// 使用默认处理器
term.loadAddon(new WebLinksAddon())

// 自定义链接处理器
term.loadAddon(
  new WebLinksAddon((event, uri) => {
    // 在新标签页打开链接
    window.open(uri, '_blank')
  }),
)

// 更高级的配置
term.loadAddon(
  new WebLinksAddon(handler, {
    validation: uri => true, // 验证链接
    hoverDuration: 200, // 悬停时间
  }),
)
```

### 3.5 Canvas 渲染器（未使用）

项目未安装 `@xterm/addon-canvas`。`0.7.x` 的 peer contract 面向 xterm 5，不得为当前 core 恢复该依赖；正常渲染使用内建 renderer，活动终端可按需加载 WebGLAddon，context loss 后回退内建 renderer。

### 3.6 WebGL 加速渲染

**用途**: 使用 WebGL 加速渲染，适合大量输出的场景

**安装**: 已安装 `@xterm/addon-webgl@^0.19.0`

**使用**:

```typescript
import { WebglAddon } from '@xterm/addon-webgl'

const term = new Terminal()
const webglAddon = new WebglAddon()
term.loadAddon(webglAddon)

// 监听渲染器变化
webglAddon.onContextLoss(() => {
  webglAddon.dispose()
})
```

### 3.7 ImageAddon - 图片支持

**用途**: 支持在终端中显示图片（通过六字节序列）

**安装**: 已安装 `@xterm/addon-image@^0.9.0`

**使用**:

```typescript
import { ImageAddon } from '@xterm/addon-image'

const term = new Terminal()
term.loadAddon(new ImageAddon())
```

### 3.8 Unicode11Addon - Unicode 11 支持

**用途**: 支持 Unicode 11 字符宽度

**安装**: 已安装 `@xterm/addon-unicode11@^0.9.0`

**使用**:

```typescript
import { Unicode11Addon } from '@xterm/addon-unicode11'

const term = new Terminal()
const unicodeAddon = new Unicode11Addon()
term.loadAddon(unicodeAddon)

// 激活 Unicode 11
unicodeAddon.activate()
```

### 3.9 LigaturesAddon - 连字字体支持

**用途**: 支持编程连字字体（如 Fira Code）

**安装**: 已安装 `@xterm/addon-ligatures@^0.10.0`

**使用**:

```typescript
import { LigaturesAddon } from '@xterm/addon-ligatures'

const term = new Terminal()
term.loadAddon(new LigaturesAddon())
```

---

## 四、自定义插件开发

### 4.1 插件结构

创建自定义插件只需导出具有 `activate` 和 `dispose` 方法的对象：

```typescript
import { Terminal, IDisposable } from '@baicie/xterm'

class CustomAddon {
  private disposables: IDisposable[] = []

  activate(terminal: Terminal): void {
    // 注册事件监听
    this.disposables.push(terminal.onData(data => console.log('Input:', data)))
    this.disposables.push(
      terminal.onResize(({ cols, rows }) => console.log('Resize:', cols, rows)),
    )
  }

  dispose(): void {
    // 清理所有监听
    this.disposables.forEach(d => d.dispose())
    this.disposables = []
  }
}

export { CustomAddon }
```

### 4.2 项目中自定义插件示例

项目中的终端会话服务实现了输入/输出调度，但不是 xterm 插件：

```typescript
// 文本和原始字节共用每会话 FIFO；前端不维护伪 shell 行编辑器
binding.write(text)
binding.writeRaw(bytes)

// 断开/重连时由 generation 丢弃旧连接的未完成写入
binding.reconnect()
```

---

## 五、VT 序列与 ANSI 转义码

### 5.1 常用 ANSI 转义码

xterm.js 支持标准的 ANSI 转义序列：

```typescript
// 清除操作
term.write('\x1b[2J') // 清除整个屏幕
term.write('\x1b[1J') // 清除从光标到屏幕开头
term.write('\x1b[0J') // 清除从光标到屏幕结尾
term.write('\x1b[2K') // 清除整行
term.write('\x1b[1K') // 清除从光标到行首
term.write('\x1b[0K') // 清除从光标到行尾

// 光标操作
term.write('\x1b[H') // 光标移动到 (1,1)
term.write('\x1b[10;5H') // 光标移动到 (10,5)
term.write('\x1b[G') // 光标移到当前行开头
term.write('\x1b[A') // 光标上移一行
term.write('\x1b[B') // 光标下移一行
term.write('\x1b[C') // 光标右移一列
term.write('\x1b[D') // 光标左移一列
term.write('\x1b[?25l') // 隐藏光标
term.write('\x1b[?25h') // 显示光标

// 颜色（256色）
term.write('\x1b[38;5;196m') // 设置前景色为红色 (196)
term.write('\x1b[48;5;21m') // 设置背景色为蓝色 (21)

// 颜色（True Color 24位）
term.write('\x1b[38;2;255;0;0m') // RGB 前景色
term.write('\x1b[48;2;0;0;255m') // RGB 背景色

// 重置
term.write('\x1b[0m') // 重置所有属性
term.write('\x1b[1m') // 粗体
term.write('\x1b[4m') // 下划线
term.write('\x1b[5m') // 闪烁
term.write('\x1b[7m') // 反转颜色
```

### 5.2 项目中使用示例

项目中的终端表面不再用 `term.write()` 伪造命令历史。方向键、Tab、Ctrl、粘贴和 IME 数据由 xterm 产生后直接进入 PTY/SSH；只有后端产生的 VT 输出才允许调用 `term.write()`：

```typescript
// 后端输出保持 VT 字节流原样交给 xterm
terminal.write(output, callback)
```

---

## 六、性能优化

### 6.1 流控制

处理高速数据流时需要流量控制：

```typescript
// 简单流控（不够高效）
pty.onData(chunk => {
  pty.pause()
  term.write(chunk, () => {
    pty.resume()
  })
})

// 水位线流控（推荐）
const HIGH = 100000
const LOW = 10000
let watermark = 0

pty.onData(chunk => {
  watermark += chunk.length
  term.write(chunk, () => {
    watermark = Math.max(watermark - chunk.length, 0)
    if (watermark < LOW) pty.resume()
  })
  if (watermark > HIGH) pty.pause()
})
```

### 6.2 批量写入

```typescript
// 批量写入优化
const BATCH_SIZE = 1024
let buffer = ''

socket.onData(chunk => {
  buffer += chunk
  if (buffer.length >= BATCH_SIZE) {
    term.write(buffer)
    buffer = ''
  }
})
```

### 6.3 项目中的优化实践

当前终端链路采用明确的生产者/消费者边界：

- 输入由 `TerminalSessionIo` 按 tab 建立有界 FIFO，文本和 `Uint8Array` 原始字节严格保持顺序；同一时刻只允许一个 Tauri 写入在途，resize 使用 latest-wins。
- 输出由 `TerminalOutputScheduler` 合并，单次 `xterm.write` 最多 32 KiB；超大事件按 Unicode code point 边界切分，避免拆断多字节字符。前台优先等待 RAF；受流控事件同时安排 microtask，避免调度器自己的 RAF 与 fallback timer 一起暂停时小批次无法提交给 xterm。进入 fallback 后，首批由 microtask 提交，后续批次在 xterm callback 内直接追加，让已启动的 parse slice 继续有数据；fallback 状态跨越短暂空队列，因此随后没有后端字节计数的尾批次也不会重新依赖被节流的 RAF/timer。xterm 首次空队列写入、累计处理约 12ms 后主动让出以及异步 parser handler 仍可能使用内部 timer，因此这里降低而非消除 WebView timer 节流。任意时刻只有一个 write 在途，只有 callback 完成的完整后端事件才 ACK；未进入 parser 就被 reset/dispose 的数据绝不伪 ACK。
- Rust local/SSH 输出泵以 1 MiB/128 KiB 高低水位暂停/恢复生产者；ACK 通过原子计数与 `Notify` 聚合，不建立无界控制队列。10 秒 watchdog 衡量的是“持续无 ACK 进展”：每次有效 ACK 都刷新 deadline，而完全无 ACK、超额 ACK、硬上限或字节计数不一致仍会 fail-closed 并触发 session 清理。

```typescript
terminalSession.onOutput((data, utf8Bytes) => {
  outputScheduler.enqueue(data, utf8Bytes)
})
```

### 6.4 本地 PTY 验证边界

Rust 回归测试会在 macOS 上启动真实 `portable-pty`，使用隔离 HOME/profile 的固定 `/bin/sh -c` 测试 shell，按交互时序等待 READY、写入中文/emoji，再从 PTY 主端确认：

- 系统 line discipline 保留输入回显；
- shell 内 `read` 精确收到输入；
- shell 观察到创建时请求的列行数；
- `exit` 后子进程可正常等待回收。

测试守卫在断言失败、超时和正常退出路径都会关闭 writer/master、kill + wait child 并 join reader；另有回归覆盖 kill 已返回 `NotFound` 时仍继续 wait，避免 Unix zombie。

该测试证明底层 PTY 往返，不经过 Tauri IPC 或 xterm parser。标准 Tauri/xterm smoke 则使用独立入口真实贯穿 Rust PTY、Tauri event、输出调度器与 xterm callback ACK。smoke 的阶段推进不依赖纯 RAF：`waitForTerminalSmokeFrame()` 让 `requestAnimationFrame` 与 100ms timeout 竞速，并取消未完成的 RAF/timer。此前 `defaultNextFrame()` 只等待 RAF，曾在输出调度器已修复后仍卡死，最终由 Rust watchdog 报 `stage rust-watchdog: terminal smoke timed out`。该兜底属于 smoke 控制流，不替代 `TerminalOutputScheduler` 的 fallback。2026-08-24 的普通 smoke 中，shell 精确生成 8,388,608 字节，xterm 可见 `LOAD_END` 和随后的 `AFTER_LOAD_OK`，resize 后 shell 与 xterm 均为 97 列 × 31 行，10 轮 session 全部回收，耗时 5.4 秒。

重连 smoke 使用本机独立、仅公钥认证的 OpenSSH fixture。macOS 的 `sshd-session` 会进入不同于监听 daemon 的进程组，因此 fixture 必须先枚举并校验 daemon 的直接子进程，只向满足 `pid === pgid` 的隔离 session 进程组发送 `SIGTERM`，再终止 daemon 进程组；3 秒内未退出则分别升级 `SIGKILL`。PID/PGID 非法或 session 未隔离时 fail-closed，避免向不可信进程组发信号。修复后真实 TCP 断线能触发自动重连：10 轮共出现 11 个唯一 session，旧 generation 输出被拒绝，所有资源回收，耗时 6.7 秒；脚本回归 23 项通过。

这些结果验证精确生成命令、尾标记、压力后的持续交互和 localhost public-key SSH 的断线重连，不声称 parser 独立逐字节统计了全部 8 MiB，也不证明物理重叠按键。password/agent/cert/Jump、Windows/Linux/Pageant、串口、vim/nano、物理 `a/s/d` 重叠按键、IME、SGR mouse、bracketed paste、非 UTF-8 原始输入和连续 resize 仍不能标为实机通过。

---

## 七、推荐添加的插件

以下插件适合当前项目，值得考虑：

| 插件                     | 推荐度     | 理由                                                               |
| ------------------------ | ---------- | ------------------------------------------------------------------ |
| `@xterm/addon-serialize` | ⭐⭐⭐⭐⭐ | **序列化终端内容**，可用于实现终端快照、日志导出、会话录制回放功能 |
| `@xterm/addon-clipboard` | ⭐⭐⭐⭐   | **剪贴板集成**，更优雅地处理复制粘贴，支持多行选择                 |
| `@xterm/addon-progress`  | ⭐⭐⭐     | **进度条支持**，通过 OSC 9;4 序列显示进度，对 SSH 长时间任务友好   |

### 7.1 SerializeAddon（推荐优先添加）

**功能**: 将终端缓冲区序列化为 VT 序列或 HTML

```typescript
import { SerializeAddon } from '@xterm/addon-serialize'

const serializeAddon = new SerializeAddon()
term.loadAddon(serializeAddon)

// 导出为 ANSI VT 序列
const vtContent = serializeAddon.serialize()

// 导出为 HTML
const htmlContent = serializeAddon.serializeAsHtml()

// 导出为经过的文本
const plainContent = serializeAddon.serializeText()
```

**应用场景**:

- 终端日志导出功能
- 会话录制与回放
- 终端快照保存

### 7.2 ClipboardAddon

**功能**: 改善剪贴板交互

```typescript
import { ClipboardAddon } from '@xterm/addon-clipboard'

const clipboardAddon = new ClipboardAddon()
term.loadAddon(clipboardAddon)

// 启用同步剪贴板
clipboardAddon.workerSrc = 'path/to/worker.js'
```

### 7.3 ProgressAddon

**功能**: 显示终端进度条

```typescript
import { ProgressAddon } from '@xterm/addon-progress'

const progressAddon = new ProgressAddon()
term.loadAddon(progressAddon)

// OSC 9;4;p;r;t 文法
// p: 0=清除, 1=不确定, 2=百分比, 3=完成
// r: 总值
// t: 当前值
```

---

## 八、调试与开发

### 8.1 启用调试日志

```typescript
const term = new Terminal({
  logLevel: 'debug',
  logger: {
    debug: (...args) => console.debug('[xterm:debug]', ...args),
    info: (...args) => console.info('[xterm:info]', ...args),
    warn: (...args) => console.warn('[xterm:warn]', ...args),
    error: (...args) => console.error('[xterm:error]', ...args),
  },
})
```

### 8.2 常见问题排查

| 问题         | 可能原因                  | 解决方案                              |
| ------------ | ------------------------- | ------------------------------------- |
| 终端显示异常 | 容器不可见时调用 `open()` | 确保 DOM 已渲染，或延迟调用 `fit()`   |
| 性能卡顿     | 大量数据同时写入          | 使用流控或批量写入                    |
| 尺寸不正确   | 未调用 `fit()`            | 在容器大小变化时调用 `fitAddon.fit()` |
| 字体显示异常 | 字体未加载                | 等待字体加载后再初始化终端            |

---

## 九、官方资源

- **官方文档**: https://xtermjs.org/docs/
- **API 参考**: https://xtermjs.org/docs/api/terminal/classes/terminal/
- **插件指南**: https://xtermjs.org/docs/guides/using-addons/
- **GitHub**: https://github.com/xtermjs/xterm.js
- **上游 npm 包**: https://www.npmjs.com/package/@xterm/xterm
- **项目核心包**: https://www.npmjs.com/package/@baicie/xterm

---

_文档更新时间: 2026-08-20_
