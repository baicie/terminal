import { Suspense, lazy, type ReactNode } from 'react'
import type { RouteObject } from 'react-router-dom'
import { createBrowserRouter } from 'react-router-dom'
import Layout from '../layout'
import { TerminalContainer } from '@/view/terminal/terminal-container'
import { useSearchParams } from 'react-router-dom'

const Loading = () => (
  <div className="flex items-center justify-center h-full">
    <div className="text-muted-foreground">Loading...</div>
  </div>
)

// Lazy wrapper: accepts any React component and returns a Suspense-wrapped lazy component
function makeLazyRoute(
  getComponent: () => Promise<{ default: React.ComponentType<any> }>,
): ReactNode {
  const LazyComponent = lazy(getComponent)
  return (
    <Suspense fallback={<Loading />}>
      <LazyComponent />
    </Suspense>
  )
}

/**
 * TerminalRoute — 从 URL query 参数 `?tab=xxx` 读取 tabId，
 * 直接渲染 TerminalContainer，无需复杂的 MobX 同步。
 */
const TerminalRoute: React.FC = () => {
  const [searchParams] = useSearchParams()
  const tabId = searchParams.get('tab') ?? ''

  console.log('[TerminalRoute] render', { tabId, fullUrl: window.location.href })

  return <TerminalContainer tabId={tabId} />
}

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    errorElement: <div>Error loading page</div>,
    children: [
      // Default route - Home/Hosts
      {
        index: true,
        element: makeLazyRoute(() => import('../view/hosts')),
      },
      // Hosts - SSH connections
      {
        path: 'hosts',
        element: makeLazyRoute(() => import('../view/hosts')),
      },
      // Terminal - 从 URL query 读取 tabId
      {
        path: 'terminal',
        element: <TerminalRoute />,
      },
      // SFTP - File transfer
      {
        path: 'sftp',
        element: makeLazyRoute(() => import('../view/sftp/sftp-container')),
      },
      // Vaults - Encrypted storage
      {
        path: 'vaults',
        element: makeLazyRoute(() => import('../view/vaults/vaults-container')),
      },
      // Keychain - SSH keys and certificates
      {
        path: 'keychain',
        element: makeLazyRoute(() => import('../view/keychain')),
      },
      // Port Forwarding - SSH tunnels
      {
        path: 'port-forward',
        element: makeLazyRoute(() => import('../view/port-forward')),
      },
      // Snippets - Command scripts
      {
        path: 'snippets',
        element: makeLazyRoute(() => import('../view/snippets')),
      },
      // Known Hosts - SSH host fingerprints
      {
        path: 'known-hosts',
        element: makeLazyRoute(() => import('../view/known-hosts')),
      },
      // Logs - Connection history
      {
        path: 'logs',
        element: makeLazyRoute(() => import('../view/app-logs')),
      },
      // Scripts - Advanced scripting and batch execution
      {
        path: 'scripts',
        element: makeLazyRoute(() => import('../view/scripts')),
      },
      // Teams - Team collaboration
      {
        path: 'teams',
        element: makeLazyRoute(() => import('../view/teams')),
      },
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
