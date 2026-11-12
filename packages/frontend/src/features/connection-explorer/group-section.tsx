import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { Host } from '@/types'
import type { HostGroupSection } from './host-sections'
import { HostRow } from './host-row'

/** A collapsible group of hosts, with its member count. */
export function GroupSection({
  section,
  activeHostId,
  onConnect,
  onEdit,
  onToggleFavorite,
}: {
  section: HostGroupSection
  activeHostId: string | null
  onConnect: (host: Host) => void
  onEdit: (host: Host) => void
  onToggleFavorite: (hostId: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const title = section.group?.name ?? t('explorer.ungrouped')
  const testId = `explorer-group-${section.group?.id ?? 'ungrouped'}`

  return (
    <section className="pb-1" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 rounded px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={cn('size-3 transition-transform', open && 'rotate-90')}
          aria-hidden="true"
        />
        <span className="truncate">{title}</span>
        <span className="ml-auto tabular-nums">{section.hosts.length}</span>
      </button>
      {open
        ? section.hosts.map(host => (
            <HostRow
              key={host.id}
              host={host}
              onConnect={onConnect}
              onEdit={onEdit}
              onToggleFavorite={onToggleFavorite}
              active={host.id === activeHostId}
            />
          ))
        : null}
    </section>
  )
}
