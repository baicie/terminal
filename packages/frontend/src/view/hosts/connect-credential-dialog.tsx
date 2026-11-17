/**
 * Ask for a credential at connect time, without storing it.
 *
 * The design rule: `Authenticate` is not `Save` (`05-ux2-credentials.md` §2). A host
 * with nothing stored must be connectable with a typed password, without creating a
 * vault first — and the value must not reach SQLite, the vault, `localStorage`, the
 * store or a tab.
 *
 * It never offers to save: a checkbox next to the password field reads as "this will
 * be saved" before the password has been proven to work, and saving after success is
 * a separate confirmation. It is also never shown for a host whose damaged reference
 * a typed password cannot repair.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuthType, Host } from '@/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { OneTimeSecret } from '@/features/terminal/services/one-time-credential'

interface ConnectCredentialDialogProps {
  /** Null closes the dialog. A host with no nameable secret opens it. */
  host: Host | null
  onOpenChange: (open: boolean) => void
  onConnect: (secret: OneTimeSecret) => void
}

/**
 * Which field to show for an auth type.
 *
 * `agent` never reaches this dialog — the caller checks first — and `cert` needs
 * the key material the certificate was issued for.
 */
function secretFieldFor(authType: AuthType): 'password' | 'key' | null {
  if (authType === 'password') return 'password'
  if (authType === 'key') return 'key'
  if (authType === 'cert') return 'key'
  return null
}

export function ConnectCredentialDialog({
  host,
  onOpenChange,
  onConnect,
}: ConnectCredentialDialogProps) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)

  const field = host ? secretFieldFor(host.authType) : null

  const reset = () => {
    setPassword('')
    setPrivateKey('')
    setPassphrase('')
    setError(null)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) reset()
    onOpenChange(open)
  }

  const submit = () => {
    if (field === 'password') {
      if (!password) {
        setError(t('hosts.connectCredential.passwordRequired'))
        return
      }
      onConnect({ password })
    } else if (field === 'key') {
      if (!privateKey.trim()) {
        setError(t('hosts.connectCredential.keyRequired'))
        return
      }
      onConnect({
        privateKey,
        ...(passphrase ? { passphrase } : {}),
      })
    }
    // The values stay in this component's state until it unmounts. Nothing is
    // persisted, and `reset()` runs on close so a second open starts empty.
    reset()
    onOpenChange(false)
  }

  if (!host) return null

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[440px] sm:w-full">
        <DialogHeader>
          <DialogTitle>{t('hosts.connectCredential.title')}</DialogTitle>
          <DialogDescription>
            {t('hosts.connectCredential.description', {
              name: host.name,
              user: host.username,
              hostname: host.hostname,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {field === 'password' && (
            <div className="space-y-1">
              <Label htmlFor="connect-credential-password">
                {t('hosts.connectCredential.passwordLabel')}
              </Label>
              <Input
                id="connect-credential-password"
                type="password"
                autoFocus
                autoComplete="off"
                value={password}
                onChange={event => {
                  setPassword(event.target.value)
                  setError(null)
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') submit()
                }}
              />
            </div>
          )}

          {field === 'key' && (
            <>
              <div className="space-y-1">
                <Label htmlFor="connect-credential-key">
                  {t('hosts.connectCredential.keyLabel')}
                </Label>
                <Textarea
                  id="connect-credential-key"
                  autoFocus
                  rows={6}
                  spellCheck={false}
                  className="font-mono text-xs"
                  value={privateKey}
                  onChange={event => {
                    setPrivateKey(event.target.value)
                    setError(null)
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="connect-credential-passphrase">
                  {t('hosts.connectCredential.passphraseLabel')}
                </Label>
                <Input
                  id="connect-credential-passphrase"
                  type="password"
                  autoComplete="off"
                  value={passphrase}
                  onChange={event => setPassphrase(event.target.value)}
                />
              </div>
            </>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            {t('hosts.connectCredential.notSaved')}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit}>{t('hosts.connectCredential.connect')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
