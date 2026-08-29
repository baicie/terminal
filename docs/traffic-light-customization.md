# macOS 窗口红绿灯按钮（Traffic Light Buttons）定制指南

本项目基于 Tauri 框架开发，macOS 窗口红绿灯按钮的所有配置均通过 Tauri 的 JSON 配置文件完成，**不涉及 Rust 代码的动态操作**。

---

## 1. 核心配置文件

窗口红绿灯的配置位于各平台对应的 Tauri 配置文件中：

| 平台    | 配置文件路径                        |
| ------- | ----------------------------------- |
| macOS   | `src-tauri/tauri.macos.conf.json`   |
| Windows | `src-tauri/tauri.windows.conf.json` |
| Linux   | `src-tauri/tauri.linux.conf.json`   |

---

## 2. 各平台窗口控件配置

本项目为不同平台设计了差异化的窗口控件方案：

| 平台    | 窗口控件类型                     | 配置文件                  |
| ------- | -------------------------------- | ------------------------- |
| macOS   | 原生红绿灯按钮（Traffic Lights） | `tauri.macos.conf.json`   |
| Windows | 自定义窗口控件（React 组件）     | `tauri.windows.conf.json` |
| Linux   | 原生窗口装饰                     | `tauri.linux.conf.json`   |

### 2.1 macOS — 原生红绿灯按钮

**配置文件**：`src-tauri/tauri.macos.conf.json`

```json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Jan",
        "trafficLightPosition": {
          "x": 20,
          "y": 32
        },
        "decorations": true,
        "titleBarStyle": "Overlay",
        "hiddenTitle": true,
        "transparent": true
      }
    ]
  }
}
```

**配置特点**：

- `decorations: true` — 保留原生窗口装饰（红绿灯按钮）
- `titleBarStyle: "Overlay"` — 使用 Overlay 模式，窗口内容延伸到标题栏区域
- `transparent: true` — 启用透明窗口背景
- `trafficLightPosition` — 调整红绿灯按钮位置（通常无需调整）
- `hiddenTitle: true` — 隐藏原生标题文字

**前端布局适配**：

由于 macOS 保留了原生红绿灯，窗口内容会延伸到标题栏区域，需要通过 `IS_MACOS` 判断调整布局间距，避免内容被红绿灯遮挡：

```tsx
// web-app/src/routes/__root.tsx
{
  !IS_LINUX && (
    <div className="fixed w-full h-12 z-20 top-0" data-tauri-drag-region />
  )
}
```

多个组件根据 `IS_MACOS` 调整 padding/margin：

- `HeaderPage.tsx` — macOS 上增加 `pl-24`
- `left-sidebar/index.tsx` — macOS 上隐藏 Jan logo，居右对齐
- `settings/*.tsx` — macOS 上减少 `pr-30`

### 2.2 Windows — 自定义窗口控件

**配置文件**：`src-tauri/tauri.windows.conf.json`

```json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Jan",
        "decorations": false,
        "titleBarStyle": "Overlay",
        "hiddenTitle": true,
        "transparent": true,
        "windowEffects": {
          "effects": ["fullScreenUI", "mica", "tabbed", "blur", "acrylic"],
          "state": "active"
        }
      }
    ]
  }
}
```

**配置特点**：

- `decorations: false` — **禁用**原生窗口装饰，不再显示原生的最小化/最大化/关闭按钮
- `titleBarStyle: "Overlay"` — 使用 Overlay 模式，窗口内容延伸到标题栏区域
- `transparent: true` — 启用透明窗口背景
- `windowEffects` — 启用 Windows 窗口特效（Mica/Blur/Acrylic 效果）

**自定义窗口控件组件**：

由于禁用了原生窗口装饰，Windows 平台需要使用自定义的窗口控件。组件位于 `web-app/src/components/WindowControls.tsx`：

```tsx
import { Minus, Square, X } from 'lucide-react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Button } from '@/components/ui/button'

export const WindowControls = () => {
  const appWindow = getCurrentWebviewWindow()

  const handleMinimize = async () => {
    await appWindow.minimize()
  }

  const handleMaximize = async () => {
    await appWindow.toggleMaximize()
  }

  const handleClose = async () => {
    await appWindow.close()
  }

  return (
    <div className="absolute top-0 z-50 right-4 h-15">
      <div className="flex items-center h-full">
        <Button
          onClick={handleMinimize}
          aria-label="Minimize"
          variant="ghost"
          size="icon-sm"
        >
          <Minus className="size-4" />
        </Button>
        <Button
          onClick={handleMaximize}
          variant="ghost"
          size="icon-sm"
          aria-label="Maximize"
        >
          <Square className="size-3" />
        </Button>
        <Button
          onClick={handleClose}
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}
```

**组件渲染时机**：

