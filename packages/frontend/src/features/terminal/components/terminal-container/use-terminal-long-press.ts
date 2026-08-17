import { useEffect, useRef, type TouchEvent } from 'react'

export function useTerminalLongPress(onOpen: () => void) {
  const stateRef = useRef({
    timer: null as ReturnType<typeof setTimeout> | null,
    startX: 0,
    startY: 0,
  })

  useEffect(() => {
    const state = stateRef.current
    return () => {
      const timer = state.timer
      if (timer) clearTimeout(timer)
      state.timer = null
    }
  }, [])

  const cancel = () => {
    if (!stateRef.current.timer) return
    clearTimeout(stateRef.current.timer)
    stateRef.current.timer = null
  }

  const start = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) return
    cancel()
    const touch = event.touches[0]
    stateRef.current.startX = touch.clientX
    stateRef.current.startY = touch.clientY
    stateRef.current.timer = setTimeout(() => {
      stateRef.current.timer = null
      onOpen()
      try {
        navigator.vibrate?.(15)
      } catch {
        // Vibration is optional.
      }
    }, 500)
  }

  const move = (event: TouchEvent<HTMLDivElement>) => {
    if (!stateRef.current.timer) return
    const touch = event.touches[0]
    if (!touch) return
    const deltaX = Math.abs(touch.clientX - stateRef.current.startX)
    const deltaY = Math.abs(touch.clientY - stateRef.current.startY)
    if (deltaX > 10 || deltaY > 10) cancel()
  }

  return { start, cancel, move }
}
