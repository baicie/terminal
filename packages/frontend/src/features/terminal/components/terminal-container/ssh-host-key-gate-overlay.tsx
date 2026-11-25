import { LoaderCircle, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { SshHostKeyGateFailure } from '@/features/terminal/hooks/ssh-host-key-gate-failure'
import { SSH_HOST_KEY_FAILURE_KEYS } from './ssh-host-key-failure-keys'

/**
 * The preflight's own failure surface.
 *
 * Split out of `ssh-host-key-dialog.tsx` both to keep that file inside its size limit
 * and because the two surfaces answer different questions: the dialog asks the user to
 * decide about a key it has already read, while this one reports that the preflight
 * could not get that far.
 *
 * ## Why the title is chosen from `failure` and not from the message
 *
 * A closed port reaches this overlay too — the preflight runs before the session does.
 * The old title said "Could not verify the SSH host key" for all of it, which points the
 * user at known_hosts for a machine that never answered TCP. The classification is made
 * where the rejection is still structured; see `ssh-host-key-gate-failure.ts`.
 */
interface SshHostKeyGateOverlayProps {
  status: 'checking' | 'error'
  error: string | null
  /**
   * Which step failed. Absent means "we never reached a probe stage", and the
   * overlay then falls back to the generic host-key sentence.
   */
  failure?: SshHostKeyGateFailure
  onRetry: () => void
}

export function SshHostKeyGateOverlay({
  status,
  error,
  failure,
  onRetry,
}: SshHostKeyGateOverlayProps) {
  const { t } = useTranslation()
  /*
   * ## Why the title is chosen from `failure` and not from the message
   *
   * A closed port reaches this overlay too — the preflight runs before the session
   * does. The old title said "Could not verify the SSH host key" for all of it, which
   * points the user at known_hosts for a machine that never answered TCP. The
   * classification is made where the rejection is still structured; see
   * `ssh-host-key-gate-failure.ts` for what each value means and why.
   */
  const titleKey =
    failure === undefined
      ? 'terminal.hostKeyVerifyFailed'
      : SSH_HOST_KEY_FAILURE_KEYS[failure]
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-background/95 p-4">
      {status === 'checking' ? (
        <div
          role="status"
          aria-label={t('terminal.hostKeyCheckingAria')}
          className="flex items-center gap-3 text-sm text-muted-foreground"
        >
          <LoaderCircle className="animate-spin" />
          {t('terminal.hostKeyChecking')}
        </div>
      ) : (
        <div
          role="alert"
          data-testid="ssh-host-key-gate-error"
          data-failure={failure ?? 'unspecified'}
          className="grid max-w-md justify-items-center gap-3 text-center"
        >
          <ShieldAlert className="text-destructive" />
          <div className="grid gap-1">
            <p className="font-medium" data-testid="ssh-host-key-gate-title">
              {t(titleKey)}
            </p>
            <p className="break-words text-sm text-muted-foreground">{error}</p>
          </div>
          <Button variant="outline" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        </div>
      )}
    </div>
  )
}
