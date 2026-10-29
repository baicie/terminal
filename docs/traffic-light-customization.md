# macOS 原生红绿灯与顶栏布局

本项目保留 macOS 原生关闭、最小化和全屏按钮。位置由 Tauri 窗口创建配置决定，网页顶栏在按钮组右侧预留安全区；普通浏览器预览不预留这段空间。

## 窗口配置

配置位于 `src-tauri/tauri.conf.json` 的 `app.windows[0]`：

```json
{
  "trafficLightPosition": {
    "x": 16,
    "y": 16
  },
  "decorations": true,
  "titleBarStyle": "Overlay",
  "hiddenTitle": true,
  "transparent": true
}
```

`trafficLightPosition` 使用 Tauri 的逻辑坐标。当前 `x: 16, y: 16` 将按钮组放在窗口左上方，并让它落在 44px 桌面顶栏的高度范围内；原生按钮的具体观感仍需在 macOS 窗口中确认。`decorations: true` 保留原生按钮，`titleBarStyle: "Overlay"` 让网页内容延伸到标题栏区域。

Tauri 2 目前没有运行时移动原生红绿灯的 `WebviewWindow` setter。更改位置后需要重启应用验证。

## 顶栏安全区

桌面顶栏高 44px，窄屏顶栏高 48px。两者都在首帧同步预留 `pl-20`（80px）；安全区只用于 Tauri macOS 窗口。平台检测也检查 macOS 标识，避免其他平台的 Tauri 窗口套用该布局：

```tsx
import { isTauri } from '@tauri-apps/api/core'

function isMacPlatform(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false
  }
  if (!isTauri()) return false
  return /mac|darwin/i.test(
    `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`,
  )
}
```

桌面和窄屏顶栏都使用 `isMacPlatform()` 的结果，在 render 阶段决定安全区，因此不会先显示未留白布局再横向跳动。浏览器预览中的 `isTauri()` 为 `false`，使用常规水平内边距。

顶栏 header 使用 `data-tauri-drag-region="deep"`，让内部空白区域也能拖动窗口；可点击按钮显式标记 `data-tauri-drag-region="false"`，避免点击操作被识别为拖动。对应实现：

- `packages/frontend/src/components/top-toolbar/index.tsx`
- `packages/frontend/src/components/top-toolbar/mobile-toolbar.tsx`
- `packages/frontend/src/components/top-toolbar/index.test.tsx`

## 验收

自动化测试覆盖 Tauri macOS 首帧留白、浏览器预览不留白，以及窄屏顶栏留白。它们只验证前端布局分支，不会启动 AppKit 窗口，也不证明物理按钮位置或原生拖拽命中区正确。

解锁 macOS 后，使用当前源码启动 Tauri 应用并确认：

- 红绿灯在桌面顶栏左侧垂直位置自然，与按钮组之间没有重叠。
- 窄窗口宽度下，菜单、页面标题和返回按钮不与红绿灯区域冲突。
- 红绿灯仍可正常关闭、最小化和全屏；顶栏空白处可拖动窗口。
- 点击顶栏内的按钮会执行按钮动作，不会误触发窗口拖动。
