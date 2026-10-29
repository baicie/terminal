import type { KnownHostRecord } from '@/service/database'
import { Upload } from 'lucide-react'
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
  return (
    <>
      <ResponsiveConfirm
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Known Host"
        description={
          hostToDelete
            ? `Delete the app backup for "${hostToDelete.hostname}"? This does not remove trust from your OpenSSH .ssh/known_hosts file.`
            : undefined
        }
        confirmText="Delete"
        destructive
        onConfirm={onDelete}
        onCancel={() => setHostToDelete(null)}
      />
      <ResponsiveConfirm
        open={clearAllDialogOpen}
        onOpenChange={setClearAllDialogOpen}
        title="Clear All Known Hosts"
        description={`Delete all ${hosts.length} app backup records? This does not change your OpenSSH .ssh/known_hosts file.`}
        confirmText="Clear All"
        destructive
        onConfirm={onClearAll}
        onCancel={() => setClearAllDialogOpen(false)}
      />
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Known Hosts</DialogTitle>
            <DialogDescription>
              This imports a backup copy into the app only. It does not update
              your OpenSSH .ssh/known_hosts file or change SSH trust. Supported
              format: OpenSSH known_hosts.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="known-hosts-content">Known Hosts Content</Label>
              <Textarea
                id="known-hosts-content"
                className="h-48 font-mono text-xs"
                placeholder="Paste known_hosts content here..."
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
              Cancel
            </Button>
            <Button onClick={onImport}>
              <Upload className="size-4 mr-1" data-icon="inline-start" />
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
