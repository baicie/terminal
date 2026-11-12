import { Plus, Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Host } from '@/types'
import type { RecentHost } from './recent-connections'
import type { HostGroupSection } from './host-sections'
import { HostRow } from './host-row'
import { GroupSection } from './group-section'
import { formatRelative } from './relative-time'

/**
 * The Connection Explorer body.
 *
 * Order is deliberate and matches how often each thing is wanted:
 * search → recent → favourites → groups. Recent sits above favourites because
 * "the server I was on five minutes ago" is the single most common target when
 * opening this panel.
 *
 * Every section is absent when it has nothing to show, and an empty search result
 * says so explicitly rather than leaving a blank pane that reads as a bug.
 */
export interface ExplorerSectionsProps {
  query: string
  onQueryChange: (value: string) => void
  recent: RecentHost[]
  recentFailed: boolean
  favorites: Host[]
  sections: HostGroupSection[]
  totalHosts: number
  activeHostId: string | null
  onConnect: (host: Host) => void
  onEdit: (host: Host) => void
  onToggleFavorite: (hostId: string) => void
  onNewHost: () => void
  /** Live host count for the scope label; `null` while the first load runs. */
  hostCountLabel: string
}

export function ExplorerSections({
  query,
  onQueryChange,
  recent,
  recentFailed,
  favorites,
  sections,
  totalHosts,
  activeHostId,
  onConnect,
  onEdit,
  onToggleFavorite,
  onNewHost,
  hostCountLabel,
}: ExplorerSectionsProps) {
  const { t, i18n } = useTranslation()
  const language = i18n.language
  const searching = query.trim() !== ''
  const visibleSections = sections.filter(section => section.hosts.length > 0)
  const nothingMatches =
    searching && visibleSections.length === 0 && favorites.length === 0 && recent.length === 0

  return (
    <>
      <div className="flex items-center gap-1 px-2 pb-2">
        <Input
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          placeholder={t('explorer.searchPlaceholder')}
          aria-label={t('explorer.searchPlaceholder')}
          className="h-8 text-sm"
          data-testid="explorer-search"
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onNewHost}
          aria-label={t('hosts.addHost')}
          title={t('hosts.addHost')}
          data-testid="explorer-new-host"
        >
          <Plus />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {nothingMatches ? (
          <p
            className="px-2 py-6 text-center text-xs text-muted-foreground"
            data-testid="explorer-no-results"
          >
            {t('explorer.noMatches', { query: query.trim() })}
          </p>
        ) : null}

        {!searching && recent.length > 0 ? (
          <Section title={t('explorer.recent')} testId="explorer-section-recent">
            {recent.map(entry => (
              <HostRow
                key={entry.host.id}
                host={entry.host}
                onConnect={onConnect}
                onEdit={onEdit}
                onToggleFavorite={onToggleFavorite}
                detail={formatRelative(entry.lastConnectedAt, language)}
                active={entry.host.id === activeHostId}
              />
            ))}
          </Section>
        ) : null}

        {!searching && recentFailed && recent.length === 0 ? (
          <p
            className="px-2 pb-2 text-[11px] text-muted-foreground"
            data-testid="explorer-recent-failed"
          >
            {t('explorer.recentUnavailable')}
          </p>
        ) : null}

        {!searching && favorites.length > 0 ? (
          <Section
            title={t('explorer.favorites')}
            testId="explorer-section-favorites"
            icon={<Star className="size-3 fill-current" aria-hidden="true" />}
          >
            {favorites.map(host => (
              <HostRow
                key={host.id}
                host={host}
                onConnect={onConnect}
                onEdit={onEdit}
                onToggleFavorite={onToggleFavorite}
                active={host.id === activeHostId}
              />
            ))}
          </Section>
        ) : null}

        {visibleSections.map(section => (
          <GroupSection
            key={section.group?.id ?? 'ungrouped'}
            section={section}
            activeHostId={activeHostId}
            onConnect={onConnect}
            onEdit={onEdit}
            onToggleFavorite={onToggleFavorite}
          />
        ))}

        {totalHosts === 0 && !searching ? (
          <p
            className="px-2 py-6 text-center text-xs text-muted-foreground"
            data-testid="explorer-empty"
          >
            {t('explorer.empty')}
          </p>
        ) : null}
      </div>

      <p className="shrink-0 border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        {hostCountLabel}
      </p>
    </>
  )
}

function Section({
  title,
  testId,
  icon,
  children,
}: {
  title: string
  testId: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="pb-2" data-testid={testId}>
      <h3 className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}
