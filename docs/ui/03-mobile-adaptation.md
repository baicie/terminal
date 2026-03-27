# 手机端适配设计方案

> 本文档定义终端应用在手机端（iOS Safari / Android Chrome / 微信小程序 web-view）的 UI/UX 适配策略，包括响应式断点、布局重构、交互优化、触控手势，以及各视图的移动化改造。

---

## 1. 核心挑战

| 挑战 | 说明 |
|------|------|
| **屏幕空间极度受限** | 视口宽度 320–428px，顶部状态栏 + 导航栏吃掉了 100+px |
| **触控精度低** | 44×44px 是最小触控目标（Apple HIG），无法 hover |
| **键盘弹起** | 移动端键盘弹出后视口高度骤降，布局需处理 `100dvh` |
| **无 hover / 右键** | 下拉菜单、tooltip、右键菜单、Ctrl+快捷键全部不可用 |
| **标题栏拖拽** | `data-tauri-drag-region` 在移动端点击区域更敏感 |
| **竖屏 / 横屏切换** | 横屏时更接近平板体验，布局应重新响应 |
| **状态保持** | 移动端标签切换频繁，需保留每个会话的终端状态 |
| **跨平台浏览器差异** | iOS Safari / Android Chrome / Samsung Internet 的差异处理 |

---

## 2. 断点与视口策略

### 2.1 断点定义

```
Mobile    : 0  – 639px   (手机竖屏，primary)
Phablet   : 640 – 767px  (大屏手机横屏 / 小平板竖屏)
Tablet    : 768 – 1023px (平板竖屏)
Desktop   : 1024px+      (当前桌面端不变)
```

### 2.2 视口配置

在 `index.html` 的 `<meta name="viewport">` 中补充：

```html
<meta
  name="viewport"
  content="
    width=device-width,
    initial-scale=1,
    maximum-scale=1,
    viewport-fit=cover,
    user-scalable=no
  "
/>
```

- `viewport-fit=cover`：覆盖刘海区域（iPhone notch / Dynamic Island）
- `user-scalable=no`：禁止用户缩放，避免字体大小影响布局
- CSS 中使用 `100dvh`（dynamic viewport height）代替 `100vh`，解决键盘弹起时底部被遮挡的问题

### 2.3 核心 CSS 变量（移动端覆盖）

```css
@media (max-width: 639px) {
  :root {
    --sidebar-width: 0px;       /* 侧栏隐藏 */
    --toolbar-height: 48px;      /* 移动端工具栏加高 */
    --safe-area-bottom: env(safe-area-inset-bottom, 0px);
    --safe-area-top: env(safe-area-inset-top, 0px);
    --status-bar-height: 44px;   /* iOS 状态栏 */
  }
}
```

---

## 3. 布局重构策略

### 3.1 整体架构对比

```
桌面端                              移动端
┌─────────────────────────────┐    ┌─────────────────┐
│  TopBar (56px)               │    │  TopBar (48px)  │
│  [☰][SFTP][标签……][🔔]       │    │  [☰][标签] [↩]  │
├──────────┬──────────────────┤    ├─────────────────┤
│ Sidebar  │ Content Toolbar  │    │                 │
│ (200px)  │ (48px)           │    │ Content (弹性)   │
│          ├──────────────────┤    │                 │
│ [Hosts]  │                  │    │                 │
│ [Key]    │ Content          │    │                 │
│ [Port]   │                  │    ├─────────────────┤
│ [Snip]   │                  │    │ BottomNav (56px) │
│ [Logs]   │                  │    │ [Hosts][Term]…  │
└──────────┴──────────────────┘    └─────────────────┘
```

### 3.2 侧栏 → 底部标签栏

**桌面端侧栏（Sidebar）** 在手机端替换为**底部标签栏（Bottom Tab Bar）**：

| 桌面侧栏项 | 移动端底部图标 | 说明 |
|-----------|--------------|------|
| Hosts | 🏠 Home | 首页主机列表 |
| Terminal | ⌨️ Terminal | 当前终端会话（切换标签） |
| SFTP | 📁 Files | SFTP 文件管理 |
| Keychain | 🔑 Keys | 密钥管理 |
| More (展开) | ⚙️ Settings | 设置 / 其他 |
| Port Forward | 🔀 Forward | 端口转发 |
| Snippets | 📋 Snippets | 代码片段 |
| Known Hosts | 🛡️ Shield | 已知主机 |
| Logs | 📜 Logs | 日志 |

