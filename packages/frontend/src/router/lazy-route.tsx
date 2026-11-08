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

// Starts the import when the route table is built (router construction) instead
// of waiting for the first navigation, so every view is loaded during startup
// and the first click reads the module cache. The import is still a separate
// chunk, which keeps the initial shell small.
export function makeLazyRoute(
  getComponent: () => Promise<{ default: React.ComponentType<object> }>,
): ReactNode {
  const loaded = getComponent()
  // A rejected preload must not surface as an unhandled rejection; the lazy
  // boundary still receives the same rejection when the route is visited.
  void loaded.catch(() => undefined)
  const LazyComponent = lazy(() => loaded)
  return (
    <Suspense fallback={<Loading />}>
      <LazyComponent />
    </Suspense>
  )
}
