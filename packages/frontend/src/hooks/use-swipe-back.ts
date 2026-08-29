import { useCallback, useRef } from 'react'

/**
 * Swipe-back gesture: touch from left edge → navigate back.
 * Must be used inside a Router context.
 *
 * Usage:
 *   useSwipeBack({ threshold: 50, edgeWidth: 20 })
 */
interface UseSwipeBackOptions {
  /** Minimum horizontal distance to trigger back (default 60) */
  threshold?: number
  /** Left edge width in px to activate gesture (default 20) */
  edgeWidth?: number
  /** Disable the gesture (e.g., on certain routes) */
  disabled?: boolean
}

export function useSwipeBack(options: UseSwipeBackOptions = {}) {
  const { threshold = 60, edgeWidth = 20, disabled = false } = options
  const startXRef = useRef<number | null>(null)
  const startYRef = useRef<number | null>(null)
  const isTrackingRef = useRef(false)

  const onTouchStart = useCallback(
    (e: TouchEvent) => {
      if (disabled) return
      const touch = e.touches[0]
      if (touch.clientX <= edgeWidth) {
        startXRef.current = touch.clientX
        startYRef.current = touch.clientY
        isTrackingRef.current = true
      }
    },
    [disabled, edgeWidth],
  )

  const onTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isTrackingRef.current || startXRef.current === null) return
      const touch = e.touches[0]
      const dx = touch.clientX - startXRef.current
      const dy = Math.abs(touch.clientY - (startYRef.current ?? 0))
      if (dy > 40) {
        isTrackingRef.current = false
        startXRef.current = null
        return
      }
      if (dx > 0 && isTrackingRef.current) {
        e.preventDefault()
      }
    },
    [],
  )

  const onTouchEnd = useCallback(() => {
    if (!isTrackingRef.current) return
    isTrackingRef.current = false
    startXRef.current = null
    startYRef.current = null
  }, [])

  const checkBackGesture = useCallback(
    (dx: number): boolean => {
      if (disabled) return false
      return dx >= threshold
    },
    [disabled, threshold],
  )

  return { onTouchStart, onTouchMove, onTouchEnd, checkBackGesture }
}
