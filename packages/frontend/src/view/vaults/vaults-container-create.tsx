import { Plus, Shield } from 'lucide-react'
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
import {
  EmptyState,
  ViewContainer,
  ViewContent,
  ViewHeader,
  ViewToolbar,
} from '@/components/view-container'
import type { VaultsContainerController } from './use-vaults-container'

export function VaultsContainerCreate({
  vault,
}: {
  vault: VaultsContainerController
}) {
  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <div className="flex-1" />
        <Button size="sm" onClick={() => vault.setCreateDialogOpen(true)}>
          <Plus className="size-4 mr-1" data-icon="inline-start" />
          Create Vault
        </Button>
      </ViewToolbar>
      <ViewContent className="p-6">
        <ViewHeader
          title="Vaults"
          description="Encrypted storage for sensitive connection data"
        />
        <EmptyState
          icon={<Shield className="size-12" />}
          title="No vault exists"
          description="Create a vault to securely store sensitive connection credentials"
          action={
            <Button onClick={() => vault.setCreateDialogOpen(true)}>
              <Plus className="size-4 mr-1" data-icon="inline-start" />
              Create Vault
            </Button>
          }
        />
      </ViewContent>
      <Dialog
        open={vault.createDialogOpen}
        onOpenChange={vault.setCreateDialogOpen}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Vault</DialogTitle>
            <DialogDescription>
              Set a master password to encrypt your sensitive data. This
              password cannot be recovered.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">Master Password</Label>
              <Input
                id="new-password"
                type="password"
                value={vault.masterPassword}
                onChange={event => vault.setMasterPassword(event.target.value)}
                placeholder="Enter master password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={vault.confirmPassword}
                onChange={event => vault.setConfirmPassword(event.target.value)}
                placeholder="Confirm master password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => vault.setCreateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={() => void vault.handleCreateVault()}>
              Create Vault
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ViewContainer>
  )
}
