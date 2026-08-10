import type { MouseEvent as ReactMouseEvent } from 'react'
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

  const onResizeStart = useCallback(
    (event: ReactMouseEvent) => {
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
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(nextWidth))
    } catch {
      // localStorage can be unavailable in restricted webviews.
    }
  }, [sidebarWidth, onSidebarWidthChange])

  useEffect(() => {
    if (!resizing) return

    const onMove = (event: MouseEvent) => {
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
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(lastWidthRef.current))
      } catch {
        // localStorage can be unavailable in restricted webviews.
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [resizing, onSidebarWidthChange])

  return { resizing, onResizeStart, onToggleCollapse }
}
