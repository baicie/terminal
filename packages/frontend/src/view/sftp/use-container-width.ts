/**
 * How wide is the box this component is actually in?
 *
 * The dock is 300px wide inside a 1440px viewport, so `useBreakpointMax('md')` — the
 * phone-layout switch the SFTP view already uses — answers "desktop" for a container
 * that cannot hold two file panes side by side. A media query measures the window;
 * what matters here is the container.
 *
 * `ResizeObserver` is the only thing that reports the second one. The fallback path
 * exists for environments without it (jsdom in older setups, SSR) and reports the
 * viewport, which is the best available guess rather than a crash.
 *
 * The first measurement is deliberately `null` rather than 0: "not measured yet" and
 * "measured as zero" want opposite decisions, and a component that renders the
 * two-pane layout for one frame before collapsing is a visible flash.
 */
import { useEffect, useRef, useState } from 'react'

export interface ContainerWidth {
  /** Measured width in CSS pixels, or null before the first measurement. */
  width: number | null
  /** Attach to the element whose width matters. */
  ref: React.RefObject<HTMLDivElement | null>
}

export function useContainerWidth(): ContainerWidth {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const element = ref.current
    if (!element) return

    if (typeof ResizeObserver === 'undefined') {
      const measure = () => setWidth(element.getBoundingClientRect().width)
      measure()
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }

    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const next = entry.contentRect.width
      if (Number.isFinite(next) && next > 0) setWidth(next)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { width, ref }
}

/**
 * Below this, two file panes side by side leave each pane too narrow to show a
 * usable file name.
 *
 * **Measured against the same box the observer reports.** `entry.contentRect.width`
 * is the content box: it already excludes the pane's own padding. The budget is
 * therefore 496 content px = 520 outer px − 24 px of horizontal padding (`p-3` is
 * 12 px each side). Stating it as 520 while comparing content widths made the
 * switch happen ~24 px later than the number claimed.
 *
 * Inside 496 content px the two panes are ~230px each after the 12px gap, which fits
 * a name column plus a size column. The dock is 300 outer (276 content), so it is
 * always single-pane; the full `/sftp` view at any sane window is always two.
 */
export const TWO_PANE_MIN_WIDTH = 496

export function pansNeedSingleColumn(width: number | null): boolean {
  // Unmeasured counts as narrow: rendering two panes and then collapsing is a
  // visible flash, and showing one pane for a frame is not.
  if (width === null) return true
  return width < TWO_PANE_MIN_WIDTH
}
