# xterm.js AI 使用指南

> 本文档详细说明 xterm.js 的 API、插件系统和使用规范，供 AI Agent 开发时参考
> 官方文档: https://xtermjs.org/
> 最新版本: 6.0.0 (2025-12)
> 文档更新时间: 2026-03-19

---

## 一、项目现状

### 已集成的插件

项目已在 `package.json` 中配置以下 xterm.js 插件：

| 插件                     | 版本    | 用途             | 状态      |
| ------------------------ | ------- | ---------------- | --------- |
| `@xterm/xterm`           | ^6.0.0  | 核心库           | ✅ 已使用 |
| `@xterm/addon-fit`       | ^0.11.0 | 自动调整终端大小 | ✅ 已使用 |
| `@xterm/addon-search`    | ^0.16.0 | 终端内搜索       | ✅ 已使用 |
| `@xterm/addon-web-links` | ^0.12.0 | 链接检测与点击   | ✅ 已使用 |
| `@xterm/addon-canvas`    | ^0.7.0  | Canvas 渲染器    | ✅ 已安装 |
| `@xterm/addon-webgl`     | ^0.19.0 | WebGL 加速渲染   | ✅ 已安装 |
| `@xterm/addon-image`     | ^0.9.0  | 图片支持         | ✅ 已安装 |
| `@xterm/addon-unicode11` | ^0.9.0  | Unicode 11 支持  | ✅ 已安装 |
| `@xterm/addon-ligatures` | ^0.10.0 | 连字字体支持     | ✅ 已安装 |

### 当前使用位置

主要在 `src/view/terminal/terminal-container.tsx` 中使用：

```typescript
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
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
// 处理用户输入 - 最常用事件
terminal.current.onData(data => {
  // data 是用户输入的原始数据
  sshService.write(sessionId, data)
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

### 3.5 Canvas 渲染器

**用途**: 使用 Canvas 而非 DOM 渲染，提升性能

**安装**: 已安装 `@xterm/addon-canvas@^0.7.0`

**使用**:

```typescript
import { CanvasAddon } from '@xterm/addon-canvas'

const term = new Terminal()
const canvasAddon = new CanvasAddon()
term.loadAddon(canvasAddon)
```

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
import { Terminal, IDisposable } from '@xterm/xterm'

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

项目中的 `terminal-container.tsx` 实现了类似插件的功能：

```typescript
// 写入缓冲区管理（类似流控插件）
const writeBufferRef = useRef<string>('')
const writeTimerRef = useRef<number | null>(null)

const flushWriteBuffer = () => {
  if (writeBufferRef.current.length === 0) return
  const data = writeBufferRef.current
  writeBufferRef.current = ''
  sshService.write(sessionId, data)
}

// 命令历史导航插件
const handleHistoryNavigation = useCallback(
  (key: 'ArrowUp' | 'ArrowDown') => {
    // ... 历史命令导航逻辑
  },
  [commandHistory],
)
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

项目中的 `terminal-container.tsx`:

```typescript
// 清除当前行并设置新内容（用于命令历史导航）
term.write('\x1b[G') // 移动光标到行首
term.write('\x1b[2K') // 清除整行
term.write(newLine) // 写入新内容
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

项目使用 5ms 防抖批量写入：

```typescript
terminal.current.onData(data => {
  if (data === '\r' || data === '\x03' || data === '\x7f') {
    // 特殊键立即处理
    flushWriteBuffer()
    sshService.write(sessionId, data)
  } else {
    // 普通字符加入缓冲区
    writeBufferRef.current += data

    // 5ms 防抖
    if (writeTimerRef.current !== null) {
      clearTimeout(writeTimerRef.current)
    }
    writeTimerRef.current = window.setTimeout(() => {
      flushWriteBuffer()
    }, 5)
  }
})
```

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
- **npm 包**: https://www.npmjs.com/package/@xterm/xterm

---

_文档更新时间: 2026-03-19_
