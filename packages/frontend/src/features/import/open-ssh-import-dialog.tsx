/**
 * The OpenSSH import wizard.
 *
 * Flow: pick a file (or paste one) → read → parse → preview → choose → import →
 * report per-entry outcomes. Nothing is written until the user confirms, and the
 * preview lists duplicates and invalid entries rather than hiding them.
 *
 * The import itself goes through the same `addHost` path as a manual save, so an
 * imported secret lands in the vault under the same rules — this wizard does not
 * have a second write path. All state lives in `useOpenSshImport`.
 */

import { FileUp, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  ImportCandidateList,
  ImportWarningList,
} from '@/features/import/import-candidate-list'
import { useOpenSshImport } from '@/features/import/use-open-ssh-import'

interface OpenSshImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function OpenSshImportDialog({
  open,
  onOpenChange,
}: OpenSshImportDialogProps) {
  const { t } = useTranslation()
  const wizard = useOpenSshImport()
  const {
    busy,
    error,
    outcome,
    pasteOpen,
    pasted,
    pickFile,
    plan,
    reset,
    runImport,
    selected,
    setPasteOpen,
    setPasted,
    source,
    toggle,
    toggleAll,
  } = wizard

  const close = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-1rem)] max-w-[560px] flex-col overflow-hidden p-0 sm:w-full">
        <DialogHeader className="border-b p-4 text-left">
          <DialogTitle>{t('hosts.import.title')}</DialogTitle>
          <DialogDescription>
            {t('hosts.import.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {error !== null && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-sm text-destructive break-all">{error}</p>
            </div>
          )}

          {source === null && error === null && (
            <div className="space-y-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => void pickFile()}
              >
                {busy ? (
                  <Loader2
                    className="size-4 animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <FileUp className="size-4" data-icon="inline-start" />
                )}
                {t('hosts.import.chooseFile')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPasteOpen(true)}
              >
                {t('hosts.import.pasteInstead')}
              </Button>
            </div>
          )}

          {pasteOpen && source === null && (
            <div className="space-y-2">
              <Textarea
                aria-label={t('hosts.import.pasteLabel')}
                placeholder={t('hosts.import.pastePlaceholder')}
                value={pasted}
                onChange={event => setPasted(event.target.value)}
                className="min-h-40 font-mono text-xs"
              />
              <Button
                type="button"
                size="sm"
                disabled={pasted.trim() === ''}
                onClick={() => plan(pasted, t('hosts.import.pastedPath'))}
              >
                {t('hosts.import.parsePasted')}
              </Button>
            </div>
          )}

          {source !== null && (
            <>
              <p className="text-xs text-muted-foreground break-all">
                {t('hosts.import.sourcePath', { path: source.path })}
              </p>
              <ImportWarningList warnings={source.plan.warnings} />
              <ImportCandidateList
                candidates={source.plan.candidates}
                selected={selected}
                onToggle={toggle}
                onToggleAll={toggleAll}
              />
            </>
          )}

          {outcome !== null && (
            <div className="space-y-1 rounded-lg border border-border/60 p-3">
              <p className="text-sm font-medium">
                {t('hosts.import.resultTitle', {
                  count: outcome.created.length,
                })}
              </p>
              {outcome.failed.length > 0 && (
                <ul className="space-y-0.5 text-xs text-destructive">
                  {outcome.failed.map(entry => (
                    <li key={entry.name}>
                      {entry.name}: {entry.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-t p-4">
          <Button type="button" variant="ghost" onClick={() => close(false)}>
            {t('common.cancel')}
          </Button>
          {source !== null && outcome === null && (
            <Button
              type="button"
              disabled={busy || selected.size === 0}
              onClick={() => void runImport()}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t('hosts.import.confirm', { count: selected.size })}
            </Button>
          )}
          {outcome !== null && (
            <Button type="button" onClick={() => close(false)}>
              {t('common.done')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default OpenSshImportDialog
