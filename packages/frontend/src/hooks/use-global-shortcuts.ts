/**
 * useGlobalShortcuts
 *
 * 在 layout 顶层注册全局键盘监听，把所有匹配 shortcutsService 的事件
 * 派发为对应的自定义 DOM 事件（`shortcut:<action>`），方便任何组件
 * 用 `window.addEventListener('shortcut:command-palette', ...)` 订阅。
 *
 * 优点：
 *   - 单一注册点，避免多组件各自 addEventListener 重复触发
 *   - shortcutsService 统一管理可显示、可重映射、可读出
 *   - 解耦：触发方与响应方互不感知
 */

import { useEffect } from 'react'
import { shortcutsService } from '@/service/shortcuts'

/** 自定义事件前缀。响应方监听 `shortcut:command-palette` 等。 */
export const SHORTCUT_EVENT_PREFIX = 'shortcut:'

export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      shortcutsService.handleKeyboardEvent(e)
    }

    const onAction = (action: string) => {
      window.dispatchEvent(new CustomEvent(`${SHORTCUT_EVENT_PREFIX}${action}`))
    }

    const offListener = shortcutsService.addListener(onAction)
    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('keydown', onKey)
      offListener()
    }
  }, [])
}
