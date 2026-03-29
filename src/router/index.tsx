import type { RouteObject } from 'react-router-dom'
import { createBrowserRouter, useSearchParams } from 'react-router-dom'
import ErrorBoundary from '@/components/error-boundary'
import { TerminalContainer } from '@/view/terminal/terminal-container'
import Layout from '../layout'
import { buildRoutes } from './nav-config.tsx'
import { makeLazyRoute } from './lazy-route.tsx'

export { makeLazyRoute }

/**
 * TerminalRoute — 从 URL query 参数 `?tab=xxx` 读取 tabId，
 * 直接渲染 TerminalContainer，无需复杂的 MobX 同步。
 */
const TerminalRoute: React.FC = () => {
  const [searchParams] = useSearchParams()
  const tabId = searchParams.get('tab') ?? ''

  return <TerminalContainer tabId={tabId} />
}

const routes: RouteObject[] = [
  {
    element: <Layout />,
    errorElement: <ErrorBoundary />,
    children: [
      // Terminal - 特殊路由，从 URL query 读取 tabId
      {
        path: 'terminal',
        element: <TerminalRoute />,
      },
      // 其他路由从 nav-config 自动生成
      ...buildRoutes(),
    ],
  },
  {
    path: '*',
    element: (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">404</h1>
          <p className="text-muted-foreground">Page not found</p>
        </div>
      </div>
    ),
  },
]

export const router = createBrowserRouter(routes)
