import { useEffect } from 'react'
import { SHORTCUT_EVENT_PREFIX } from '@/hooks/use-global-shortcuts'

function detectTauri(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window || '__TAURI_INVOKE__' in window
}

/**
 * 监听后端 Tray 菜单事件，转换为 layout 已有的 `shortcut:*` CustomEvent，
 * 让 tray / 快捷键 / 命令面板共用同一套 action 处理代码。
 *
 * 后端 emit 名 → 前端派发的 CustomEvent：
 *   tray://new-local       → shortcut:new-local
 *   tray://new-ssh         → shortcut:new-ssh
 *   tray://command-palette → shortcut:command-palette
 */
export function useTrayEvents(): void {
  useEffect(() => {
    if (!detectTauri()) return

    const offs: Array<() => void> = []
    let cancelled = false

    import('@tauri-apps/api/event').then(({ listen }) => {
      if (cancelled) return
      const map: Record<string, string> = {
        'tray://new-local': `${SHORTCUT_EVENT_PREFIX}new-local`,
        'tray://new-ssh': `${SHORTCUT_EVENT_PREFIX}new-ssh`,
        'tray://command-palette': `${SHORTCUT_EVENT_PREFIX}command-palette`,
      }
      Object.entries(map).forEach(([backendEvent, domEvent]) => {
        listen(backendEvent, () => {
          window.dispatchEvent(new CustomEvent(domEvent))
        })
          .then(off => {
            if (cancelled) off()
            else offs.push(off)
          })
          .catch(e =>
            console.warn(`[useTrayEvents] listen ${backendEvent} failed`, e),
          )
      })
    })

    return () => {
      cancelled = true
      offs.forEach(off => off())
    }
  }, [])
}
