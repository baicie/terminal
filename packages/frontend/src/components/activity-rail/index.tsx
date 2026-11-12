import { useTranslation } from 'react-i18next'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { getVisibleNavItems, type NavItemConfig } from '@/router/nav-config.tsx'
import { navTierOf } from '@/router/nav-tier'
import { useAppStore } from '@/store/app'

/**
 * The 46px tool rail on the left edge.
 *
 * What it is: a switch between the surfaces a terminal user actually moves
 * between — the terminal itself, connections, files, keys. What it is not: a page
 * navigation for every route in the app. Advanced surfaces (teams, logs, known
 * hosts, vaults) stay reachable from the navigation panel and the command palette.
 *
 * Since UX-1b the rail also decides **which left panel is open**, because the rail
 * and a permanent sidebar listing the same destinations was the double-navigation
 * regression. Two entries behave differently from the rest:
 *
 * - the terminal entry closes the panel, giving the canvas the full width;
 * - the connections entry toggles the Connection Explorer, and does not navigate
 *   away from the terminal — connecting is something you do *while* staying in the
 *   canvas.
 *
 * The remaining entries are ordinary links into the management surfaces. They keep
 * `/hosts`, `/sftp` and the rest working as deep links, exactly as before.
 */

const RAIL_ITEMS = ['/hosts', '/sftp', '/keychain', '/snippets', '/port-forward']

function railItems(): NavItemConfig[] {
  const byPath = new Map(getVisibleNavItems().map(item => [item.path, item]))
  return RAIL_ITEMS.map(path => byPath.get(path)).filter(
    (item): item is NavItemConfig => item !== undefined,
  )
}

export function ActivityRail({ className }: { className?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const leftPanel = useAppStore(state => state.leftPanel)
  const setLeftPanel = useAppStore(state => state.setLeftPanel)
  const items = railItems()

  const openConnections = () => {
    const next = leftPanel === 'explorer' ? 'none' : 'explorer'
    setLeftPanel(next)
    // Focus the canvas the operator is about to connect into. This does not
    // navigate: leaving `/terminal` would hide the terminal the panel exists to
    // feed.
    navigate('/terminal')
  }

  return (
    <nav
      aria-label={t('toolbar.activityRail')}
      data-testid="activity-rail"
      className={cn(
        'flex w-[46px] shrink-0 flex-col items-center gap-1 border-r border-border/60 bg-background py-2',
        className,
      )}
    >
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => {
              setLeftPanel('none')
              navigate('/terminal')
            }}
            aria-pressed={leftPanel === 'none'}
            data-testid="rail-terminal"
            className={cn(
              railItemClass(),
              leftPanel === 'none' && 'bg-secondary text-foreground',
            )}
          >
            <TerminalGlyph />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('app.name')}</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={openConnections}
            aria-pressed={leftPanel === 'explorer'}
            aria-label={t('explorer.title')}
            data-testid="rail-connections"
            className={cn(
              railItemClass(),
              leftPanel === 'explorer' && 'bg-secondary text-foreground',
            )}
          >
            <ConnectionsGlyph />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('explorer.title')}</TooltipContent>
      </Tooltip>

      <div className="my-1 h-px w-5 bg-border/60" aria-hidden="true" />

      {items.map(item => (
        <Tooltip key={item.path} delayDuration={300}>
          <TooltipTrigger asChild>
            <NavLink
              to={item.path}
              data-testid={`rail-${item.path.replace(/^\//, '')}`}
              data-tier={navTierOf(item)}
              className={({ isActive }) =>
                cn(railItemClass(), isActive && 'bg-secondary text-foreground')
              }
            >
              {item.icon}
            </NavLink>
          </TooltipTrigger>
          <TooltipContent side="right">{t(item.labelKey)}</TooltipContent>
        </Tooltip>
      ))}
    </nav>
  )
}

function railItemClass() {
  return 'flex size-9 items-center justify-center rounded-md transition-colors text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
}

/** The terminal glyph, kept local so the rail does not import the whole icon set. */
function TerminalGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

/** A server stack: the connections list, not the terminal. */
function ConnectionsGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <rect x="3" y="4" width="18" height="7" rx="1" />
      <rect x="3" y="13" width="18" height="7" rx="1" />
      <line x1="7" y1="7.5" x2="7.01" y2="7.5" />
      <line x1="7" y1="16.5" x2="7.01" y2="16.5" />
    </svg>
  )
}
