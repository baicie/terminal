/**
 * One lazy route element per view path.
 *
 * A leaf module: it imports the view chunks and nothing else. It used to live
 * inside `nav-config.tsx`; keeping it separate there is safe because neither it
 * nor `nav-config` is mutated by the route table - what must NOT be moved out is
 * `buildRoutes` itself, whose experiments imports decide how Rollup groups the
 * xterm chunks (moving those once grew the addons chunk from 57 KB to 139 KB gzip).
 */

import { makeLazyRoute } from './lazy-route'

export const lazyRoute = (
  importer: () => Promise<{ default: React.ComponentType<object> }>,
) => makeLazyRoute(importer)

export function getRouteElement(path: string) {
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
