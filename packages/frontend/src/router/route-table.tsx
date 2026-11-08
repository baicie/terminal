/**
 * Route table built from the shared navigation config.
 *
 * Split out of `nav-config.tsx` to keep that file inside its line limit; the data
 * stays there so the sidebar and the router keep one source.
 */

import type { RouteObject } from 'react-router-dom'
import { primaryNavConfig, SHOW_EXPERIMENTS } from './nav-config'
import { makeLazyRoute } from './lazy-route'

const lazyRoute = (importer: () => Promise<{ default: React.ComponentType<object> }>) =>
  makeLazyRoute(importer)


export function buildRoutes(): RouteObject[] {
  const routes: RouteObject[] = [
    {
      // Terminal first: opening the app must land on something you can type in,
      // not on a host management table (Phase 10 audit C1/C2).
      //
      // The element is deliberately null. The terminal is rendered by the layout's
      // always-mounted `TerminalByUrl`, never by a route: a route that rendered it
      // would mount a second TerminalContainer for the same tab id, which creates
      // two PTYs and two event listeners (see router/index.tsx).
      index: true,
      element: null,
    },
    ...primaryNavConfig.map(item => ({
      path: item.path.replace('/', ''),
      element: getRouteElement(item.path),
    })),
  ]

  // Experiments 子页面
  if (SHOW_EXPERIMENTS) {
    routes.push(
      {
        path: 'experiments',
        element: lazyRoute(() => import('@/experiments/index')),
      },
      {
        path: 'experiments/textarea-test',
        element: lazyRoute(() => import('@/experiments/textarea-test')),
      },
      {
        path: 'experiments/xterm-test',
        element: lazyRoute(() => import('@/experiments/xterm-test')),
      },
      {
        path: 'experiments/terminal-input-probe',
        element: lazyRoute(() => import('@/experiments/terminal-input-probe')),
      },
    )
  }

  return routes
}

function getRouteElement(path: string) {
  switch (path) {
    case '/hosts':
      return lazyRoute(() => import('@/view/hosts'))
    case '/teams':
      return lazyRoute(() => import('@/view/teams'))
    case '/keychain':
      return lazyRoute(() => import('@/view/keychain'))
    case '/vaults':
      return lazyRoute(() => import('@/view/vaults/vaults-view'))
    case '/port-forward':
      return lazyRoute(() => import('@/view/port-forward'))
    case '/snippets':
      return lazyRoute(() => import('@/view/snippets'))
    case '/known-hosts':
      return lazyRoute(() => import('@/view/known-hosts'))
    case '/logs':
      return lazyRoute(() => import('@/view/app-logs'))
    case '/sftp':
      return lazyRoute(() => import('@/view/sftp/sftp-container'))
    case '/settings':
      return lazyRoute(() => import('@/view/settings'))
    default:
      return lazyRoute(() => import('@/view/hosts'))
  }
}

// 注意：故意没有 '/terminal' 分支。
// 终端路由由 router/index.tsx 写死为 <TerminalRoute /> → null，
// 实际渲染走 layout 内常驻的 <TerminalByUrl />，这样切换路由时
// 终端实例不会被 Outlet 销毁，可在后台继续保持连接。
// 同时 navConfig 数组里也没有 '/terminal'，所以这个 switch case
// 永远到不了，曾经存在的分支是死代码并触发 INEFFECTIVE_DYNAMIC_IMPORT。
