import { AlertTriangle, Shield, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useVaultsView } from './use-vaults-view'
import { CreateVaultState, LockedVaultState } from './vaults-view-auth-states'
import { VaultsViewEntries } from './vaults-view-entries'

/**
 * The corrupt state renders no action at all. The file holds bytes the format
 * cannot parse and the backend keeps them untouched, so this screen must not
 * offer delete, overwrite or create: recovery is manual, by design.
 */
function CorruptVaultNotice() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-md space-y-4 text-center">
        <ShieldAlert className="mx-auto size-12 text-destructive sm:size-16" />
        <h2 className="text-xl font-semibold sm:text-2xl">{t('vaults.vault')}</h2>
        <p className="text-sm text-destructive" role="alert">
          {t('vaults.corrupt')}
        </p>
        <p className="text-xs text-muted-foreground sm:text-sm">
          {t('vaults.corruptHint')}
        </p>
      </div>
    </div>
  )
}

function LoadingVaultState() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <Shield className="mx-auto size-12 animate-pulse text-muted-foreground" />
        <p className="mt-2 text-muted-foreground">{t('vaults.loading')}</p>
      </div>
    </div>
  )
}

const VaultsView: React.FC = () => {
  const { t } = useTranslation()
  const vault = useVaultsView()
  const error = vault.errorKey ? t(vault.errorKey) : null
  const notice = vault.noticeKey ? t(vault.noticeKey) : null

  const renderState = () => {
    switch (vault.vaultState) {
      case 'loading':
        return <LoadingVaultState />
      case 'corrupt':
        return <CorruptVaultNotice />
      case 'not_created':
      case 'uninitialized':
        return (
          <CreateVaultState
            password={vault.password}
            confirmPassword={vault.confirmPassword}
            showPassword={vault.showPassword}
            error={error}
            notice={notice}
            creating={vault.creating}
            onPasswordChange={vault.setPassword}
            onConfirmPasswordChange={vault.setConfirmPassword}
            onShowPasswordChange={vault.setShowPassword}
            onCreate={() => void vault.handleCreate()}
          />
        )
      case 'locked':
        return (
          <LockedVaultState
            password={vault.password}
            showPassword={vault.showPassword}
            error={error}
            onPasswordChange={vault.setPassword}
            onShowPasswordChange={vault.setShowPassword}
            onUnlock={() => void vault.handleUnlock()}
          />
        )
      default:
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
  }

  return (
    <div className="flex h-full flex-col">
      {vault.bannerKey && (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p className="flex-1 text-sm">{t(vault.bannerKey)}</p>
          <Button variant="ghost" size="sm" onClick={vault.dismissBanner}>
            {t('vaults.dismiss')}
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1">{renderState()}</div>
    </div>
  )
}

export default VaultsView
