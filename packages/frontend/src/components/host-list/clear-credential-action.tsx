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
}

export function ClearCredentialAction({
  onClear,
  disabled = false,
}: ClearCredentialActionProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      await onClear()
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
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