在 `web-app/src/routes/__root.tsx` 中，窗口控件仅在 Windows 平台渲染：

```tsx
const AppLayout = () => {
  return (
    <div className="bg-neutral-50 dark:bg-background size-full relative">
      <SidebarProvider>
        <AnalyticProvider />
        <KeyboardShortcutsProvider />
        {/* Fake absolute panel top to enable window drag */}
        {IS_WINDOWS && <WindowControls />}
        {!IS_LINUX && (
          <div
            className="fixed w-full h-12 z-20 top-0"
            data-tauri-drag-region
          />
        )}
        {/* ... */}
      </SidebarProvider>
    </div>
  )
}
```

### 2.3 Linux — 原生窗口装饰

**配置文件**：`src-tauri/tauri.linux.conf.json`

```json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Jan",
        "decorations": true,
        "titleBarStyle": "Overlay",
        "hiddenTitle": true,
        "transparent": false,
        "windowEffects": {
          "effects": ["fullScreenUI", "blur"],
          "state": "active"
        }
      }
    ]
  }
}
```

**配置特点**：

- `decorations: true` — 使用原生窗口装饰（GTK 原生标题栏）
- `transparent: false` — **禁用**透明窗口背景（Linux GTK 对透明支持有限）
- `windowEffects` — 仅启用 `fullScreenUI` 和 `blur` 效果（Mica/Acrylic 是 Windows 专属）
- 不需要自定义窗口控件，原生标题栏自带最小化/最大化/关闭按钮

**拖拽区域说明**：

Linux 使用原生窗口装饰，因此不需要自定义拖拽区域：

```tsx
{
  /* Linux 不需要自定义拖拽区域，原生标题栏自带拖拽功能 */
}
{
  !IS_LINUX && (
    <div className="fixed w-full h-12 z-20 top-0" data-tauri-drag-region />
  )
}
```

**Windows 特效支持差异**：

| 特效           | Windows | Linux |
| -------------- | ------- | ----- |
| `fullScreenUI` | ✅      | ✅    |
| `mica`         | ✅      | ❌    |
| `tabbed`       | ✅      | ❌    |
| `blur`         | ✅      | ✅    |
| `acrylic`      | ✅      | ❌    |

---

## 3. 前端布局适配

### 3.1 拖拽区域设置

在 `web-app/src/routes/__root.tsx` 中通过 `data-tauri-drag-region` 属性实现可拖拽的标题栏区域：

```tsx
// macOS 和 Windows 需要自定义拖拽区域
{
  !IS_LINUX && (
    <div className="fixed w-full h-12 z-20 top-0" data-tauri-drag-region />
  )
}
```

- **macOS 和 Windows**：需要自定义拖拽区域（因为禁用了部分原生功能）
- **Linux**：不需要，原生标题栏自带拖拽功能

### 3.2 布局间距适配

多个组件通过平台检测常量调整 padding/margin：

| 文件路径                                        | 调整内容                                     |
| ----------------------------------------------- | -------------------------------------------- |
| `web-app/src/containers/HeaderPage.tsx`         | macOS 上增加 `pl-24`，避免被侧边栏遮挡       |
| `web-app/src/components/left-sidebar/index.tsx` | macOS 上隐藏 Jan logo                        |
| `web-app/src/routes/settings/*.tsx`             | macOS 上减少 `pr-30`，避免内容被窗口控件遮挡 |

| 文件路径                                        | 调整内容              |
| ----------------------------------------------- | --------------------- |
| `web-app/src/containers/HeaderPage.tsx`         | macOS 上增加 `pl-24`  |
| `web-app/src/components/left-sidebar/index.tsx` | macOS 上隐藏 Jan logo |
| `web-app/src/routes/settings/*.tsx`             | macOS 上减少 `pr-30`  |

---

## 4. 平台检测常量

### TypeScript 声明

**文件路径**：`web-app/src/types/global.d.ts`

```typescript
declare global {
  declare const IS_MACOS: boolean
  declare const IS_WINDOWS: boolean
  declare const IS_LINUX: boolean
  // ...
}
```

### Vite 注入

**文件路径**：`web-app/vite.config.ts`

```typescript
define: {
  IS_MACOS: JSON.stringify(
    process.env.TAURI_ENV_PLATFORM?.includes('darwin') ?? false
  ),
  IS_WINDOWS: JSON.stringify(
    process.env.TAURI_ENV_PLATFORM?.includes('windows') ?? false
  ),
  IS_LINUX: JSON.stringify(
    process.env.TAURI_ENV_PLATFORM?.includes('linux') ?? false
  ),
}
```

---

## 5. Rust 端窗口操作

Rust 代码中涉及窗口的操作非常有限，主要包括：

### 主题监听

**文件路径**：`src-tauri/src/core/setup.rs`

