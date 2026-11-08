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
import { navTierOf } from './nav-tier'
import type { NavTier } from './nav-tier'

export type { NavTier } from './nav-tier'

export const SHOW_EXPERIMENTS =
  import.meta.env.DEV || import.meta.env.VITE_TERMINAL_SMOKE_BUILD === '1'

export interface NavItemConfig {
  path: string
  labelKey: string
  icon: React.ReactNode
  /** 是否在侧边栏显示，默认 true */
  sidebar?: boolean
  /** 条件显示（如 IS_DEV、team 模式），返回 true 则显示 */
  condition?: () => boolean
  tier?: NavTier
}

export const primaryNavConfig: NavItemConfig[] = [
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
