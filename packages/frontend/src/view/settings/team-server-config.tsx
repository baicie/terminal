import {
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  Key,
  Link,
  RefreshCw,
  Server,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/components/ui/sonner'
import { Switch } from '@/components/ui/switch'
import { teamApi } from '@/service/team-api'
import { useTeamStore } from '@/store/team'

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
  const [mode, setMode] = useState<'local' | 'cloud'>(settings.mode)
  const [autoSync, setAutoSync] = useState(settings.autoSync)
  const [syncInterval, setSyncInterval] = useState(settings.syncInterval)
  const [testing, setTesting] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'success' | 'error'
  >('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const handleTestConnection = async () => {
    if (!endpoint) {
      toast.error(t('settings.enterEndpoint'))
      return
    }

    setTesting(true)
    setConnectionStatus('idle')
    setErrorMessage('')

    try {
      let currentToken = apiToken
      if (teamStore.userProfile) {
        const regResult = await teamApi.register(
          teamStore.userProfile.id,
          teamStore.userProfile.name,
        )
        if (regResult.data?.token) {
          currentToken = regResult.data.token
          setApiToken(currentToken)
        }
      }

      teamApi.configure(endpoint, currentToken, teamStore.userProfile?.id || '')

      const healthy = await teamApi.healthCheck()
      if (healthy) {
        setConnectionStatus('success')
        toast.success(t('settings.connectionSuccess'))
      } else {
        setConnectionStatus('error')
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
    <div className="space-y-3">
      <h4 className="text-sm font-medium flex items-center gap-2">
        <Server className="h-4 w-4" />
        {t('settings.serverConfig')}
      </h4>
      <p className="text-sm text-muted-foreground">
        {t('settings.serverConfigDesc')}
      </p>

      {/* Mode Selection */}
      <div className="space-y-2">
        <Label>{t('settings.mode')}</Label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            className={`
              flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all text-center
              ${
                mode === 'local'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }
            `}
            onClick={() => setMode('local')}
          >
            <Server
              className={`h-6 w-6 ${mode === 'local' ? 'text-primary' : 'text-muted-foreground'}`}
            />
            <span className="text-sm font-medium">{t('settings.local')}</span>
            <span className="text-xs text-muted-foreground">
              {t('settings.localModeDesc')}
            </span>
          </button>
          <button
            type="button"
            className={`
              flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all text-center
              ${
                mode === 'cloud'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }
            `}
            onClick={() => setMode('cloud')}
          >
            <Link
              className={`h-6 w-6 ${mode === 'cloud' ? 'text-primary' : 'text-muted-foreground'}`}
            />
            <span className="text-sm font-medium">{t('settings.cloud')}</span>
            <span className="text-xs text-muted-foreground">
              {t('settings.cloudModeDesc')}
            </span>
          </button>
        </div>
      </div>

      {/* Cloud Configuration */}
      {mode === 'cloud' && (
        <>
          <Separator />

          {/* Server Endpoint */}
          <div className="space-y-2">
            <Label htmlFor="serverEndpoint">
              {t('settings.serverEndpoint')}
            </Label>
            <Input
              id="serverEndpoint"
              placeholder="http://localhost:3000"
              value={endpoint}
              onChange={e => {
                setEndpoint(e.target.value)
                setConnectionStatus('idle')
              }}
            />
            <p className="text-xs text-muted-foreground">
              {t('settings.serverEndpointDesc')}
            </p>
          </div>

          {/* API Token */}
          <div className="space-y-2">
            <Label htmlFor="apiToken" className="flex items-center gap-1">
              <Key className="h-3 w-3" />
              {t('settings.apiToken')}
            </Label>
            <div className="relative">
              <Input
                id="apiToken"
                type={showToken ? 'text' : 'password'}
                placeholder={t('settings.enterApiToken')}
                value={apiToken}
                onChange={e => {
                  setApiToken(e.target.value)
                  setConnectionStatus('idle')
                }}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowToken(v => !v)}
              >
                {showToken ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('settings.apiTokenDesc')}
            </p>
          </div>

          {/* Connection Status */}
          {connectionStatus !== 'idle' && (
            <div
              className={`p-3 rounded-lg flex items-center gap-2 ${
                connectionStatus === 'success'
                  ? 'bg-green-500/10 border border-green-500/20'
                  : 'bg-destructive/10 border border-destructive/20'
              }`}
            >
              {connectionStatus === 'success' ? (
                <>
                  <Check className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-green-600">
                    {t('settings.connected')}
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <span className="text-sm text-destructive">
                    {errorMessage}
                  </span>
                </>
              )}
            </div>
          )}

          {/* Test Connection */}
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={testing || !endpoint}
            className="w-full"
          >
            {testing ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                {t('settings.testing')}
              </>
            ) : (
              <>
                <Server className="h-4 w-4 mr-2" />
                {t('settings.testConnection')}
              </>
            )}
          </Button>

          {/* Auto Sync */}
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="autoSync">{t('settings.autoSync')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.autoSyncDesc')}
              </p>
            </div>
            <Switch
              id="autoSync"
              checked={autoSync}
              onCheckedChange={setAutoSync}
            />
          </div>

          {autoSync && (
            <div className="space-y-2">
              <Label htmlFor="syncInterval">{t('settings.syncInterval')}</Label>
              <Select
                value={syncInterval.toString()}
                onValueChange={v => setSyncInterval(Number.parseInt(v))}
              >
                <SelectTrigger id="syncInterval">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15000">
                    {t('settings.seconds15')}
                  </SelectItem>
                  <SelectItem value="30000">
                    {t('settings.seconds30')}
                  </SelectItem>
                  <SelectItem value="60000">{t('settings.minute1')}</SelectItem>
                  <SelectItem value="300000">
                    {t('settings.minutes5')}
                  </SelectItem>
                  <SelectItem value="600000">
                    {t('settings.minutes10')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </>
      )}

      {/* Save Button */}
      <Button
        onClick={handleSave}
        className="w-full"
        disabled={mode === 'cloud' && connectionStatus !== 'success'}
      >
        {t('settings.saveConfig')}
      </Button>
    </div>
  )
}
