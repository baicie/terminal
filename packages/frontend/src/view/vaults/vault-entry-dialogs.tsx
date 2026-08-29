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
import type { VaultsContainerController } from './use-vaults-container'

export function VaultEntryDialogs({
  vault,
}: {
  vault: VaultsContainerController
}) {
  return (
    <>
      <Dialog
        open={vault.addEntryDialogOpen}
        onOpenChange={vault.setAddEntryDialogOpen}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Vault Entry</DialogTitle>
            <DialogDescription>
              Store a sensitive value securely
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="entry-key">Key</Label>
              <Input
                id="entry-key"
                value={vault.entryKey}
                onChange={event => vault.setEntryKey(event.target.value)}
                placeholder="e.g., host:123:password or api-key"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entry-value">Value</Label>
              <Textarea
                id="entry-value"
                value={vault.entryValue}
                onChange={event => vault.setEntryValue(event.target.value)}
                placeholder="Sensitive value..."
                className="font-mono text-sm min-h-[120px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entry-desc">Description (optional)</Label>
              <Input
                id="entry-desc"
                value={vault.entryDescription}
                onChange={event =>
                  vault.setEntryDescription(event.target.value)
                }
                placeholder="Description..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => vault.setAddEntryDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void vault.handleAddEntry()}
              disabled={!vault.entryKey.trim() || !vault.entryValue.trim()}
            >
              Add Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={vault.deleteDialogOpen}
        onOpenChange={vault.setDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Entry</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{vault.entryToDelete?.key}"? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => vault.setEntryToDelete(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void vault.handleDeleteEntry()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
