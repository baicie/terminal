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
import type { VaultsContainerController } from './use-vaults-container'

export function UnlockVaultDialog({
  vault,
}: {
  vault: VaultsContainerController
}) {
  return (
    <Dialog
      open={vault.unlockDialogOpen}
      onOpenChange={vault.setUnlockDialogOpen}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Unlock Vault</DialogTitle>
          <DialogDescription>Enter your master password</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="unlock-password">Master Password</Label>
            <Input
              id="unlock-password"
              type="password"
              value={vault.masterPassword}
              onChange={event => vault.setMasterPassword(event.target.value)}
              placeholder="Enter master password"
              onKeyDown={event => {
                if (event.key === 'Enter') void vault.handleUnlock()
              }}
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => vault.setUnlockDialogOpen(false)}
          >
            Cancel
          </Button>
          <Button onClick={() => void vault.handleUnlock()}>Unlock</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ChangeVaultPasswordDialog({
  vault,
}: {
  vault: VaultsContainerController
}) {
  return (
    <Dialog
      open={vault.changePasswordDialogOpen}
      onOpenChange={vault.setChangePasswordDialogOpen}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change Master Password</DialogTitle>
          <DialogDescription>
            Enter your current and new password
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current Password</Label>
            <Input
              id="current-password"
              type="password"
              value={vault.masterPassword}
              onChange={event => vault.setMasterPassword(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-pw">New Password</Label>
            <Input
              id="new-pw"
              type="password"
              value={vault.newPassword}
              onChange={event => vault.setNewPassword(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-new-pw">Confirm New Password</Label>
            <Input
              id="confirm-new-pw"
              type="password"
              value={vault.confirmNewPassword}
              onChange={event =>
                vault.setConfirmNewPassword(event.target.value)
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => vault.setChangePasswordDialogOpen(false)}
          >
            Cancel
          </Button>
          <Button onClick={() => void vault.handleChangePassword()}>
            Change Password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
