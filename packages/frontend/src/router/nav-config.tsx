/**
 * 共享导航配置 - 侧边栏和路由共用同一数据源
 * 每次修改此处，两边自动同步
 */

import {
  ArrowLeftRight,
  Beaker,
  Code2,
  FileText,
  Fingerprint,
  Key,
  Server,
  Settings,
  Users,
} from 'lucide-react'
import type { RouteObject } from 'react-router-dom'
import { makeLazyRoute } from './lazy-route'

declare const IS_DEV: boolean

export interface NavItemConfig {
  path: string
  labelKey: string
  icon: React.ReactNode
  /** 是否在侧边栏显示，默认 true */
  sidebar?: boolean
  /** 条件显示（如 IS_DEV、team 模式），返回 true 则显示 */
  condition?: () => boolean
}

const lazyRoute = (importer: () => Promise<{ default: React.ComponentType<object> }>) =>
  makeLazyRoute(importer)

export const navConfig: NavItemConfig[] = [
  {
    path: '/hosts',
    labelKey: 'nav.hosts',
    icon: <Server className="size-5" />,
  },
  {
    path: '/teams',
    labelKey: 'nav.teams',
    icon: <Users className="size-5" />,
    // 不设 condition，由 AppSidebar 根据 isTeamEnabled 动态控制
  },
  {
    path: '/keychain',
    labelKey: 'nav.keychain',
    icon: <Key className="size-5" />,
  },
  {
    path: '/port-forward',
    labelKey: 'nav.portForward',
    icon: <ArrowLeftRight className="size-5" />,
  },
  {
    path: '/snippets',
    labelKey: 'nav.snippets',
    icon: <Code2 className="size-5" />,
  },
  {
    path: '/known-hosts',
    labelKey: 'nav.knownHosts',
    icon: <Fingerprint className="size-5" />,
  },
  {
    path: '/logs',
    labelKey: 'nav.logs',
    icon: <FileText className="size-5" />,
  },
  {
    path: '/settings',
    labelKey: 'nav.settings',
    icon: <Settings className="size-5" />,
  },
  {
    path: '/experiments',
    labelKey: 'nav.experiments',
    icon: <Beaker className="size-5" />,
    condition: () => IS_DEV,
  },
]

/**
 * 根据 condition 过滤后返回侧边栏可见的导航项
 */
export function getVisibleNavItems(): NavItemConfig[] {
  return navConfig.filter(item => item.condition == null || item.condition())
}

/**
 * 导出给路由用的完整 RouteObject 列表
 */
export function buildRoutes(): RouteObject[] {
  const visibleItems = getVisibleNavItems()
  const routes: RouteObject[] = [
    {
      index: true,
      element: lazyRoute(() => import('@/view/hosts')),
    },
    ...visibleItems.map(item => ({
      path: item.path.replace('/', ''),
      element: getRouteElement(item.path),
    })),
  ]

  // Experiments 子页面
  if (IS_DEV) {
    routes.push(
      {
        path: 'experiments/textarea-test',
        element: lazyRoute(() => import('@/experiments/textarea-test')),
      },
      {
        path: 'experiments/xterm-test',
        element: lazyRoute(() => import('@/experiments/xterm-test')),
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
    case '/port-forward':
      return lazyRoute(() => import('@/view/port-forward'))
    case '/snippets':
      return lazyRoute(() => import('@/view/snippets'))
    case '/known-hosts':
      return lazyRoute(() => import('@/view/known-hosts'))
    case '/logs':
      return lazyRoute(() => import('@/view/app-logs'))
    case '/settings':
      return lazyRoute(() => import('@/view/settings'))
    case '/experiments':
      return lazyRoute(() => import('@/experiments/index'))
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
