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
  FolderUp,
  Key,
  Server,
  Settings,
  Shield,
  Users,
} from 'lucide-react'
import type { RouteObject } from 'react-router-dom'
import { makeLazyRoute } from './lazy-route'

const SHOW_EXPERIMENTS =
  import.meta.env.DEV || import.meta.env.VITE_TERMINAL_SMOKE_BUILD === '1'

export interface NavItemConfig {
  path: string
  labelKey: string
  icon: React.ReactNode
  /** 是否在侧边栏显示，默认 true */
  sidebar?: boolean
  /** 条件显示（如 IS_DEV、team 模式），返回 true 则显示 */
  condition?: () => boolean
}

type RouteImporter = () => Promise<{ default: React.ComponentType<object> }>

const lazyRoute = (importer: RouteImporter) => makeLazyRoute(importer)

/**
 * Every routed view, imported once here. `preloadRoutes()` starts all of them
 * as soon as the router exists, so the first navigation reads an already
 * loaded module instead of showing a loading placeholder. The dynamic imports
 * stay so the initial HTML/JS shell is not blocked by view code; nothing is
 * deferred until the user clicks.
 */
const ROUTE_IMPORTERS = {
  hosts: () => import('@/view/hosts'),
  teams: () => import('@/view/teams'),
  keychain: () => import('@/view/keychain'),
  vaults: () => import('@/view/vaults/vaults-view'),
  portForward: () => import('@/view/port-forward'),
  snippets: () => import('@/view/snippets'),
  knownHosts: () => import('@/view/known-hosts'),
  logs: () => import('@/view/app-logs'),
  sftp: () => import('@/view/sftp/sftp-container'),
  settings: () => import('@/view/settings'),
} satisfies Record<string, RouteImporter>

const EXPERIMENT_IMPORTERS = {
  experiments: () => import('@/experiments/index'),
  textareaTest: () => import('@/experiments/textarea-test'),
  xtermTest: () => import('@/experiments/xterm-test'),
  terminalInputProbe: () => import('@/experiments/terminal-input-probe'),
} satisfies Record<string, RouteImporter>

/** Start every route chunk now; failures surface on navigation, not here. */
export function preloadRoutes(): void {
  const importers: RouteImporter[] = Object.values(ROUTE_IMPORTERS)
  if (SHOW_EXPERIMENTS) importers.push(...Object.values(EXPERIMENT_IMPORTERS))
  for (const load of importers) void load().catch(() => undefined)
}

const primaryNavConfig: NavItemConfig[] = [
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
    path: '/vaults',
    labelKey: 'vaults.title',
    icon: <Shield className="size-5" />,
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
    path: '/sftp',
    labelKey: 'nav.sftp',
    icon: <FolderUp className="size-5" />,
  },
  {
    path: '/settings',
    labelKey: 'nav.settings',
    icon: <Settings className="size-5" />,
  },
]

export const navConfig: NavItemConfig[] = SHOW_EXPERIMENTS
  ? [
      ...primaryNavConfig,
      {
        path: '/experiments',
        labelKey: 'nav.experiments',
        icon: <Beaker className="size-5" />,
      },
    ]
  : primaryNavConfig

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
  const routes: RouteObject[] = [
    {
      index: true,
      element: lazyRoute(ROUTE_IMPORTERS.hosts),
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
        element: lazyRoute(EXPERIMENT_IMPORTERS.experiments),
      },
      {
        path: 'experiments/textarea-test',
        element: lazyRoute(EXPERIMENT_IMPORTERS.textareaTest),
      },
      {
        path: 'experiments/xterm-test',
        element: lazyRoute(EXPERIMENT_IMPORTERS.xtermTest),
      },
      {
        path: 'experiments/terminal-input-probe',
        element: lazyRoute(EXPERIMENT_IMPORTERS.terminalInputProbe),
      },
    )
  }

  return routes
}

function getRouteElement(path: string) {
  switch (path) {
    case '/hosts':
      return lazyRoute(ROUTE_IMPORTERS.hosts)
    case '/teams':
      return lazyRoute(ROUTE_IMPORTERS.teams)
    case '/keychain':
      return lazyRoute(ROUTE_IMPORTERS.keychain)
    case '/vaults':
      return lazyRoute(ROUTE_IMPORTERS.vaults)
    case '/port-forward':
      return lazyRoute(ROUTE_IMPORTERS.portForward)
    case '/snippets':
      return lazyRoute(ROUTE_IMPORTERS.snippets)
    case '/known-hosts':
      return lazyRoute(ROUTE_IMPORTERS.knownHosts)
    case '/logs':
      return lazyRoute(ROUTE_IMPORTERS.logs)
    case '/sftp':
      return lazyRoute(ROUTE_IMPORTERS.sftp)
    case '/settings':
      return lazyRoute(ROUTE_IMPORTERS.settings)
    default:
      return lazyRoute(ROUTE_IMPORTERS.hosts)
  }
}

// 注意：故意没有 '/terminal' 分支。
// 终端路由由 router/index.tsx 写死为 <TerminalRoute /> → null，
// 实际渲染走 layout 内常驻的 <TerminalByUrl />，这样切换路由时
// 终端实例不会被 Outlet 销毁，可在后台继续保持连接。
// 同时 navConfig 数组里也没有 '/terminal'，所以这个 switch case
// 永远到不了，曾经存在的分支是死代码并触发 INEFFECTIVE_DYNAMIC_IMPORT。
