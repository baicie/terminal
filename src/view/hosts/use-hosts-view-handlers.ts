import type { SnippetRecord } from '@/service/database'
import type { SerialConfig } from '@/service/serial'
import type { Host } from '@/types'
import type { TeamMember , SharedHostRecord, SharedSnippetRecord } from '@/store/team'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/components/ui/sonner'
import { createSnippet } from '@/service/database'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { useTeamStore } from '@/store/team'
import { decryptWithPassword, isEncryptedData, type EncryptedData } from '@/utils/team-encryption'

export function useHostsViewHandlers() {
  const hosts = useHostStore(s => s.hosts)
  const hostStore = useHostStore()
  const app = useAppStore()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const currentTeam = useTeamStore(s => s.currentTeam)

  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [shareDialogHost, setShareDialogHost] = useState<Host | null>(null)
  const [decryptDialogOpen, setDecryptDialogOpen] = useState(false)
  const [decryptPassword, setDecryptPassword] = useState('')
  const [decryptingHost, setDecryptingHost] = useState<SharedHostRecord | null>(null)
  const [serialDialogOpen, setSerialDialogOpen] = useState(false)

  const importHostData = useCallback(
    async (hostData: Record<string, unknown>) => {
      const newHost: Host = {
        id: crypto.randomUUID(),
        name: hostData.name as string,
        hostname: hostData.hostname as string,
        port: (hostData.port as number) || 22,
        username: hostData.username as string,
        authType: (hostData.auth_type as Host['authType']) || 'password',
        password: hostData.password as string | undefined,
        privateKey: hostData.private_key as string | undefined,
        groupId: hostData.group_id as string | undefined,
        isFavorite: Boolean(hostData.is_favorite),
        color: hostData.color as string | undefined,
        portForwards: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      await hostStore.addHost(newHost)
      toast.success(t('teams.importSuccess'), { description: newHost.name })
    },
    [hostStore, t],
  )

  const handleImportSharedSnippet = useCallback(
    async (sharedSnippet: SharedSnippetRecord) => {
      const snippetData = sharedSnippet.snippetData as {
        name: string
        description?: string
        script: string
        package_id?: string
        tags?: string
        variables?: string
      }
      const newSnippet: SnippetRecord = {
        id: crypto.randomUUID(),
        name: snippetData.name,
        description: snippetData.description,
        script: snippetData.script,
        package_id: snippetData.package_id,
        tags: snippetData.tags,
        variables: snippetData.variables,
      }
      try {
        await createSnippet(newSnippet)
        toast.success(t('teams.importSuccess'), { description: snippetData.name })
      } catch (error) {
        toast.error(String(error))
      }
    },
    [t],
  )

  const handleImportSharedHost = useCallback(
    async (sharedHost: SharedHostRecord) => {
      const hostData = sharedHost.hostData as Record<string, unknown>
      const isEncrypted = hostData._encrypted === true
      if (isEncrypted) {
        setDecryptingHost(sharedHost)
        setDecryptPassword('')
        setDecryptDialogOpen(true)
        return
      }
      await importHostData(hostData)
    },
    [importHostData],
  )

  const handleDecryptAndImport = useCallback(async () => {
    if (!decryptingHost || !decryptPassword) return
    try {
      const hostData = { ...decryptingHost.hostData } as Record<string, unknown>
      if (hostData.password_encrypted && isEncryptedData(hostData.password_encrypted)) {
        hostData.password = await decryptWithPassword(
          hostData.password_encrypted as EncryptedData,
          decryptPassword,
        )
        delete hostData.password_encrypted
      }
      if (hostData.private_key_encrypted && isEncryptedData(hostData.private_key_encrypted)) {
        hostData.private_key = await decryptWithPassword(
          hostData.private_key_encrypted as EncryptedData,
          decryptPassword,
        )
        delete hostData.private_key_encrypted
      }
      delete hostData._encrypted
      await importHostData(hostData)
      setDecryptDialogOpen(false)
      setDecryptPassword('')
      setDecryptingHost(null)
    } catch {
      toast.error(t('teams.decryptFailed'))
    }
  }, [decryptingHost, decryptPassword, importHostData, t])

  const handleShareHostClick = useCallback((host: Host) => {
    setShareDialogHost(host)
    setShareDialogOpen(true)
  }, [])

  const handleShareHost = useCallback(
    async (hostData: Record<string, unknown>, permission: 'readonly' | 'readwrite') => {
      if (!currentTeam) return
      await useTeamStore.getState().shareHost(currentTeam.id, hostData, permission)
    },
    [currentTeam],
  )

  const handleConnect = useCallback(
    (host: Host) => {
      const newTab = app.addTab({ label: host.name, type: 'remote', hostId: host.id })
      navigate(`/terminal?tab=${newTab.id}`)
    },
    [app, navigate],
  )

  const handleNewLocalTerminal = useCallback(() => {
    const newTab = app.addTab({ label: 'Local', type: 'local' })
    navigate(`/terminal?tab=${newTab.id}`)
  }, [app, navigate])

  const handleConnectBarSubmit = useCallback(
    (searchQuery: string) => {
      const q = searchQuery.trim()
      if (!q) {
        toast.info(t('toast.enterHost'))
        return
      }
      const lower = q.toLowerCase()
      const match = hosts.find(
        h =>
          h.name.toLowerCase().includes(lower) ||
          h.hostname.toLowerCase().includes(lower) ||
          `${h.username}@${h.hostname}`.toLowerCase().includes(lower.replace(/^ssh\s+/i, '')),
      )
      if (match) {
        handleConnect(match)
      } else {
        toast.info(t('toast.noMatchedHost'), { description: t('toast.useNewHost') })
      }
    },
    [hosts, handleConnect, t],
  )

  const handleConnectSerial = useCallback(
    (config: SerialConfig, sessionId: string) => {
      const portName = config.name.split('/').pop() || config.name
      const newTab = app.addTab({
        label: `Serial (${portName})`,
        type: 'serial',
        serialSessionId: sessionId,
        serialConfig: { port: config.name, baudRate: config.baudRate },
      })
      navigate(`/terminal?tab=${newTab.id}`)
      setSerialDialogOpen(false)
    },
    [app, navigate],
  )

  return {
    shareDialogOpen,
    setShareDialogOpen,
    shareDialogHost,
    decryptDialogOpen,
    setDecryptDialogOpen,
    decryptPassword,
    setDecryptPassword,
    decryptingHost,
    serialDialogOpen,
    setSerialDialogOpen,
    handleImportSharedSnippet,
    handleImportSharedHost,
    handleDecryptAndImport,
    handleShareHostClick,
    handleShareHost,
    handleConnect,
    handleNewLocalTerminal,
    handleConnectBarSubmit,
    handleConnectSerial,
  }
}
