import type { ReactNode } from 'react'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Route chunks are preloaded at startup; this fallback only covers the rare
 * case where a chunk is still in flight. It is a silent skeleton rather than
 * a "Loading..." label, so a slow first paint never reads as a stalled page.
 */
function Loading() {
  const { t } = useTranslation()
  return (
    <div
      className="flex h-full items-center justify-center"
      role="status"
      aria-busy="true"
      aria-label={t('common.loading')}
    >
      <div className="h-24 w-40 animate-pulse rounded-md bg-muted/50" />
    </div>
  )
}

// Lazy wrapper: accepts any React component and returns a Suspense-wrapped lazy component
export function makeLazyRoute(
  getComponent: () => Promise<{ default: React.ComponentType<object> }>,
): ReactNode {
  const LazyComponent = lazy(getComponent)
  return (
    <Suspense fallback={<Loading />}>
      <LazyComponent />
    </Suspense>
  )
}
