import type { SnippetRecord } from '@/service/database'
import type { SerialConfig } from '@/service/serial'
import type { Host } from '@/types'
import type { SharedHost, SharedSnippet } from '@/store/team'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { QuickConnectProfileDraft } from './quick-connect-dialog'
import {
  parseQuickConnectInput,
  type QuickConnectTarget,
} from './quick-connect-parser'
import { toast } from '@/components/ui/sonner'
import {
  registerTemporaryTerminalProfile,
  removeTemporaryTerminalProfile,
} from '@/features/terminal/services/temporary-terminal-profiles'
import { createSnippet } from '@/service/database'
import { createImportedTeamHost } from '@/service/team-host-data'
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
  const [decryptingHost, setDecryptingHost] = useState<SharedHost | null>(null)
  const [serialDialogOpen, setSerialDialogOpen] = useState(false)
  const [quickConnectTarget, setQuickConnectTarget] =
    useState<QuickConnectTarget | null>(null)

  const importHostData = useCallback(
    async (hostData: Record<string, unknown>) => {
      const newHost = createImportedTeamHost(hostData)
      await hostStore.addHost(newHost)
      toast.success(t('teams.importSuccess'), { description: newHost.name })
    },
    [hostStore, t],
  )

  const handleImportSharedSnippet = useCallback(
    async (sharedSnippet: SharedSnippet) => {
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
    async (sharedHost: SharedHost) => {
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

  const handleQuickConnect = useCallback(
    (draft: QuickConnectProfileDraft) => {
      const now = Date.now()
      const profile: Host = {
        ...draft,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      }
      const profileId = registerTemporaryTerminalProfile(profile)
      try {
        const newTab = app.addTab({
          label: profile.name,
          type: 'remote',
          profileId,
        })
        setQuickConnectTarget(null)
        navigate(`/terminal?tab=${newTab.id}`)
      } catch (error) {
        removeTemporaryTerminalProfile(profileId)
        throw error
      }
    },
    [app, navigate],
  )

  const handleConnectBarSubmit = useCallback(
    (searchQuery: string) => {
      const q = searchQuery.trim()
      if (!q) {
        toast.info(t('toast.enterHost'))
        return
      }
      const lower = q.toLowerCase()
      const parsed = parseQuickConnectInput(q)
      const exactMatch = parsed.ok
        ? hosts.find(
            host =>
              host.hostname.toLowerCase() ===
                parsed.target.hostname.toLowerCase() &&
              host.port === parsed.target.port &&
              (!parsed.target.username ||
                host.username.toLowerCase() ===
                  parsed.target.username.toLowerCase()),
          )
        : undefined
      const match =
        exactMatch ??
        hosts.find(
          host =>
            host.name.toLowerCase().includes(lower) ||
            host.hostname.toLowerCase().includes(lower) ||
            `${host.username}@${host.hostname}`
              .toLowerCase()
              .includes(lower.replace(/^ssh\s+/i, '')),
        )
      if (match) {
        handleConnect(match)
        return
      }

      if (parsed.ok) {
        setQuickConnectTarget(parsed.target)
        return
      }

      const errorKey =
        parsed.error === 'invalid-port'
          ? 'quickConnect.invalidPort'
          : parsed.error === 'unsupported-arguments'
            ? 'quickConnect.unsupportedArguments'
            : 'quickConnect.invalidTarget'
      toast.error(t(errorKey))
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
    quickConnectTarget,
    setQuickConnectTarget,
    handleImportSharedSnippet,
    handleImportSharedHost,
    handleDecryptAndImport,
    handleShareHostClick,
    handleShareHost,
    handleConnect,
    handleNewLocalTerminal,
    handleQuickConnect,
    handleConnectBarSubmit,
    handleConnectSerial,
  }
}
