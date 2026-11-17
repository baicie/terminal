/**
 * The save prompt, shown only after a credential has authenticated.
 *
 * Three answers, all explicit: save, keep the connection without saving, or (on a
 * failed save) retry later from Settings. The prompt never closes itself on success —
 * `save` reports the outcome and this component stays open on failure so the reason is
 * visible where the question was asked.
 *
 * What it deliberately does not do: it does not appear before a connection succeeded.
 * The moment is decided by `useSaveAfterAuth`, and this component only renders what that
 * hook says is pending.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Host } from '@/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { SaveResult } from './save-after-auth'

interface SaveCredentialDialogProps {
  /** The host whose credential just worked. Null closes the dialog. */
  host: Host | null
  onSave: () => Promise<SaveResult>
  onDismiss: () => void
}

export function SaveCredentialDialog({ host, onSave, onDismiss }: SaveCredentialDialogProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  if (!host) return null

  const save = async () => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    try {
      const result = await onSave()
      if (!result.ok) {
        // Stay open: the user asked to save, it did not happen, and the reason belongs
        // where the question was. Closing here is the defect this guards against.
        setFailure(result.message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onDismiss() }}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[440px] sm:w-full">
        <DialogHeader>
          <DialogTitle>{t('hosts.saveCredential.title')}</DialogTitle>
          <DialogDescription>
            {t('hosts.saveCredential.description', {
              name: host.name,
              user: host.username,
              hostname: host.hostname,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{t('hosts.saveCredential.whyNow')}</p>
          {failure && (
            <p className="text-sm text-destructive" role="alert">
              {failure}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onDismiss} disabled={busy}>
            {t('hosts.saveCredential.notNow')}
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {t('hosts.saveCredential.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
