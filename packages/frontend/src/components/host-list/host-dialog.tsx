import type { Host } from '@/types'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import PortForwardDialog from '@/components/port-forward'
import { EnvironmentVariablesDialog } from './environment-dialog'
import { HostFormBasic } from './host-form-basic'
import { HostFormActions } from './host-form-actions'
import { HostDialogAdvancedFields } from './host-dialog-advanced-fields'
import { ClearCredentialAction } from './clear-credential-action'
import { IdentityFileNotice } from './identity-file-notice'
import { VaultRecovery } from './vault-recovery'
import { useHostStore } from '@/store/host'
import { useHostDialogForm } from './use-host-dialog-form'

interface HostDialogProps {
  open: boolean
  host?: Host | null
  onClose: () => void
}

export const HostDialog: React.FC<HostDialogProps> = ({
  open,
  host,
  onClose,
}) => {
  const { t } = useTranslation()
  const groups = useHostStore(s => s.groups)
  const hosts = useHostStore(s => s.hosts)
  const [portForwardDialogOpen, setPortForwardDialogOpen] = useState(false)
  const [environmentDialogOpen, setEnvironmentDialogOpen] = useState(false)
  const {
    form,
    setForm,
    saving,
    deleteDialogOpen,
    setDeleteDialogOpen,
    envVars,
    setEnvVars,
    discardOpen,
    setDiscardOpen,
    handleSubmit,
    handleClearCredential,
    vaultRecovery,
    recoverVault,
    handleDelete,
    handleFormChange,
    requestClose,
  } = useHostDialogForm({ open, host, onClose })

  // "Clear" on a host that stores nothing would be a button that does nothing.
  const hasStoredCredential = (host?.credentialRef?.kinds.length ?? 0) > 0
  if (!open) return null

  return (
    <>
      <Dialog open={open} onOpenChange={next => { if (!next) requestClose() }}>
        <DialogContent className="flex max-h-[85vh] w-[calc(100vw-1rem)] max-w-[520px] flex-col overflow-hidden p-0 sm:w-full">
          <DialogHeader className="border-b p-4 text-left">
            <DialogTitle>
              {host ? t('hosts.form.editHost') : t('hosts.form.newHost')}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t('hosts.form.dialogDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {/*
              An imported host whose config named a key file cannot connect until
              the key is bound. Showing that here is the difference between a host
              that looks configured and one the user can actually fix.
            */}
            {hasStoredCredential && (
              <ClearCredentialAction onClear={handleClearCredential} />
            )}

            {host?.identityFilePath !== undefined && (
              <IdentityFileNotice
                path={host.identityFilePath}
                onFocusKeyField={() => {
                  // `scrollIntoView` and `focus` are both optional here: the point
                  // is to put the cursor in the key field, and a runtime without
                  // them (jsdom, or an embedder with a reduced DOM) must not throw
                  // from an advisory button.
                  const field = document.getElementById('privateKey') as
                    | HTMLTextAreaElement
                    | HTMLInputElement
                    | null
                  if (field === null) return
                  field.scrollIntoView?.({ block: 'center' })
                  field.focus?.()
                }}
              />
            )}

            <HostFormBasic
              form={form}
              groups={groups}
              hosts={hosts}
              currentHostId={host?.id}
              onChange={handleFormChange}
            />

            <HostDialogAdvancedFields
              form={form}
              onChange={setForm}
              onOpenEnvironment={() => setEnvironmentDialogOpen(true)}
              onOpenPortForwards={() => setPortForwardDialogOpen(true)}
            />

            {vaultRecovery && (
              <VaultRecovery
                state={vaultRecovery}
                onCreate={recoverVault}
                onUnlock={recoverVault}
              />
            )}
          </div>

          <HostFormActions
            host={host}
            saving={saving}
            deleteDialogOpen={deleteDialogOpen}
            onClose={requestClose}
            onDelete={handleDelete}
            onDeleteDialogOpenChange={setDeleteDialogOpen}
            onSubmit={handleSubmit}
          />
        </DialogContent>
      </Dialog>

      <PortForwardDialog
        open={portForwardDialogOpen}
        onClose={() => setPortForwardDialogOpen(false)}
        portForwards={form.portForwards || []}
        onSave={forwards => setForm({ ...form, portForwards: forwards })}
      />

      <EnvironmentVariablesDialog
        open={environmentDialogOpen}
        onClose={() => setEnvironmentDialogOpen(false)}
        envVars={envVars}
        onSave={newEnvVars => {
          const envRecord: Record<string, string> = {}
          for (const { key, value } of newEnvVars) {
            if (key.trim()) {
              envRecord[key.trim()] = value
            }
          }
          setEnvVars(newEnvVars)
          setForm({
            ...form,
            environment:
              Object.keys(envRecord).length > 0 ? envRecord : undefined,
          })
        }}
      />

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('hosts.form.discardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('hosts.form.discardDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('hosts.form.keepEditing')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDiscardOpen(false)
                onClose()
              }}
            >
              {t('hosts.form.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
