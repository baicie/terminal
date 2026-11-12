import { useTranslation } from 'react-i18next'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Host } from '@/types'

/**
 * One host row in the Explorer.
 *
 * A row is a button, not a link: connecting creates a *new* tab, so there is no
 * URL to open in a new window and nothing for a middle-click to do. Making it an
 * anchor would promise browser semantics the action does not have.
 *
 * The right-click/context-menu actions are exposed through the same row: the
 * menu is a `ContextMenu` in the list, this component only renders the target.
 */
export interface HostRowProps {
  host: Host
  onConnect: (host: Host) => void
  onEdit: (host: Host) => void
  onToggleFavorite: (hostId: string) => void
  /** Shown as a relative timestamp; only present in the Recent section. */
  detail?: string
  active?: boolean
}

export function HostRow({
  host,
  onConnect,
  onEdit,
  onToggleFavorite,
  detail,
  active,
}: HostRowProps) {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-md pr-1',
        'hover:bg-secondary/60 focus-within:bg-secondary/60',
        active && 'bg-secondary/70',
      )}
      data-testid={`explorer-host-${host.id}`}
    >
      <button
        type="button"
        onClick={() => onConnect(host)}
        onDoubleClick={() => onConnect(host)}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={`${host.username}@${host.hostname}:${host.port}`}
        aria-label={t('explorer.connectTo', { name: host.name })}
      >
        <span className="w-full truncate text-sm text-foreground">{host.name}</span>
        <span className="w-full truncate text-[11px] text-muted-foreground">
          {detail ?? `${host.username}@${host.hostname}`}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onToggleFavorite(host.id)}
        aria-label={
          host.isFavorite
            ? t('explorer.removeFavorite', { name: host.name })
            : t('explorer.addFavorite', { name: host.name })
        }
        aria-pressed={host.isFavorite === true}
        className={cn(
          'shrink-0 rounded p-1 transition-opacity',
          host.isFavorite
            ? 'text-foreground'
            : 'text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        )}
        data-testid={`explorer-favorite-${host.id}`}
      >
        <Star
          className={cn('size-3.5', host.isFavorite && 'fill-current')}
          aria-hidden="true"
        />
      </button>

      <button
        type="button"
        onClick={() => onEdit(host)}
        aria-label={t('explorer.editHost', { name: host.name })}
        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        data-testid={`explorer-edit-${host.id}`}
      >
        <PencilGlyph />
      </button>
    </div>
  )
}

/** Kept local so the row does not pull the whole icon set into the panel chunk. */
function PencilGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}
