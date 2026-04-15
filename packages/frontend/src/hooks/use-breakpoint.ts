import { useCallback, useEffect, useState } from 'react'

/**
 * Tailwind-compatible breakpoints
 * xs    : 0    – 479px   (small mobile)
 * sm    : 480   – 639px   (mobile landscape / phablet)
 * md    : 640   – 767px   (tablet portrait)
 * lg    : 768   – 1023px  (tablet landscape)
 * xl    : 1024  – 1279px  (desktop)
 * 2xl   : 1280  – 1535px  (large desktop)
 * 3xl   : 1536+           (wide)
 */

type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'

const BREAKPOINTS: Record<Breakpoint, number> = {
  xs: 0,
  sm: 480,
  md: 640,
  lg: 768,
  xl: 1024,
  '2xl': 1280,
  '3xl': 1536,
}

/** Returns true when viewport width is at least `bp` */
export function useBreakpoint(bp: Breakpoint): boolean {
  const [match, setMatch] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth >= BREAKPOINTS[bp]
  })

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mq = window.matchMedia(`(min-width: ${BREAKPOINTS[bp]}px)`)
    const handler = (e: MediaQueryListEvent) => setMatch(e.matches)
    setMatch(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [bp])

  return match
}

/** Returns current active breakpoint key */
export function useCurrentBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() => {
    if (typeof window === 'undefined') return 'xl'
    const w = window.innerWidth
    if (w >= BREAKPOINTS['3xl']) return '3xl'
    if (w >= BREAKPOINTS['2xl']) return '2xl'
    if (w >= BREAKPOINTS.xl) return 'xl'
    if (w >= BREAKPOINTS.lg) return 'lg'
    if (w >= BREAKPOINTS.md) return 'md'
    if (w >= BREAKPOINTS.sm) return 'sm'
    return 'xs'
  })

  useEffect(() => {
    if (typeof window === 'undefined') return

    const thresholds = Object.entries(BREAKPOINTS).sort(([, a], [, b]) => b - a)
    const handler = () => {
      const w = window.innerWidth
      for (const [key, value] of thresholds) {
        if (w >= value) {
          setBp(key as Breakpoint)
          return
        }
      }
      setBp('xs')
    }

    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  return bp
}

/** Returns true when viewport width is at most `bp - 1` */
export function useBreakpointMax(bp: Breakpoint): boolean {
  const [match, setMatch] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < BREAKPOINTS[bp]
  })

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mq = window.matchMedia(`(max-width: ${BREAKPOINTS[bp] - 1}px)`)
    const handler = (e: MediaQueryListEvent) => setMatch(e.matches)
    setMatch(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [bp])

  return match
}

/** Returns true on mobile (xs + sm) */
export function useIsMobile(): boolean {
  return useBreakpointMax('md')
}

/** Returns true on tablet (md + lg) */
export function useIsTablet(): boolean {
  const bp = useCurrentBreakpoint()
  return bp === 'md' || bp === 'lg'
}

/** Returns true on desktop (xl+) */
export function useIsDesktop(): boolean {
  return useBreakpoint('xl')
}

/**
 * Returns a callback that is only called when NOT resizing (debounced).
 * Useful for layout effects triggered by window resize end.
 */
export function useResizeEndCallback(
  callback: () => void,
  delay = 150,
): () => void {
  const handleResize = useCallback(() => {
    let timer: ReturnType<typeof setTimeout>
    return () => {
      clearTimeout(timer)
      timer = setTimeout(callback, delay)
    }
  }, [callback, delay])

  return handleResize
}
