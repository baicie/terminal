import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  SIDEBAR_WIDTH_KEY,
} from './sidebar-width'

export function useSidebarResize(
  sidebarWidth: number,
  onSidebarWidthChange: (width: number) => void,
) {
  const [resizing, setResizing] = useState(false)
  const dragRef = useRef({ startX: 0, startWidth: SIDEBAR_DEFAULT })
  const lastWidthRef = useRef(sidebarWidth)
  lastWidthRef.current = sidebarWidth

  const persist = useCallback((width: number) => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width))
    } catch {
      // localStorage can be unavailable in restricted webviews.
    }
  }, [])

  const onResizeStart = useCallback(
    (event: ReactPointerEvent) => {
      event.preventDefault()
      dragRef.current = {
        startX: event.clientX,
        startWidth: sidebarWidth,
      }
      setResizing(true)
    },
    [sidebarWidth],
  )

  const onToggleCollapse = useCallback(() => {
    const nextWidth =
      sidebarWidth <= SIDEBAR_MIN ? SIDEBAR_DEFAULT : SIDEBAR_MIN
    onSidebarWidthChange(nextWidth)
    persist(nextWidth)
  }, [sidebarWidth, onSidebarWidthChange, persist])

  useEffect(() => {
    if (!resizing) return

    const onMove = (event: PointerEvent) => {
      const delta = event.clientX - dragRef.current.startX
      const nextWidth = Math.min(
        SIDEBAR_MAX,
        Math.max(SIDEBAR_MIN, dragRef.current.startWidth + delta),
      )
      lastWidthRef.current = nextWidth
      onSidebarWidthChange(nextWidth)
    }
    const onUp = () => {
      setResizing(false)
      persist(lastWidthRef.current)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [persist, resizing, onSidebarWidthChange])

  // The separator is focusable; keyboard users resize it without a pointer.
  const onResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      const step = event.shiftKey ? 32 : 8
      let next: number | null = null
      if (event.key === 'ArrowLeft') next = sidebarWidth - step
      else if (event.key === 'ArrowRight') next = sidebarWidth + step
      else if (event.key === 'Home') next = SIDEBAR_MIN
      else if (event.key === 'End') next = SIDEBAR_MAX
      if (next === null) return
      event.preventDefault()
      const clamped = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, next))
      onSidebarWidthChange(clamped)
      persist(clamped)
    },
    [onSidebarWidthChange, persist, sidebarWidth],
  )

  return { resizing, onResizeStart, onResizeKeyDown, onToggleCollapse }
}
