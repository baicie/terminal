import type { Host } from '@/types'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { toast } from '@/components/ui/sonner'
import PortForwardDialog from '@/components/port-forward'
import { EnvironmentVariablesDialog } from './environment-dialog'
import { HostFormBasic } from './host-form-basic'
import { HostFormActions } from './host-form-actions'
import {
  HostDialogAdvancedFields,
  type HostFormState,
} from './host-dialog-advanced-fields'
import { useHostStore } from '@/store/host'

interface HostDialogProps {
  open: boolean
  host?: Host | null
  onClose: () => void
}

const defaultHost: HostFormState = {
  name: '',
  hostname: '',
  port: 22,
  username: '',
  authType: 'password',
  password: '',
  privateKey: '',
  certificate: '',
  groupId: undefined,
  isFavorite: false,
  color: undefined,
  tags: [],
  portForwards: [],
  startupCommand: undefined,
  environment: undefined,
  jumpHostId: undefined,
  jumpHostAuthType: undefined,
  agentForwarding: false,
}

export const HostDialog: React.FC<HostDialogProps> = ({
  open,
  host,
  onClose,
}) => {
  const hostStore = useHostStore()
  const groups = useHostStore(s => s.groups)
  const hosts = useHostStore(s => s.hosts)
  const [form, setForm] = useState(defaultHost)
  const [saving, setSaving] = useState(false)
  const [portForwardDialogOpen, setPortForwardDialogOpen] = useState(false)
  const [environmentDialogOpen, setEnvironmentDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>(
    [],
  )

  useEffect(() => {
    if (host) {
      setForm({
        name: host.name,
        hostname: host.hostname,
        port: host.port,
        username: host.username,
        authType: host.authType,
        password: host.password || '',
        privateKey: host.privateKey || '',
        certificate: host.certificate || '',
        groupId: host.groupId,
        isFavorite: host.isFavorite,
        color: host.color,
        tags: host.tags,
        portForwards: host.portForwards,
        startupCommand: host.startupCommand,
        environment: host.environment,
        jumpHostId: host.jumpHostId,
        jumpHostAuthType: host.jumpHostAuthType,
        agentForwarding: host.agentForwarding ?? false,
      })
      if (host.environment) {
        setEnvVars(
          Object.entries(host.environment).map(([key, value]) => ({
            key,
            value,
          })),
        )
      } else {
        setEnvVars([])
      }
    } else {
      setForm(defaultHost)
      setEnvVars([])
    }
  }, [host, open])

  const handleSubmit = async () => {
    if (!form.name || !form.hostname || !form.username) {
      toast.error(
        'Please fill in all required fields (name, hostname, username)',
      )
      return
    }
    setSaving(true)
    try {
      if (host) {
        await hostStore.updateHost(host.id, form)
      } else {
        await hostStore.addHost(form)
      }
      toast.success(host ? 'Host updated' : 'Host created')
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Failed to save host', { description: msg })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (host) {
      await hostStore.deleteHost(host.id)
      setDeleteDialogOpen(false)
      onClose()
    }
  }

  const handleFormChange = (partial: Partial<Host>) => {
    setForm(prev => ({ ...prev, ...partial }))
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[500px] max-h-[80vh] bg-background rounded-lg shadow-xl overflow-hidden flex flex-col">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">
            {host ? 'Edit Host' : 'New Host'}
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
          onClose={onClose}
          onDelete={handleDelete}
          onDeleteDialogOpenChange={setDeleteDialogOpen}
          onSubmit={handleSubmit}
        />
      </div>

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
    </div>
  )
}
