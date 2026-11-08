import type { KnownHostRecord } from '@/service/database'
import { Upload } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { ResponsiveConfirm } from '@/components/ui/responsive-dialog'
import { Textarea } from '@/components/ui/textarea'

interface KnownHostsDialogsProps {
  hosts: KnownHostRecord[]
  deleteDialogOpen: boolean
  setDeleteDialogOpen: (open: boolean) => void
  hostToDelete: KnownHostRecord | null
  setHostToDelete: (host: KnownHostRecord | null) => void
  clearAllDialogOpen: boolean
  setClearAllDialogOpen: (open: boolean) => void
  importDialogOpen: boolean
  setImportDialogOpen: (open: boolean) => void
  importContent: string
  setImportContent: (value: string) => void
  importError: string
  onDelete: () => void
  onClearAll: () => void
  onImport: () => void
}

export function KnownHostsDialogs({
  hosts,
  deleteDialogOpen,
  setDeleteDialogOpen,
  hostToDelete,
  setHostToDelete,
  clearAllDialogOpen,
  setClearAllDialogOpen,
  importDialogOpen,
  setImportDialogOpen,
  importContent,
  setImportContent,
  importError,
  onDelete,
  onClearAll,
  onImport,
}: KnownHostsDialogsProps) {
  const { t } = useTranslation()
  return (
    <>
      <ResponsiveConfirm
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('knownHosts.deleteTitle')}
        description={
          hostToDelete
            ? t('knownHosts.deleteConfirm', {
                hostname: hostToDelete.hostname,
              })
            : undefined
        }
        confirmText={t('common.delete')}
        destructive
        onConfirm={onDelete}
        onCancel={() => setHostToDelete(null)}
      />
      <ResponsiveConfirm
        open={clearAllDialogOpen}
        onOpenChange={setClearAllDialogOpen}
        title={t('knownHosts.clearAllTitle')}
        description={t('knownHosts.clearAllConfirm', {
          count: hosts.length,
        })}
        confirmText={t('knownHosts.clearAll')}
        destructive
        onConfirm={onClearAll}
        onCancel={() => setClearAllDialogOpen(false)}
      />
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('knownHosts.importTitle')}</DialogTitle>
            <DialogDescription>
              {t('knownHosts.importDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="known-hosts-content">
                {t('knownHosts.importContentLabel')}
              </Label>
              <Textarea
                id="known-hosts-content"
                className="h-48 font-mono text-xs"
                placeholder={t('knownHosts.importPlaceholder')}
                value={importContent}
                onChange={event => setImportContent(event.target.value)}
              />
            </div>
            {importError && (
              <p className="text-sm text-destructive">{importError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setImportDialogOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={onImport}>
              <Upload className="size-4 mr-1" data-icon="inline-start" />
              {t('knownHosts.import')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
