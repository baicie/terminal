import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

/**
 * The 24px status bar.
 *
 * The rule this component follows: **only show what something actually measured.**
 * A status bar that prints "Connected" because a tab exists is worse than an empty
 * one — it teaches the user to ignore the one indicator that would have warned
 * them.
 *
 * So every field is optional and renders only when its source has a value:
 *
 * - connection state comes from the session record's `status`, not from "a tab is
 *   open"
 * - columns/rows come from xterm's own resize, which is the size the PTY was told
 * - the transfer count comes from the transfer queue's running+queued length
 *
 * There is deliberately no encoding field and no shell name: nothing in the app
 * reports either as a verified fact today, and inventing them would be the exact
 * failure mode this project keeps hitting.
 */
export interface StatusBarProps {
  /** Session status of the active pane, when there is one. */
  status?: 'idle' | 'connecting' | 'reconnecting' | 'connected' | 'disconnected' | 'error'
  /** Terminal size as xterm reported it after the last fit. */
  cols?: number
  rows?: number
  /** Running plus queued transfers. Hidden at zero. */
  transfers?: number
  /** Protocol label for the active tab: Local / SSH / Serial. */
  sessionLabel?: string
  className?: string
}

const STATUS_TONE: Record<string, string> = {
  connected: 'bg-success',
  connecting: 'bg-warning',
  reconnecting: 'bg-warning',
  error: 'bg-destructive',
  disconnected: 'bg-muted-foreground/50',
  idle: 'bg-muted-foreground/40',
}

export function StatusBar({
  status,
  cols,
  rows,
  transfers,
  sessionLabel,
  className,
}: StatusBarProps) {
  const { t } = useTranslation()
  const hasSize =
    Number.isSafeInteger(cols) && Number.isSafeInteger(rows) && cols! > 0 && rows! > 0

  return (
    <footer
      data-testid="status-bar"
      className={cn(
        'flex h-6 shrink-0 items-center gap-3 border-t border-border/60 bg-background px-3 text-[11px] text-muted-foreground',
        className,
      )}
    >
      {status !== undefined ? (
        <span className="flex items-center gap-1.5" data-testid="status-connection">
          <span
            aria-hidden="true"
            className={cn('size-1.5 rounded-full', STATUS_TONE[status])}
          />
          {t(`terminal.status.${status}`)}
        </span>
      ) : null}

      {sessionLabel !== undefined ? (
        <span data-testid="status-session">{sessionLabel}</span>
      ) : null}

      <span className="flex-1" />

      {transfers !== undefined && transfers > 0 ? (
        <span data-testid="status-transfers">
          {t('statusBar.transfers', { count: transfers })}
        </span>
      ) : null}

      {hasSize ? (
        <span data-testid="status-size" className="tabular-nums">
          {cols}×{rows}
        </span>
      ) : null}
    </footer>
  )
}