**底部栏设计规范**：

```tsx
// BottomNav 高度 56px + safe-area
<nav
  className="
    fixed bottom-0 left-0 right-0 z-[100]
    h-[56px] pb-[env(safe-area-inset-bottom)]
    bg-background/90 backdrop-blur-xl border-t border-border/50
    flex items-center justify-around
    safe-area-bottom-pad
  "
>
  {/* 5个主标签，溢出项放入 "更多" Sheet */}
</nav>
```

- 高度 56px（符合触控舒适度）
- 背景使用 `backdrop-blur`，视觉更轻盈
- 选中项使用主题色圆点指示器，而非背景高亮（节省空间）
- **关键会话优先**：「Terminal」标签始终显示当前活动的终端会话

### 3.3 顶栏简化

桌面端顶栏复杂按钮（新建标签、SFTP 切换）在移动端简化为：

```
┌────────────────────────────┐
│ [☰]  [标签1 ×] [标签2]  [↩] │  ← 48px
└────────────────────────────┘
```

| 元素 | 说明 |
|------|------|
| `[☰]` | 汉堡菜单 → 打开左侧 Drawer（Hosts / Settings 等不常用的深层页面） |
| `[标签]` | 横向滚动标签页，左右滑动切换 |
| `[↩]` | 返回按钮（替代桌面端 Browser back，历史栈为空时隐藏） |

---

## 4. 各视图移动化改造

### 4.1 Hosts 视图

| 桌面端 | 移动端改造 |
|--------|-----------|
| 左侧侧栏 | 移除，整合到底部标签栏 |
| 顶部搜索框 + NEW HOST 按钮 | 搜索框全宽，下方 FAB 浮动按钮 `+` 新建 |
| 主机卡片网格 | 改为单列列表，卡片高度 72px，左右滑动显示「快速连接」「编辑」 |
| 主机详情侧栏 | 全屏 Sheet 从底部滑出 |

**主机列表卡片（移动端）**：

```
┌─────────────────────────────────────────┐
│ [状态点]  腾讯云-4h4g1y     [▶ 连接]  │
│ user@1.2.3.4   Port: 22    🔑 密钥名    │
└─────────────────────────────────────────┘
```

- 触控区域至少 72px 高
- 连接按钮 44×32px，符合最小触控
- 滑动左滑显示「编辑」「删除」，右滑显示「快速复制 IP」

### 4.2 Terminal 视图

| 桌面端 | 移动端改造 |
|--------|-----------|
| 顶栏工具栏（字体、放大大按钮） | 顶部工具条：字号调节滑块、粘贴按钮、全屏按钮 |
| 右键菜单 | 长按弹出上下文菜单（替代右键） |
| 标签页 | 底部 Tab Bar 显示，多会话时左右滑动 |
| 分屏模式 | 移动端不支持分屏，提示用户横屏或使用平板模式 |
| 键盘 | 调用系统键盘；顶部浮动快捷工具栏：Esc / Tab / Ctrl / ↑↓ / 清屏 |

**移动端 Terminal 浮动工具栏**：

```
┌──────────────────────────────────────────────────────────┐
│  [Esc] [Tab] [Ctrl] [↑] [↓] [PgUp] [PgDn] [Clear] [⌨️]  │
└──────────────────────────────────────────────────────────┘
```

- 固定在键盘上方（键盘打开时上移，关闭时隐藏）
- 高度 40px，横向滚动
- `⌨️` 按钮切换回系统键盘
- `Esc` / `Tab` / `Ctrl` 作为修饰键（点按后保持激活态，再点目标键）

### 4.3 SFTP 视图

| 桌面端 | 移动端改造 |
|--------|-----------|
| 左右分栏（本地 / 远程） | 单栏视图，顶部 Tab 切换「本地」/「远程」 |
| 工具栏（上传、下载、新建文件夹） | 底部操作栏（固定） |
| 拖拽上传 | 长按文件弹出「上传」选项 |
| 右键文件操作 | 长按弹出菜单 |

### 4.4 Keychain / Port Forward / Snippets / Logs

这些视图统一改造：

- **搜索框**：吸顶（sticky），随滚动固定在工具栏下方
- **列表**：单列卡片，无需分组折叠面板（改用「全部展开」）
- **新建/编辑**：全屏 Sheet（从底部滑出），而非 Dialog（Dialog 在手机端体验差）
- **空状态**：居中插画 + 主操作按钮（而非侧栏提示）

