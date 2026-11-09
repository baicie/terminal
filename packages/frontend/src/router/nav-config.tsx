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
import { getRouteElement, lazyRoute } from './view-route-elements'
import { navTierOf } from './nav-tier'
import type { NavTier } from './nav-tier'

export type { NavTier } from './nav-tier'

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
  /**
   * Sidebar placement. Presentational only: every route keeps working, advanced
   * items are still listed, just below the daily ones (Phase 10 M3).
   */
  tier?: NavTier
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
    tier: 'advanced',
    // 不设 condition，由 AppSidebar 根据 isTeamEnabled 动态控制
  },
  {
    path: '/keychain',
    labelKey: 'nav.keychain',
    icon: <Key className="size-5" />,
    tier: 'secondary',
  },
  {
    path: '/vaults',
    labelKey: 'vaults.title',
    icon: <Shield className="size-5" />,
    tier: 'advanced',
  },
  {
    path: '/port-forward',
    labelKey: 'nav.portForward',
    icon: <ArrowLeftRight className="size-5" />,
    tier: 'secondary',
  },
  {
    path: '/snippets',
    labelKey: 'nav.snippets',
    icon: <Code2 className="size-5" />,
    tier: 'secondary',
  },
  {
    path: '/known-hosts',
    labelKey: 'nav.knownHosts',
    icon: <Fingerprint className="size-5" />,
    tier: 'advanced',
  },
  {
    path: '/logs',
    labelKey: 'nav.logs',
    icon: <FileText className="size-5" />,
    tier: 'advanced',
  },
  {
    path: '/sftp',
    labelKey: 'nav.sftp',
    icon: <FolderUp className="size-5" />,
    tier: 'primary',
  },
  {
    path: '/settings',
    labelKey: 'nav.settings',
    icon: <Settings className="size-5" />,
    tier: 'secondary',
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

/** Visible items of one tier, in declaration order. */
export function getNavItemsByTier(tier: NavTier): NavItemConfig[] {
  return getVisibleNavItems().filter(item => navTierOf(item) === tier)
}

/**
 * 导出给路由用的完整 RouteObject 列表
 */
export function buildRoutes(): RouteObject[] {
  const routes: RouteObject[] = [
    {
      // Terminal first: opening the app must land on something you can type in,
      // not on a host management table (Phase 10 audit C1/C2).
      //
      // The element is deliberately null: the terminal is rendered by the layout's
      // always-mounted `TerminalByUrl`. A route that rendered it would mount a
      // second TerminalContainer for the same tab id (see router/index.tsx).
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


// 注意：故意没有 '/terminal' 分支。
// 终端路由由 router/index.tsx 写死为 <TerminalRoute /> → null，
// 实际渲染走 layout 内常驻的 <TerminalByUrl />，这样切换路由时
// 终端实例不会被 Outlet 销毁，可在后台继续保持连接。
// 同时 navConfig 数组里也没有 '/terminal'，所以这个 switch case
// 永远到不了，曾经存在的分支是死代码并触发 INEFFECTIVE_DYNAMIC_IMPORT。
