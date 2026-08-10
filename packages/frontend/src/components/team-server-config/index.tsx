import { Server } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'
import { teamApi } from '@/service/team-api'
import { useTeamStore } from '@/store/team'
import { CloudServerFields, type ConnectionStatus } from './cloud-server-fields'
import { ModeSelector, type TeamServerMode } from './mode-selector'

interface TeamServerConfigProps {
  onClose?: () => void
}

export function TeamServerConfig({ onClose }: TeamServerConfigProps) {
  const { t } = useTranslation()
  const teamStore = useTeamStore()
  const { settings } = teamStore
  const [endpoint, setEndpoint] = useState(settings.endpoint || '')
  const [apiToken, setApiToken] = useState(settings.apiToken || '')
  const [showToken, setShowToken] = useState(false)
  const [mode, setMode] = useState<TeamServerMode>(settings.mode)
  const [autoSync, setAutoSync] = useState(settings.autoSync)
  const [syncInterval, setSyncInterval] = useState(settings.syncInterval)
  const [testing, setTesting] = useState(false)
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const resetConnectionStatus = () => setConnectionStatus('idle')
  const handleTestConnection = async () => {
    if (!endpoint) {
      toast.error(t('settings.enterEndpoint'))
      return
    }
    setTesting(true)
    resetConnectionStatus()
    setErrorMessage('')

    try {
      let currentToken = apiToken
      const userProfile = teamStore.userProfile
      teamApi.configure(endpoint, currentToken, userProfile?.id || '')
      if (!currentToken.trim()) {
        if (!userProfile) throw new Error(t('settings.connectionFailed'))
        const result = await teamApi.register(userProfile.id, userProfile.name)
        if (result.error) throw new Error(result.error)
        if (!result.data?.token)
          throw new Error('Registration did not return an API token')
        currentToken = result.data.token
        setApiToken(currentToken)
        teamApi.configure(endpoint, currentToken, userProfile.id)
      }
      const healthy = await teamApi.healthCheck()
      setConnectionStatus(healthy ? 'success' : 'error')
      if (healthy) toast.success(t('settings.connectionSuccess'))
      else {
        setErrorMessage(t('settings.connectionFailed'))
        toast.error(t('settings.connectionFailed'))
      }
    } catch (error) {
      setConnectionStatus('error')
      setErrorMessage(
        error instanceof Error ? error.message : t('settings.connectionFailed'),
      )
      toast.error(t('settings.connectionFailed'))
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    await teamStore.saveSettings({
      mode,
      endpoint: mode === 'cloud' ? endpoint : undefined,
      apiToken: mode === 'cloud' ? apiToken : undefined,
      autoSync: mode === 'cloud' ? autoSync : false,
      syncInterval: mode === 'cloud' ? syncInterval : 30000,
    })
    if (mode === 'cloud' && connectionStatus === 'success') {
      await teamStore.cloudLoadTeams()
    }
    toast.success(t('settings.teamSettingsSaved'))
    onClose?.()
  }

  return (
    <div className="flex flex-col gap-3">
      <h4 className="flex items-center gap-2 text-sm font-medium">
        <Server />
        {t('settings.serverConfig')}
      </h4>
      <p className="text-sm text-muted-foreground">
        {t('settings.serverConfigDesc')}
      </p>
      <ModeSelector mode={mode} onChange={setMode} />
      {mode === 'cloud' && (
        <CloudServerFields
          endpoint={endpoint}
          apiToken={apiToken}
          showToken={showToken}
          autoSync={autoSync}
          syncInterval={syncInterval}
          testing={testing}
          connectionStatus={connectionStatus}
          errorMessage={errorMessage}
          onEndpointChange={value => {
            setEndpoint(value)
            resetConnectionStatus()
          }}
          onApiTokenChange={value => {
            setApiToken(value)
            resetConnectionStatus()
          }}
          onShowTokenChange={setShowToken}
          onAutoSyncChange={setAutoSync}
          onSyncIntervalChange={setSyncInterval}
          onTestConnection={() => void handleTestConnection()}
        />
      )}
      <Button
        onClick={() => void handleSave()}
        disabled={mode === 'cloud' && connectionStatus !== 'success'}
      >
        {t('settings.saveConfig')}
      </Button>
    </div>
  )
}