### 4.5 Settings 视图

- 从「汉堡菜单」打开左侧 Drawer（Drawer 从左侧滑入，宽度 85%，带遮罩）
- 所有设置项用单选/开关，分类折叠面板

---

## 5. 交互优化

### 5.1 触控手势

| 手势 | 触发位置 | 行为 |
|------|---------|------|
| 左滑列表项 | Hosts / Snippets / Logs | 显示快捷操作（编辑/删除/复制） |
| 长按 500ms | 终端、文件列表 | 弹出上下文菜单 |
| 下拉刷新 | Hosts、Logs、SFTP | 刷新数据 |
| 双指捏合 | Terminal | 缩放字体大小 |
| 横向滑动标签 | 顶部标签区 | 切换标签 |
| 从屏幕左边缘右滑 | 全局 | 返回上一页（相当于 Browser back） |
| 从屏幕右边缘左滑 | Terminal | 打开快捷命令栏 |
| 底部上滑 | SFTP / Keychain | 加载更多数据（虚拟列表分页） |

### 5.2 快捷键替换

| 桌面快捷键 | 移动端替代 |
|-----------|-----------|
| `Ctrl+J` 命令面板 | 底部导航「+」弹出菜单 |
| `Ctrl+N` 新建主机 | FAB 浮动按钮 |
| `Ctrl+Tab` 切换标签 | 底部 Tab / 横向滑动标签 |
| `Ctrl+W` 关闭标签 | 标签上左滑 |
| `Ctrl+K` 搜索 | 顶部搜索框 |
| 右键菜单 | 长按弹出菜单 |
| `Ctrl+C/V` 复制粘贴 | 系统键盘 + 浮动粘贴按钮 |
| `F11` 全屏 | 全屏按钮 |

### 5.3 浮动操作按钮（FAB）

所有视图的「新建」操作统一使用 **FAB（Floating Action Button）**：

```tsx
<button
  className="
    fixed right-4 bottom-[calc(56px+env(safe-area-inset-bottom)+16px)]
    z-[90]
    w-14 h-14 rounded-full
    bg-primary text-primary-foreground
    shadow-lg shadow-primary/30
    flex items-center justify-center
    active:scale-95 transition-transform
  "
  onClick={handleNew}
>
  <Plus className="size-6" />
</button>
```

- 位置：底部导航栏上方 16px，右侧 16px
- iOS 样式：可选 SF Symbols 风格（圆形 + 柔和阴影）

### 5.4 Sheet 替代 Dialog

移动端避免使用居中 Dialog，改用从底部滑出的 **Sheet**：

```tsx
<Sheet>
  <SheetContent side="bottom" className="h-[85dvh] rounded-t-2xl">
    {/* 全屏编辑表单、详情、列表选择 */}
  </SheetContent>
</Sheet>
```

- 高度 85dvh，底部上滑可拖拽关闭
- 背景遮罩 `bg-black/40 backdrop-blur-sm`
- 内容区支持内部滚动

---

## 6. 状态管理

### 6.1 移动端全局状态（新增）

```typescript
// store/mobile.ts
class MobileStore {
  @observable bottomNavVisible = true
  @observable floatingKeyboardBar = false  // 浮动键盘工具栏
  @observable activeTerminalId: string | null = null
  @observable sheetStack: SheetType[] = []  // Sheet 栈（可嵌套）

  @action showSheet(sheet: SheetType) { this.sheetStack.push(sheet) }
  @action hideSheet() { this.sheetStack.pop() }
  @action toggleKeyboardBar() { this.floatingKeyboardBar = !this.floatingKeyboardBar }
}
```

### 6.2 会话状态

- **终端会话**：每个标签对应独立终端实例，切换标签时保存 xterm.js buffer 状态（最多保留 5 个后台会话，超出则冻结）
- **表单状态**：使用 `MobX` store + `localStorage` 持久化，防止刷新丢失

---

## 7. 性能优化

| 优化项 | 方案 |
|--------|------|
| **虚拟列表** | Hosts 列表（100+）、Logs（1000+）使用 `react-virtual` 或 TanStack Virtual |
| **图片优化** | 主机状态图标用 CSS/SVG，避免加载图片 |
| **字体** | 使用系统字体栈（`-apple-system, BlinkMacSystemFont`），避免加载 web fonts |
| **Tree-shaking** | 移动端不加载 `xterm-addon-webgl`（WebGL 在移动端兼容性差），只用 Canvas 渲染 |
| **动画** | 优先使用 CSS `transform` / `opacity`，使用 `prefers-reduced-motion` 媒体查询 |
| **骨架屏** | Hosts / SFTP 列表加载时显示骨架屏，而非 spinner |
| **代码分割** | 移动端只加载当前视图代码（`React.lazy`） |

