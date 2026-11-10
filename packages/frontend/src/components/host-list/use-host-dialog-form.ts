import type { Host } from '@/types'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/sonner'
import { vaultSecretProvider } from '@/service/vault-secret-provider'
import { vaultService } from '@/service/vault'
import type { VaultRecoveryState } from './vault-recovery'
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

  /**
   * Which vault problem stopped the last save, if any.
   *
   * A save can be refused for reasons that have a fix right here (create the
   * vault, unlock it) and for reasons that do not (the vault file is unreadable,
   * or the database itself failed). Only the first kind replaces the toast with
   * an in-dialog action: offering "create a vault" for a database error would
   * send the user to fix the wrong thing.
   */
  const [vaultRecovery, setVaultRecovery] =
    useState<VaultRecoveryState | null>(null)

  const save = async () => {
    if (host) {
      await hostStore.updateHost(host.id, form)
    } else {
      await hostStore.addHost(form)
    }
  }

  /** Ask the vault why it refused, so the panel can name a real next step. */
  const detectVaultProblem = async (): Promise<VaultRecoveryState | null> => {
    try {
      const availability = await vaultSecretProvider.availability()
      if (availability.ok) return null
      return availability.state
    } catch {
      // Could not even ask. That is "unusable", and it is not a vault we can
      // guide the user to create or unlock.
      return 'unusable'
    }
  }

  const handleSubmit = async () => {
    if (saving) return
    if (!form.name || !form.hostname || !form.username) {
      toast.error(t('hosts.toast.requiredFields'))
      return
    }
    setSaving(true)
    setVaultRecovery(null)
    try {
      await save()
      toast.success(host ? t('hosts.toast.updated') : t('hosts.toast.created'))
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // The vault's own refusal is the only failure that has an in-place fix.
      // Anything else stays a toast; the form keeps its values either way.
      const problem = await detectVaultProblem()
      setVaultRecovery(problem)
      toast.error(t('hosts.toast.saveFailed'), { description: msg })
    } finally {
      setSaving(false)
    }
  }

  /**
   * Create or unlock the vault, then retry the save that was refused.
   *
   * Retrying here — rather than making the user press Save again — is the whole
   * point: the form still holds what they typed, and re-submitting the same
   * payload is exactly what they were trying to do.
   */
  const recoverVault = async (masterPassword: string) => {
    if (vaultRecovery === 'uninitialized') {
      await vaultService.create(masterPassword)
    } else if (vaultRecovery === 'locked') {
      await vaultService.unlock(masterPassword)
    } else {
      return
    }
    setSaving(true)
    try {
      await save()
      setVaultRecovery(null)
      toast.success(host ? t('hosts.toast.updated') : t('hosts.toast.created'))
      onClose()
    } catch (err) {
      // The retry failed for a different reason; surface it without pretending
      // the vault fix worked.
      const msg = err instanceof Error ? err.message : String(err)
      setVaultRecovery(await detectVaultProblem())
      throw new Error(msg)
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
    vaultRecovery,
    recoverVault,
    handleDelete,
    handleFormChange,
    requestClose,
  }
}
