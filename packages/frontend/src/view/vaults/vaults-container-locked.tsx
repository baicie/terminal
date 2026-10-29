import { Key, Lock, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ViewContainer,
  ViewContent,
  ViewHeader,
  ViewToolbar,
} from '@/components/view-container'
import type { VaultsContainerController } from './use-vaults-container'
import {
  ChangeVaultPasswordDialog,
  UnlockVaultDialog,
} from './vault-password-dialogs'

export function VaultsContainerLocked({
  vault,
}: {
  vault: VaultsContainerController
}) {
  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          onClick={() => vault.setChangePasswordDialogOpen(true)}
        >
          <Key className="size-4 mr-1" data-icon="inline-start" />
          Change Password
        </Button>
      </ViewToolbar>
      <ViewContent className="p-6">
        <ViewHeader
          title="Vault Locked"
          description="Enter your master password to unlock"
        />
        <div className="flex flex-col items-center justify-center gap-6 py-12">
          <div className="p-6 rounded-full bg-primary/10">
            <Lock className="size-16 text-primary" />
          </div>
          <div className="text-center space-y-2">
            <p className="text-lg font-medium">Your vault is locked</p>
            <p className="text-sm text-muted-foreground">
              Enter your master password to access your credentials
            </p>
          </div>
          <Button size="lg" onClick={() => vault.setUnlockDialogOpen(true)}>
            <Unlock className="size-4 mr-2" />
            Unlock Vault
          </Button>
        </div>
      </ViewContent>
      <UnlockVaultDialog vault={vault} />
      <ChangeVaultPasswordDialog vault={vault} />
    </ViewContainer>
  )
}
