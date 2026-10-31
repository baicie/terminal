import type { Tab } from '@/types'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

/**
 * Session states the tab strip renders. Wider than the persisted tab metadata
 * on purpose: the session manager already separates a first connect from a
 * reconnect and a failure from a plain disconnect, and the strip stays
 * distinguishable as soon as the projection carries those values.
 */
export type TabConnectionState =
  | NonNullable<Tab['connectionStatus']>
  | 'idle'
  | 'reconnecting'
  | 'error'

interface ConnectionPresentation {
  labelKey: string
  dotClassName: string
  /** Attention states keep a localized label next to the dot. */
  needsLabel: boolean
  labelClassName: string
}

export const CONNECTION_PRESENTATION: Record<
  TabConnectionState,
  ConnectionPresentation
> = {
  idle: {
    labelKey: 'terminal.status.idle',
    dotClassName: 'bg-muted-foreground/40',
    needsLabel: false,
    labelClassName: 'text-muted-foreground',
  },
  connecting: {
    labelKey: 'terminal.status.connecting',
    dotClassName: 'bg-warning motion-safe:animate-pulse',
    needsLabel: true,
    labelClassName: 'text-muted-foreground',
  },
  reconnecting: {
    labelKey: 'terminal.status.reconnecting',
    dotClassName: 'bg-warning ring-1 ring-warning/60 motion-safe:animate-pulse',
    needsLabel: true,
    labelClassName: 'text-muted-foreground',
  },
  connected: {
    labelKey: 'terminal.status.connected',
    dotClassName: 'bg-success',
    needsLabel: false,
    labelClassName: 'text-muted-foreground',
  },
  disconnected: {
    labelKey: 'terminal.status.disconnected',
    dotClassName: 'bg-muted-foreground/60',
    needsLabel: true,
    labelClassName: 'text-muted-foreground',
  },
  error: {
    labelKey: 'terminal.status.error',
    dotClassName: 'bg-destructive',
    needsLabel: true,
    labelClassName: 'text-destructive',
  },
}

/**
 * One status indicator for the tab strip: a coloured dot for every state plus
 * the localized status word for the states a user has to act on. The word is
 * hidden below `sm` so a 44px touch tab keeps its session name.
 */
export function TabConnectionStatus({ status }: { status?: TabConnectionState }) {
  const { t } = useTranslation()
  if (!status) return null
  const presentation = CONNECTION_PRESENTATION[status]
  const label = t(presentation.labelKey)

  return (
    <span
      className="flex min-w-0 shrink-0 items-center gap-1"
      title={label}
      data-testid={`tab-connection-${status}`}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 shrink-0 rounded-full transition-colors',
          presentation.dotClassName,
        )}
        data-status={status}
        data-testid={`tab-status-${status}`}
      />
      {presentation.needsLabel ? (
        <span
          className={cn(
            'hidden shrink-0 text-[10px] leading-none sm:inline',
            presentation.labelClassName,
          )}
          data-testid={`tab-status-label-${status}`}
        >
          {label}
        </span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </span>
  )
}
