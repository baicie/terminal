import { useEffect, useState } from 'react'

let isTauriEnv: boolean | null = null
function detectTauri(): boolean {
  if (isTauriEnv !== null) return isTauriEnv
  if (typeof window === 'undefined') return false
  isTauriEnv =
    '__TAURI_INTERNALS__' in window || '__TAURI_INVOKE__' in window
  return isTauriEnv
}

/**
 * 跟踪主窗口的焦点状态（基于 Tauri webview 事件 + DOM fallback）。
 *
 * - 在 Tauri 环境下监听 `tauri://focus` / `tauri://blur`（最准确，跨 webview 进程）
 * - 浏览器环境（dev / preview）下退化为 `window` 的 `focus` / `blur` 事件
 * - 初始值：`document.hasFocus()` 同步读出
 */
export function useWindowFocus(): boolean {
  const [focused, setFocused] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true
    try {
      return document.hasFocus()
    } catch {
      return true
    }
  })

  useEffect(() => {
    let unlistenFocus: (() => void) | undefined
    let unlistenBlur: (() => void) | undefined
    let cancelled = false

    const onFocus = () => setFocused(true)
    const onBlur = () => setFocused(false)

    if (detectTauri()) {
      // 动态 import：避免在非 Tauri 环境（vitest / SSR）报模块解析错
      import('@tauri-apps/api/webviewWindow').then(mod => {
        if (cancelled) return
        try {
          const win = mod.getCurrentWebviewWindow()
          win.listen('tauri://focus', onFocus).then(off => {
            if (cancelled) off()
            else unlistenFocus = off
          })
          win.listen('tauri://blur', onBlur).then(off => {
            if (cancelled) off()
            else unlistenBlur = off
          })
        } catch (e) {
          console.warn('[useWindowFocus] Tauri listen failed, falling back', e)
          window.addEventListener('focus', onFocus)
          window.addEventListener('blur', onBlur)
          unlistenFocus = () => window.removeEventListener('focus', onFocus)
          unlistenBlur = () => window.removeEventListener('blur', onBlur)
        }
      })
    } else {
      window.addEventListener('focus', onFocus)
      window.addEventListener('blur', onBlur)
      unlistenFocus = () => window.removeEventListener('focus', onFocus)
      unlistenBlur = () => window.removeEventListener('blur', onBlur)
    }

    return () => {
      cancelled = true
      unlistenFocus?.()
      unlistenBlur?.()
    }
  }, [])

  return focused
}
