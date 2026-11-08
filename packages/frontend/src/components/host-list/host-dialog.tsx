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
    handleDelete,
    handleFormChange,
    requestClose,
  } = useHostDialogForm({ open, host, onClose })

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
