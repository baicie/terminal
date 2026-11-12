import { AlertCircle, Database, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { Host } from '@/types'
import { ExplorerSections } from './explorer-sections'
import { favoriteHosts, filterHosts, groupHosts } from './host-sections'
import { useExplorerHosts } from './use-explorer-hosts'

/**
 * The Connection Explorer panel.
 *
 * What it is: a way to get from "the app is open" to "I am on prod-01" without
 * leaving the terminal. What it is not: a second Hosts page. Editing, importing,
 * sharing and bulk management stay on `/hosts`, which keeps working as a deep link
 * and keeps every one of its existing capabilities.
 *
 * **It never owns terminal state.** No tab is created here except by the connect
 * action, no session is started here, and closing the panel changes nothing about
 * a running PTY — the panel is a sibling of `TerminalByUrl` in the layout, not a
 * parent of it.
 *
 * Width comes from the caller (`main-layout-content.tsx`), which already owns
 * `terminal.sidebar.width` and the resize separator. The panel takes a width, it
 * does not keep one.
 */
export interface ConnectionExplorerProps {
  width: number
  resizing?: boolean
  className?: string
  onConnect: (host: Host) => void
  onEdit: (host: Host) => void
  onNewHost: () => void
  activeHostId?: string | null
}

export function ConnectionExplorer({
  width,
  resizing,
  className,
  onConnect,
  onEdit,
  onNewHost,
  activeHostId = null,
}: ConnectionExplorerProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const data = useExplorerHosts(true)

  const matching = filterHosts(data.hosts, query)
  const sections = groupHosts(matching, data.groups)
  const favorites = query.trim() === '' ? favoriteHosts(data.hosts) : []
  // A search narrows Recent too: a "recent" row that does not match the query
  // would contradict the search box sitting directly above it.
  const recent =
    query.trim() === ''
      ? data.recent
      : data.recent.filter(entry =>
          `${entry.host.name} ${entry.host.hostname}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        )

  return (
    <aside
      style={{ width }}
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border/60 bg-secondary/20',
        !resizing && 'transition-all duration-200',
        className,
      )}
      aria-label={t('explorer.title')}
      data-testid="connection-explorer"
    >
      <header className="flex h-9 shrink-0 items-center border-b border-border/60 px-3">
        <span className="truncate text-sm font-semibold text-foreground">
          {t('explorer.title')}
        </span>
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          {data.loading && data.hosts.length === 0 ? '…' : data.hosts.length}
        </span>
      </header>

      {data.loadError !== null ? (
        <div className="p-2">
          <Alert variant="destructive" data-testid="explorer-load-failed">
            <AlertCircle className="size-4" aria-hidden="true" />
            <AlertTitle>{t('explorer.loadFailed')}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p className="font-mono text-[11px] break-all">{data.loadError}</p>
              <Button variant="outline" size="sm" onClick={data.reload}>
                <RefreshCw data-icon="inline-start" />
                {t('common.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {data.loadError === null && !data.dbAvailable ? (
        // "No database" is not "no hosts": saying the list is empty would blame
        // the user for a broken connection to the app's own storage.
        <div className="p-2">
          <Alert data-testid="explorer-db-unavailable">
            <Database className="size-4" aria-hidden="true" />
            <AlertTitle>{t('explorer.dbUnavailableTitle')}</AlertTitle>
            <AlertDescription>{t('explorer.dbUnavailable')}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      {data.loadError === null && !data.dbAvailable ? null : data.loading &&
        data.hosts.length === 0 ? (
        <div className="space-y-2 p-2" data-testid="explorer-loading">
          {[0, 1, 2, 3].map(index => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : (
        <ExplorerSections
          query={query}
          onQueryChange={setQuery}
          recent={recent}
          recentFailed={data.recentFailed}
          favorites={favorites}
          sections={sections}
          totalHosts={data.hosts.length}
          activeHostId={activeHostId}
          onConnect={onConnect}
          onEdit={onEdit}
          onToggleFavorite={data.toggleFavorite}
          onNewHost={onNewHost}
          hostCountLabel={t('explorer.count', { count: matching.length })}
        />
      )}
    </aside>
  )
}