---

## 8. 响应式 CSS 架构

### 8.1 工具类断点前缀

所有移动端专属样式使用 Tailwind 断点前缀：

```tsx
// 移动端隐藏（桌面端显示）
<div className="hidden md:flex" />

// 移动端显示（桌面端隐藏）
<div className="flex md:hidden" />

// 仅移动端
<button className="flex md:hidden ..." />

// 移动端底部 + 桌面端侧栏共存
<div className="flex">
  <div className="hidden md:block w-52">{/* 桌面侧栏 */}</div>
  <div className="w-full">{/* 主内容 */}</div>
</div>
```

### 8.2 组件响应式改造示例

以 TopToolbar 为例，移动端与桌面端差异：

```tsx
const TopToolbar: React.FC = () => {
  const isMobile = useBreakpoint('max-md')

  return (
    <header className={cn(
      'border-b bg-background shrink-0',
      isMobile ? 'h-12 px-2' : 'h-11 px-3'
    )}>
      {isMobile ? (
        // 移动端：汉堡 + 标签 + 返回
        <MobileHeader />
      ) : (
        // 桌面端：完整顶栏
        <DesktopHeader />
      )}
    </header>
  )
}
```

---

## 9. 特殊平台处理

### 9.1 iOS Safari 适配

```css
/* 修复 iOS Safari 100vh 问题 */
body {
  min-height: 100dvh;
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}

/* 修复 iOS 输入框 focus 时页面跳变 */
input, textarea {
  padding: 12px;
  font-size: 16px; /* 防止 iOS Safari 自动缩放 */
}
```

- `font-size: 16px` 是关键：iOS Safari 会对手动缩放的输入框启用自动缩放

### 9.2 Android Chrome 适配

- 键盘弹起时使用 `visualViewport` API 监听并调整布局：

```tsx
useEffect(() => {
  const onResize = () => {
    const vh = window.visualViewport?.height ?? window.innerHeight
    document.documentElement.style.setProperty('--vh', `${vh}px`)
  }
  window.visualViewport?.addEventListener('resize', onResize)
  return () => window.visualViewport?.removeEventListener('resize', onResize)
}, [])
```

```css
/* 使用 CSS 自定义属性 --vh 代替 dvh（兼容性更好） */
.content { height: calc(var(--vh, 100vh) - 120px); }
```

### 9.3 微信小程序 web-view

若未来嵌入微信小程序：

- 使用 `<web-view>` 嵌入
- 通过 JSSDK 桥接微信原生能力（分享、支付、蓝牙等）
- 微信环境下隐藏原生 TabBar，使用自定义底部导航

---

## 10. 实施优先级

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| **Phase 1** | 基础响应式：断点、CSS 变量、隐藏/显示布局 | P0 |
| **Phase 2** | 底部标签栏 + 移动端顶栏 | P0 |
| **Phase 3** | 移动端 Hosts 视图（卡片、滑动操作、FAB） | P1 |
| **Phase 4** | Terminal 移动化（浮动键盘工具栏、长按菜单） | P1 |
| **Phase 5** | SFTP 移动化（Sheet 替代 Dialog） | P1 |
| **Phase 6** | 其他视图（Keychain / Snippets / Logs）移动化 | P2 |
| **Phase 7** | 性能优化（虚拟列表、代码分割、骨架屏） | P2 |
| **Phase 8** | 手势系统（全局滑动、捏合缩放） | P2 |

---

## 附录：设计参考

- **Apple HIG 触控规范**：[Human Interface Guidelines - iOS](https://developer.apple.com/design/human-interface-guidelines/ios)
- **Google Material Design 3 触控目标**：[Material Design - Touch targets](https://m3.material.io/components/navigation-bar)
- **Radix UI Sheet 组件**：[Sheet 文档](https://www.radix-ui.com/themes/docs/components/sheet)
- **TanStack Virtual**（虚拟列表）：[文档](https://tanstack.com/virtual/latest)
- **Vercel 移动端性能指南**：[Mobile Performance](https://vercel.com/utties/mobile)

---

_文档更新时间: 2026-03-27_
