/**
 * Confirmation for a risky paste.
 *
 * Shown when the pasted text contains something that would not just be typed but
 * *acted on*: extra lines (the last one runs), control characters (ESC turns text
 * into key sequences, Ctrl-C/Ctrl-D change the session), or a very large block.
 *
 * The tail is always rendered. Whatever the shell would execute first is the last
 * line of the paste, so hiding it behind "…more" would defeat the dialog.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'

export interface PasteConfirmRequest {
  head: string[]
  tail: string[]
  omitted: number
  lineCount: number
  risks: string[]
}

interface Props {
  request: PasteConfirmRequest | null
  onResolve: (accepted: boolean) => void
}

export function PasteConfirmDialog({ request, onResolve }: Props) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={request !== null}
      onOpenChange={open => {
        if (!open) onResolve(false)
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('terminal.pasteConfirmTitle')}</DialogTitle>
          <DialogDescription>
            {t('terminal.pasteConfirmDescription', {
              count: request?.lineCount ?? 0,
            })}
          </DialogDescription>
        </DialogHeader>

        {request?.risks.includes('control') && (
          <p className="text-sm text-destructive">
            {t('terminal.pasteConfirmControl')}
          </p>
        )}

        <div className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-words">
          {request?.head.map((line, index) => (
            <div key={`head-${index}`}>{line === '' ? ' ' : line}</div>
          ))}
          {request !== null && request.omitted > 0 && (
            <div className="my-1 text-muted-foreground">
              {t('terminal.pasteConfirmOmitted', { count: request.omitted })}
            </div>
          )}
          {request?.tail.map((line, index) => (
            <div key={`tail-${index}`}>{line === '' ? ' ' : line}</div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onResolve(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onResolve(true)}>
            {t('terminal.pasteConfirmAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
