import type { RouteObject } from 'react-router-dom'
import { createBrowserRouter } from 'react-router-dom'
import ErrorBoundary from '@/components/error-boundary'
import Layout from '../layout'
import { buildRoutes } from './nav-config.tsx'
import { makeLazyRoute } from './lazy-route.tsx'

export { makeLazyRoute }

/**
 * TerminalRoute — 占位路由，**故意返回 null**。
 *
 * 终端的实际渲染由 layout 中始终挂载的 `<TerminalByUrl />` 处理，
 * 这样在切换到非 /terminal 路由（如 /hosts）时，终端实例不会被
 * Outlet 销毁，继续在后台保持连接。
 *
 * 如果这里再渲染一份 TerminalContainer，就会出现「同一个 tabId
 * 同时存在两个 TerminalContainer 实例」，导致后端创建 2 个 PTY
 * session、注册 2 个事件监听器，且两个实例的 sessionId 互相不
 * 匹配，输出永远写不到任何一个 xterm 上。
 */
const TerminalRoute: React.FC = () => null

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
