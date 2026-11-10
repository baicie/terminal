/**
 * The in-place next step when a save is refused because the vault cannot take
 * the secret.
 *
 * `vaultUnavailableMessage` already tells the user *what* to do, but it arrives
 * as a toast and names another page. On a fresh install that means: fill in the
 * host, get refused, navigate to Vaults, create a vault, come back — and find an
 * empty form. The password is gone.
 *
 * So the recovery lives in the dialog. It offers only the action that actually
 * applies to the current state:
 *
 * - `uninitialized` → create a vault (with a master password typed here)
 * - `locked`        → unlock it
 * - `unusable`      → nothing to offer; say so instead of guessing a fix
 *
 * Never writes a secret anywhere, and never falls back to storing it in SQLite.
 */

import { Loader2, LockKeyhole, ShieldAlert, ShieldPlus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type VaultRecoveryState = 'uninitialized' | 'locked' | 'unusable'

interface VaultRecoveryProps {
  state: VaultRecoveryState
  /** Create or unlock; the caller retries the saved payload on success. */
  onCreate: (masterPassword: string) => Promise<void>
  onUnlock: (masterPassword: string) => Promise<void>
}

export function VaultRecovery({
  state,
  onCreate,
  onUnlock,
}: VaultRecoveryProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [masterPassword, setMasterPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (state === 'unusable') {
    // There is no in-place fix for "the vault file cannot be read". Offering a
    // button here would send the user to do something that cannot work.
    return (
      <div
        data-testid="vault-recovery"
        className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3"
      >
        <ShieldAlert className="size-5 shrink-0 text-destructive" />
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('hosts.vault.unusableTitle')}</p>
          <p className="text-xs text-muted-foreground">
            {t('hosts.vault.unusableBody')}
          </p>
        </div>
      </div>
    )
  }

  const creating = state === 'uninitialized'
  const action = creating ? onCreate : onUnlock

  const submit = async () => {
    if (!masterPassword || busy) return
    setBusy(true)
    setError(null)
    try {
      await action(masterPassword)
      setMasterPassword('')
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-testid="vault-recovery"
      className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3"
    >
      <div className="flex items-start gap-3">
        {creating ? (
          <ShieldPlus className="size-5 shrink-0 text-warning" />
        ) : (
          <LockKeyhole className="size-5 shrink-0 text-warning" />
        )}
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {creating
              ? t('hosts.vault.createTitle')
              : t('hosts.vault.unlockTitle')}
          </p>
          <p className="text-xs text-muted-foreground">
            {creating
              ? t('hosts.vault.createBody')
              : t('hosts.vault.unlockBody')}
          </p>
        </div>
      </div>

      {!open ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
        >
          {creating
            ? t('hosts.vault.createAction')
            : t('hosts.vault.unlockAction')}
        </Button>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="vault-recovery-password" className="text-xs">
            {t('hosts.vault.masterPassword')}
          </Label>
          <Input
            id="vault-recovery-password"
            data-testid="vault-recovery-password"
            type="password"
            autoComplete="new-password"
            value={masterPassword}
            onChange={event => setMasterPassword(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void submit()
            }}
          />
          {error && (
            <p className="text-xs text-destructive break-all">{error}</p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!masterPassword || busy}
              onClick={() => void submit()}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t('common.confirm')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(false)
                setMasterPassword('')
                setError(null)
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
