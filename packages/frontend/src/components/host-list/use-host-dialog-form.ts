import type { Host } from '@/types'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/sonner'
import { useHostStore } from '@/store/host'
import type { HostFormState } from './host-dialog-advanced-fields'

export const defaultHost: HostFormState = {
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
  shellIntegration: 'off',
}

interface Options {
  open: boolean
  host?: Host | null
  onClose: () => void
}

/** Form state and persistence for the host dialog, kept out of its layout. */
export function useHostDialogForm({ open, host, onClose }: Options) {
  const { t } = useTranslation()
  const hostStore = useHostStore()
  const [form, setForm] = useState(defaultHost)
  const [saving, setSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [envVars, setEnvVars] = useState<{ key: string, value: string }[]>([])
  const [baseline, setBaseline] = useState<HostFormState>(defaultHost)
  const [discardOpen, setDiscardOpen] = useState(false)
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline)

  useEffect(() => {
    if (host) {
      const nextForm: HostFormState = {
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
        shellIntegration: host.shellIntegration ?? 'off',
      }
      setForm(nextForm)
      setBaseline(nextForm)
      setEnvVars(
        host.environment
          ? Object.entries(host.environment).map(([key, value]) => ({
              key,
              value,
            }))
          : [],
      )
    } else {
      setForm(defaultHost)
      setBaseline(defaultHost)
      setEnvVars([])
    }
  }, [host, open])

  const handleSubmit = async () => {
    if (saving) return
    if (!form.name || !form.hostname || !form.username) {
      toast.error(t('hosts.toast.requiredFields'))
      return
    }
    setSaving(true)
    try {
      if (host) {
        await hostStore.updateHost(host.id, form)
      } else {
        await hostStore.addHost(form)
      }
      toast.success(host ? t('hosts.toast.updated') : t('hosts.toast.created'))
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('hosts.toast.saveFailed'), { description: msg })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!host) return
    await hostStore.deleteHost(host.id)
    setDeleteDialogOpen(false)
    onClose()
  }

  const handleFormChange = (partial: Partial<Host>) => {
    setForm(prev => ({ ...prev, ...partial }))
  }

  const requestClose = () => {
    if (dirty) {
      setDiscardOpen(true)
      return
    }
    onClose()
  }

  return {
    form,
    setForm,
    saving,
    deleteDialogOpen,
    setDeleteDialogOpen,
    envVars,
    setEnvVars,
    discardOpen,
    setDiscardOpen,
    dirty,
    handleSubmit,
    handleDelete,
    handleFormChange,
    requestClose,
  }
}