```rust
fn setup_window_theme_listener<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
) {
    let window_label = window.label().to_string();
    let app_handle_clone = app_handle.clone();

    window.on_window_event(move |event| {
        if let WindowEvent::ThemeChanged(theme) = event {
            let theme_str = match theme {
                tauri::Theme::Light => "light",
                tauri::Theme::Dark => "dark",
                _ => "auto",
            };
            let _ = app_handle_clone.emit("theme-changed", theme_str);
        }
    });
}
```

### 基础窗口操作

**文件路径**：`src-tauri/src/core/system/commands.rs`

- `show` — 显示窗口
- `hide` — 隐藏窗口
- `close` — 关闭窗口
- `set_focus` — 设置窗口焦点

**Rust 端没有涉及红绿灯按钮的动态位置调整或样式修改。**

---

## 6. 窗口服务

**文件路径**：`web-app/src/services/window/tauri.ts`

用于管理子窗口（如日志窗口、系统监控窗口）的创建，支持配置窗口的基本属性：

```typescript
export interface WindowConfig {
  url: string
  label: string
  title?: string
  width?: number
  height?: number
  center?: boolean
  resizable?: boolean
  minimizable?: boolean
  maximizable?: boolean
  closable?: boolean
  fullscreen?: boolean
}
```

---

## 7. 权限配置

**文件路径**：`src-tauri/capabilities/default.json`

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:window:allow-start-dragging",
    "core:window:allow-set-theme",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close",
    "core:window:allow-set-focus"
  ]
}
```

---

## 8. 定制建议

### 移动红绿灯位置

修改 `tauri.macos.conf.json` 中的 `trafficLightPosition`：

```json
"trafficLightPosition": {
  "x": 20,
  "y": 32
}
```

### 隐藏红绿灯按钮

设置 `decorations: false`，然后在 Windows 组件 `WindowControls.tsx` 的基础上为 macOS 创建自定义控件。

### 通过 Rust 动态控制

如果需要通过 Rust 代码动态控制红绿灯，可以使用 Tauri 的 `WebviewWindow` API：

```rust
use tauri::Manager;

// 获取窗口
let window = app.get_webview_window("main").unwrap();

// 设置红绿灯位置（需要 Tauri API 支持）
window.set_traffic_light_position(x, y)?;
```

**注意**：目前项目中的 Rust 代码未实现此类动态控制。

---

## 9. 总结

### 9.1 各平台窗口控件对比

| 方面            | macOS                   | Windows                   | Linux                   |
| --------------- | ----------------------- | ------------------------- | ----------------------- |
| 窗口控件类型    | 原生红绿灯按钮          | 自定义 React 组件         | 原生窗口装饰            |
| 配置文件        | `tauri.macos.conf.json` | `tauri.windows.conf.json` | `tauri.linux.conf.json` |
| `decorations`   | `true`                  | `false`                   | `true`                  |
| `transparent`   | `true`                  | `true`                    | `false`                 |
| `titleBarStyle` | `"Overlay"`             | `"Overlay"`               | `"Overlay"`             |
| `windowEffects` | 全部特效                | 全部特效                  | 仅 `blur`               |
| 自定义拖拽区域  | ✅                      | ✅                        | ❌（原生）              |
| 自定义窗口控件  | ❌                      | ✅ `WindowControls.tsx`   | ❌                      |

### 9.2 各方面实现方式

| 方面                  | 实现方式                                |
| --------------------- | --------------------------------------- |
| macOS 红绿灯位置      | 通过 JSON 配置 `trafficLightPosition`   |
| macOS 红绿灯显示/隐藏 | 通过 JSON 配置 `decorations`            |
| Windows 窗口控件      | React 组件 `WindowControls.tsx`         |
| Linux 窗口控件        | 原生 GTK 标题栏                         |
| 标题栏样式            | 通过 JSON 配置 `titleBarStyle`          |
| 拖拽区域              | 通过 HTML 属性 `data-tauri-drag-region` |
| 动态控制              | 未实现（仅静态配置）                    |

### 9.3 关键文件索引

| 文件路径                                    | 说明                   |
| ------------------------------------------- | ---------------------- |
| `src-tauri/tauri.macos.conf.json`           | macOS 窗口配置         |
| `src-tauri/tauri.windows.conf.json`         | Windows 窗口配置       |
| `src-tauri/tauri.linux.conf.json`           | Linux 窗口配置         |
| `web-app/src/routes/__root.tsx`             | 前端布局和拖拽区域     |
| `web-app/src/components/WindowControls.tsx` | Windows 自定义窗口控件 |
| `web-app/src/types/global.d.ts`             | 平台检测常量声明       |
| `web-app/vite.config.ts`                    | 平台检测常量注入       |
| `src-tauri/capabilities/default.json`       | 窗口操作权限配置       |
| `src-tauri/src/core/setup.rs`               | Rust 窗口主题监听      |
