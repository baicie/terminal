/**
 * Forget a key's stored private half, keeping the key entry.
 *
 * Distinct from delete in the same way the host dialog's clear is: this removes a
 * secret and is reversible by pasting a new one, while delete removes the entry,
 * its name and its public half. They look and read differently on purpose.
 *
 * `damaged` changes what the control says, not what it does. A reference this build
 * cannot follow leaves the key unusable, and clearing the pointer is the only way
 * back to a working entry — so the user has to be told that, otherwise the button
 * reads as an unrelated destructive action sitting next to a reveal button.
 */

import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { clearSSHKeyCredential } from '@/service/database'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from '@/components/ui/sonner'

interface ClearKeyCredentialActionProps {
  keyId: string
  damaged?: boolean
  disabled?: boolean
  /** Called after the write succeeds, so the parent can re-read and drop state. */
  onCleared?: () => Promise<void> | void
}

export function ClearKeyCredentialAction({
  keyId,
  damaged = false,
  disabled = false,
  onCleared,
}: ClearKeyCredentialActionProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      await clearSSHKeyCredential(keyId)
      setOpen(false)
      toast.success(t('keychain.clearCredential.done'))
      await onCleared?.()
    } catch (error) {
      // Reported, not swallowed: the dialog stays open so the user can retry, and
      // a failure never looks like the success that closes it.
      toast.error(t('keychain.clearCredential.failed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        data-testid="key-clear-credential"
      >
        <KeyRound className="size-4" data-icon="inline-start" />
        {t('keychain.clearCredential.action')}
      </Button>
      {damaged && (
        <p className="text-xs text-muted-foreground" data-testid="key-credential-damaged">
          {t('keychain.clearCredential.damaged')}
        </p>
      )}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('keychain.clearCredential.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('keychain.clearCredential.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={event => {
                // Stay open while the write is in flight: closing on click is what
                // makes a failure look like a success.
                event.preventDefault()
                void confirm()
              }}
            >
              {t('keychain.clearCredential.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
