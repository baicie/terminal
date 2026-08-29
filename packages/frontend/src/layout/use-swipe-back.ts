import type { TouchEvent as ReactTouchEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

export function useSwipeBack() {
  const startXRef = useRef<number | null>(null)
  const startYRef = useRef<number | null>(null)
  const swipeProgressRef = useRef(0)
  const [swipeProgress, setSwipeProgress] = useState(0)

  const onSwipeStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    if (touch.clientX <= 24) {
      startXRef.current = touch.clientX
      startYRef.current = touch.clientY
    }
  }, [])

  const onSwipeMove = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    if (startXRef.current === null) return

    const touch = event.touches[0]
    const deltaX = touch.clientX - startXRef.current
    const deltaY = Math.abs(touch.clientY - (startYRef.current ?? 0))
    if (deltaY > 50) {
      startXRef.current = null
      setSwipeProgress(0)
      return
    }

    if (deltaX > 0) {
      event.preventDefault()
      setSwipeProgress(Math.min(deltaX / 80, 1))
    } else {
      setSwipeProgress(0)
    }
  }, [])

  const onSwipeEnd = useCallback(() => {
    if (startXRef.current !== null && swipeProgressRef.current >= 1) {
      window.history.back()
    }
    startXRef.current = null
    startYRef.current = null
    swipeProgressRef.current = 0
    setSwipeProgress(0)
  }, [])

  useEffect(() => {
    swipeProgressRef.current = swipeProgress
  }, [swipeProgress])

  return { swipeProgress, onSwipeStart, onSwipeMove, onSwipeEnd }
}
