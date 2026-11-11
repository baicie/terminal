import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { getVisibleNavItems, type NavItemConfig } from '@/router/nav-config.tsx'
import { navTierOf } from '@/router/nav-tier'

/**
 * The 46px tool rail on the left edge.
 *
 * What it is: a switch between the surfaces a terminal user actually moves
 * between — the terminal itself, connections, files, keys. What it is not: a page
 * navigation for every route in the app. Advanced surfaces (teams, logs, known
 * hosts, vaults) stay reachable from the command palette and the more menu; they
 * are not worth a permanent pixel of the terminal's width.
 *
 * It reuses `getVisibleNavItems()` rather than defining its own list, so a route
 * added or hidden in `nav-config.tsx` behaves the same here as in the sidebar. The
 * `primary` tier is exactly the set the design calls for.
 *
 * Clicking a rail item navigates with the router. It must never touch the terminal
 * layer: `TerminalByUrl` lives in `main-layout-content.tsx`, outside the outlet, so
 * a route change hides it (`invisible`) and the PTY + output ACK keep running.
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
  const items = railItems()

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
          <NavLink
            to="/terminal"
            data-testid="rail-terminal"
            className={({ isActive }) =>
              cn(
                'flex size-9 items-center justify-center rounded-md transition-colors',
                isActive
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
              )
            }
          >
            <TerminalGlyph />
          </NavLink>
        </TooltipTrigger>
        <TooltipContent side="right">{t('app.name')}</TooltipContent>
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
                cn(
                  'flex size-9 items-center justify-center rounded-md transition-colors',
                  isActive
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                )
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
