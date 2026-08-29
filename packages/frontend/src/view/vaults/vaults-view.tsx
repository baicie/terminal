import { Shield } from 'lucide-react'
import { useVaultsView } from './use-vaults-view'
import { CreateVaultState, LockedVaultState } from './vaults-view-auth-states'
import { VaultsViewEntries } from './vaults-view-entries'

const VaultsView: React.FC = () => {
  const vault = useVaultsView()

  if (vault.vaultState === 'loading') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Shield className="h-12 w-12 mx-auto text-muted-foreground animate-pulse" />
          <p className="mt-2 text-muted-foreground">Loading vault...</p>
        </div>
      </div>
    )
  }

  if (vault.vaultState === 'not_created') {
    return (
      <CreateVaultState
        password={vault.password}
        confirmPassword={vault.confirmPassword}
        showPassword={vault.showPassword}
        error={vault.error}
        creating={vault.creating}
        onPasswordChange={vault.setPassword}
        onConfirmPasswordChange={vault.setConfirmPassword}
        onShowPasswordChange={vault.setShowPassword}
        onCreate={() => void vault.handleCreate()}
      />
    )
  }

  if (vault.vaultState === 'locked') {
    return (
      <LockedVaultState
        password={vault.password}
        showPassword={vault.showPassword}
        error={vault.error}
        onPasswordChange={vault.setPassword}
        onShowPasswordChange={vault.setShowPassword}
        onUnlock={() => void vault.handleUnlock()}
      />
    )
  }

  return (
    <VaultsViewEntries
      entries={vault.entries}
      selectedEntry={vault.selectedEntry}
      newEntryKey={vault.newEntryKey}
      newEntryValue={vault.newEntryValue}
      showEntryValue={vault.showEntryValue}
      onLock={() => void vault.handleLock()}
      onNewEntryKeyChange={vault.setNewEntryKey}
      onNewEntryValueChange={vault.setNewEntryValue}
      onAddEntry={() => void vault.handleAddEntry()}
      onSelectEntry={vault.setSelectedEntry}
      onDeleteEntry={key => void vault.handleDeleteEntry(key)}
      onShowEntryValueChange={vault.setShowEntryValue}
      onCopyValue={value => void vault.handleCopyValue(value)}
    />
  )
}

export default VaultsView
