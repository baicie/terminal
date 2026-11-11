/**
 * The persistent failure surface for a terminal pane.
 *
 * Before this, a failed connection produced exactly one thing: a toast. Sonner
 * removes it after a few seconds, leaving an empty xterm with no explanation and
 * nothing to click. The vault action existed, but as a small link in the header —
 * easy to miss and impossible to find after the toast was gone.
 *
 * The error is the state of the pane, not a passing notification about it, so it
 * renders over the terminal and stays until the session recovers or the user
 * dismisses it. Deliberately no timer.
 */

import { AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import type { Host, Tab } from '@/types'
import { vaultActionFor } from './terminal-vault-action'

interface TerminalErrorOverlayProps {
  tab: Tab
  host?: Host
  status: string
  errorMessage: string
  /** Credential failure kind, when the failure came from the vault layer. */
  credentialKind?: string
  onRetry?: () => void
  onDismiss: () => void
}

/** Where the pane is pointed at, so the message says which host failed. */
function targetLabel(tab: Tab, host?: Host): string {
  if (tab.type === 'local') return 'local shell'
  if (host) return `${host.username}@${host.hostname}:${host.port}`
  return tab.label
}

export function TerminalErrorOverlay(props: TerminalErrorOverlayProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  // A healthy or still-connecting pane must never be covered. A stale error left
  // over from a previous attempt would hide the session the user is looking at.
  if (props.status !== 'error' && props.status !== 'disconnected') return null

  const action = vaultActionFor(props.credentialKind, props.status)

  return (
    <div
      data-testid="terminal-error-overlay"
      role="alert"
      className="absolute inset-0 z-20 flex items-center justify-center bg-background/95 p-4"
    >
      <div className="w-full max-w-md space-y-4 rounded-lg border border-destructive/40 bg-card p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-sm font-semibold">
              {t('terminal.errorOverlay.title')}
            </h2>
            <p className="text-xs text-muted-foreground">
              {targetLabel(props.tab, props.host)}
            </p>
            <p className="break-words text-sm">{props.errorMessage}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={props.onDismiss}>
            {t('terminal.errorOverlay.dismiss')}
          </Button>
          {props.onRetry !== undefined && action === null ? (
            <Button size="sm" onClick={props.onRetry}>
              {t('common.retry')}
            </Button>
          ) : null}
          {action !== null ? (
            <Button
              size="sm"
              data-testid="terminal-error-action"
              onClick={() => navigate(action.href)}
            >
              {t(action.label)}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
