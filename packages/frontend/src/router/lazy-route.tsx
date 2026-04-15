import type { ReactNode } from 'react'
import { lazy, Suspense } from 'react'

function Loading() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-muted-foreground">Loading...</div>
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
