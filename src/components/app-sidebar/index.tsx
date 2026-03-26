import {
  ArrowLeftRight,
  Code2,
  FileText,
  Fingerprint,
  Key,
  PanelLeft,
  PanelLeftClose,
  Server,
  Terminal,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useIsTeamEnabled } from '@/store/team'

interface NavItemConfig {
  path: string
  labelKey: string
  icon: React.ReactNode
}

interface NavItemProps {
  item: NavItemConfig
  iconOnly?: boolean
  className?: string
  style?: React.CSSProperties
}

const NavItem: React.FC<NavItemProps> = ({
  item,
  iconOnly,
  className,
  style,
}) => {
  const { t } = useTranslation()
  const location = useLocation()
  const hostsPaths = ['/', '/hosts']
  const pathActive =
    item.path === '/hosts'
      ? hostsPaths.includes(location.pathname)
      : location.pathname === item.path ||
        location.pathname.startsWith(`${item.path}/`)

  const linkContent = (
    <NavLink
      to={item.path === '/hosts' ? '/hosts' : item.path}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150',
        'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
        pathActive && 'bg-secondary/80 text-foreground shadow-sm',
        iconOnly && 'justify-center px-2',
        className,
      )}
      style={style}
    >
      {item.icon}
      {!iconOnly && (
        <span className="text-sm font-medium truncate">{t(item.labelKey)}</span>
      )}
    </NavLink>
  )

  if (iconOnly) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
        <TooltipContent side="right">
          <p>{t(item.labelKey)}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return linkContent
}

interface AppSidebarProps {
  onToggleCollapse?: () => void
  /** 由父级传入像素宽度 */
  width?: number
  /** 拖拽中禁用过渡 */
  resizing?: boolean
}

/** 宽度低于此值显示图标模式 */
const ICON_ONLY_THRESHOLD = 90

const AppSidebar: React.FC<AppSidebarProps> = ({
  onToggleCollapse,
  width,
  resizing,
}) => {
  const { t } = useTranslation()
  const iconOnly = width != null && width < ICON_ONLY_THRESHOLD
  const isTeamEnabled = useIsTeamEnabled()

  // Build navigation items based on team mode
  const navItems: NavItemConfig[] = [
    {
      path: '/hosts',
      labelKey: 'nav.hosts',
      icon: <Server className="size-5" />,
    },
    // Teams item - only show when team mode is enabled
    ...(isTeamEnabled
      ? [
          {
            path: '/teams',
            labelKey: 'nav.teams',
            icon: <Users className="size-5" />,
          },
        ]
      : []),
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
      path: '/scripts',
      labelKey: 'nav.scripts',
      icon: <Terminal className="size-5" />,
    },
  ]

  return (
    <div
      className={cn(
        'h-full bg-secondary/40 border-r border-border/60 flex flex-col shrink-0 min-h-0',
        !resizing && 'transition-all duration-200',
      )}
      style={width != null ? { width } : undefined}
    >
      {/* Header with collapse button */}
      <div className="px-3 py-3 border-b border-border/60 flex items-center justify-between">
        <span
          className={cn(
            'text-sm font-semibold text-foreground truncate transition-opacity duration-200',
            iconOnly && 'opacity-0 pointer-events-none',
          )}
        >
          {t('app.name')}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className={cn('size-7 shrink-0', iconOnly && 'mx-auto')}
          onClick={onToggleCollapse}
          title={iconOnly ? t('sidebar.expand') : t('sidebar.collapse')}
        >
          {iconOnly ? (
            <PanelLeft className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </Button>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {navItems.map((item, index) => (
          <NavItem
            key={item.path}
            item={item}
            iconOnly={iconOnly}
            className="slide-in-from-left fade-in"
            style={{ animationDelay: `${index * 40}ms` }}
          />
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-border/60">
        <p
          className={cn(
            'text-[11px] text-muted-foreground/70 px-3 transition-opacity duration-200',
            iconOnly && 'opacity-0',
          )}
        >
          {t('app.version')}
        </p>
      </div>
    </div>
  )
}

export default AppSidebar
