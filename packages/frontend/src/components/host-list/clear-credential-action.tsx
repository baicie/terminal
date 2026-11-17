/**
 * The "forget the stored credential" control, in the host dialog's auth area.
 *
 * Written as its own component for the reason the rest of this dialog is split:
 * a destructive action with its own confirmation is a different concern from the
 * form fields around it, and `host-dialog.tsx` has a size limit.
 *
 * What it is not: a delete. Deleting removes the host, its groups, tags and
 * favourites and cannot be undone. This removes only the secret, keeps everything
 * else, and is reversible by saving a new credential. They sit in different places
 * and look different on purpose.
 */

import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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

interface ClearCredentialActionProps {
  /** Called once the user confirms. The caller owns the database write. */
  onClear: () => Promise<void> | void
  disabled?: boolean
  /**
   * The stored reference cannot be read by this build.
   *
   * Changes what the control says, not what it does. Clearing a readable
   * credential is housekeeping; clearing a damaged one is the only way back to a
   * working host, so the user needs to know why the button is there — otherwise
   * it reads as an unrelated destructive action next to an auth form.
   */
  damaged?: boolean
}

export function ClearCredentialAction({
  onClear,
  disabled = false,
  damaged = false,
}: ClearCredentialActionProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      await onClear()
      setOpen(false)
    } catch {
      // The caller reports the failure and keeps its own state; swallowing it
      // here is what stops `void confirm()` from becoming an unhandled
      // rejection. The dialog stays open on purpose: a failure that closes the
      // confirmation looks exactly like a success, and leaves the user with no
      // way to retry.
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex flex-col items-start gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="host-clear-credential"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <KeyRound className="size-4" data-icon="inline-start" />
          {t('hosts.clearCredential.action')}
        </Button>
        {damaged && (
          <p className="text-xs text-muted-foreground" data-testid="host-clear-credential-damaged">
            {t('hosts.clearCredential.damaged')}
          </p>
        )}
      </div>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('hosts.clearCredential.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('hosts.clearCredential.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={event => {
                // Keep the dialog open while the write is in flight: closing on
                // click would hide a failure behind a success-looking exit.
                event.preventDefault()
                void confirm()
              }}
            >
              {t('hosts.clearCredential.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
