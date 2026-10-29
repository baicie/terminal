import { LoaderCircle, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { SshHostKeyProbeResult } from '@/features/terminal/services/ssh-host-key'
import type { SshHostKeyRole } from '@/features/terminal/hooks/use-ssh-host-key-gate'

interface SshHostKeyDialogProps {
  prompt: SshHostKeyProbeResult
  role?: SshHostKeyRole | null
  saving: boolean
  error: string | null
  onTrustOnce: () => void
  onTrustAndSave: () => void
  onCancel: () => void
}

export function SshHostKeyDialog({
  prompt,
  role,
  saving,
  error,
  onTrustOnce,
  onTrustAndSave,
  onCancel,
}: SshHostKeyDialogProps) {
  const { t } = useTranslation()
  const changed = prompt.status === 'changed'

  return (
    <AlertDialog open>
      <AlertDialogContent
        onEscapeKeyDown={event => {
          if (saving) event.preventDefault()
          else onCancel()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogMedia>
            {changed ? <ShieldAlert /> : <ShieldCheck />}
          </AlertDialogMedia>
          <AlertDialogTitle>
            {changed
              ? t('terminal.hostKeyChangedTitle')
              : t('terminal.hostKeyTrustTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {changed
              ? t('terminal.hostKeyChangedDescription')
              : t('terminal.hostKeyTrustDescription')}
            {role === 'jump'
              ? ` ${t('terminal.hostKeyJumpDescription')}`
              : role === 'target'
                ? ` ${t('terminal.hostKeyTargetDescription')}`
                : null}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <dl className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm">
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
            <dt className="text-muted-foreground">
              {t('terminal.hostKeyHost')}
            </dt>
            <dd className="break-all font-mono">
              {prompt.host}:{prompt.port}
            </dd>
          </div>
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
            <dt className="text-muted-foreground">
              {t('terminal.hostKeyAlgorithm')}
            </dt>
            <dd className="break-all font-mono">{prompt.algorithm}</dd>
          </div>
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
            <dt className="text-muted-foreground">
              {t('terminal.hostKeyFingerprint')}
            </dt>
            <dd className="break-all font-mono">{prompt.fingerprint}</dd>
          </div>
        </dl>

        {changed ? (
          <Alert variant="destructive">
            <ShieldAlert />
            <AlertDescription>
              {t('terminal.hostKeyChangedWarning')}
            </AlertDescription>
          </Alert>
        ) : error ? (
          <Alert variant="destructive">
            <ShieldAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving} onClick={onCancel}>
            {t(changed ? 'common.close' : 'common.cancel')}
          </AlertDialogCancel>
          {!changed ? (
            <>
              <Button variant="outline" disabled={saving} onClick={onTrustOnce}>
                {t('terminal.hostKeyTrustOnce')}
              </Button>
              <Button
                disabled={saving}
                aria-busy={saving}
                onClick={onTrustAndSave}
              >
                {saving ? (
                  <LoaderCircle
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                ) : null}
                {t('terminal.hostKeyTrustAndSave')}
              </Button>
            </>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

interface SshHostKeyGateOverlayProps {
  status: 'checking' | 'error'
  error: string | null
  onRetry: () => void
}

export function SshHostKeyGateOverlay({
  status,
  error,
  onRetry,
}: SshHostKeyGateOverlayProps) {
  const { t } = useTranslation()
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
          className="grid max-w-md justify-items-center gap-3 text-center"
        >
          <ShieldAlert className="text-destructive" />
          <div className="grid gap-1">
            <p className="font-medium">{t('terminal.hostKeyVerifyFailed')}</p>
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
