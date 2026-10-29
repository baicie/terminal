import { useRef, useState } from 'react'

interface SwipeBackIndicatorProps {
  /** 0–1 progress, from 0 (no swipe) to 1 (threshold reached) */
  progress: number
  className?: string
}

/**
 * Visual arrow indicator that appears at the left edge
 * when the user is performing a swipe-back gesture.
 */
export function SwipeBackIndicator({ progress, className }: SwipeBackIndicatorProps) {
  const opacity = Math.min(progress * 1.5, 1)
  const scale = 0.5 + progress * 0.5
  if (progress === 0) return null

  return (
    <div
      className={`pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 ${className}`}
      style={{ opacity }}
    >
      {/* Arrow */}
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'left center',
        }}
      >
        <path
          d="M15 18l-6-6 6-6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

/**
 * Progress indicator overlay for swipe-back gesture.
 * Attach to a container element.
 */
export function useSwipeBackProgress(): {
  indicatorProgress: number
  onTouchStart: (e: TouchEvent) => void
  onTouchMove: (e: TouchEvent) => void
  onTouchEnd: (e: TouchEvent) => void
  indicatorRef: React.RefObject<HTMLDivElement | null>
} {
  const indicatorRef = useRef<HTMLDivElement>(null)
  const startXRef = useRef<number | null>(null)
  const startYRef = useRef<number | null>(null)
  const [indicatorProgress, setIndicatorProgress] = useState(0)

  const onTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0]
    if (touch.clientX <= 24) {
      startXRef.current = touch.clientX
      startYRef.current = touch.clientY
    }
  }

  const onTouchMove = (e: TouchEvent) => {
    if (startXRef.current === null) return
    const touch = e.touches[0]
    const dx = touch.clientX - startXRef.current
    const dy = Math.abs(touch.clientY - (startYRef.current ?? 0))
    if (dy > 50) {
      startXRef.current = null
      setIndicatorProgress(0)
      return
    }
    if (dx > 0) {
      setIndicatorProgress(Math.min(dx / 80, 1))
    } else {
      setIndicatorProgress(0)
    }
  }

  const onTouchEnd = () => {
    startXRef.current = null
    startYRef.current = null
    setIndicatorProgress(0)
  }

  return { indicatorProgress, onTouchStart, onTouchMove, onTouchEnd, indicatorRef }
}
