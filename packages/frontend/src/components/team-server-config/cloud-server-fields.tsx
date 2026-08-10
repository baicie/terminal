import {
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  Key,
  RefreshCw,
  Server,
} from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'

export type ConnectionStatus = 'idle' | 'success' | 'error'

interface CloudServerFieldsProps {
  endpoint: string
  apiToken: string
  showToken: boolean
  autoSync: boolean
  syncInterval: number
  testing: boolean
  connectionStatus: ConnectionStatus
  errorMessage: string
  onEndpointChange: (value: string) => void
  onApiTokenChange: (value: string) => void
  onShowTokenChange: (value: boolean) => void
  onAutoSyncChange: (value: boolean) => void
  onSyncIntervalChange: (value: number) => void
  onTestConnection: () => void
}

export function CloudServerFields({
  endpoint,
  apiToken,
  showToken,
  autoSync,
  syncInterval,
  testing,
  connectionStatus,
  errorMessage,
  onEndpointChange,
  onApiTokenChange,
  onShowTokenChange,
  onAutoSyncChange,
  onSyncIntervalChange,
  onTestConnection,
}: CloudServerFieldsProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3">
      <Separator />
      <div className="flex flex-col gap-2">
        <Label htmlFor="serverEndpoint">{t('settings.serverEndpoint')}</Label>
        <Input
          id="serverEndpoint"
          placeholder="http://localhost:3000"
          value={endpoint}
          onChange={event => onEndpointChange(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {t('settings.serverEndpointDesc')}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="apiToken" className="flex items-center gap-1">
          <Key />
          {t('settings.apiToken')}
        </Label>
        <div className="flex gap-2">
          <Input
            id="apiToken"
            type={showToken ? 'text' : 'password'}
            placeholder={t('settings.enterApiToken')}
            value={apiToken}
            onChange={event => onApiTokenChange(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            title={
              showToken
                ? t('settings.hideApiToken')
                : t('settings.showApiToken')
            }
            onClick={() => onShowTokenChange(!showToken)}
          >
            {showToken ? <EyeOff /> : <Eye />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('settings.apiTokenDesc')}
        </p>
      </div>

      {connectionStatus !== 'idle' && (
        <div className="flex items-center gap-2 rounded border bg-muted/50 p-3">
          {connectionStatus === 'success' ? (
            <>
              <Check className="text-primary" />
              <span className="text-sm">{t('settings.connected')}</span>
            </>
          ) : (
            <>
              <AlertCircle className="text-destructive" />
              <span className="text-sm text-destructive">{errorMessage}</span>
            </>
          )}
        </div>
      )}

      <Button
        variant="outline"
        onClick={onTestConnection}
        disabled={testing || !endpoint}
      >
        {testing ? (
          <RefreshCw className="animate-spin" data-icon="inline-start" />
        ) : (
          <Server data-icon="inline-start" />
        )}
        {testing ? t('settings.testing') : t('settings.testConnection')}
      </Button>

      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor="autoSync">{t('settings.autoSync')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('settings.autoSyncDesc')}
          </p>
        </div>
        <Switch
          id="autoSync"
          checked={autoSync}
          onCheckedChange={onAutoSyncChange}
        />
      </div>

      {autoSync && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="syncInterval">{t('settings.syncInterval')}</Label>
          <Select
            value={syncInterval.toString()}
            onValueChange={value =>
              onSyncIntervalChange(Number.parseInt(value))
            }
          >
            <SelectTrigger id="syncInterval">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="15000">{t('settings.seconds15')}</SelectItem>
              <SelectItem value="30000">{t('settings.seconds30')}</SelectItem>
              <SelectItem value="60000">{t('settings.minute1')}</SelectItem>
              <SelectItem value="300000">{t('settings.minutes5')}</SelectItem>
              <SelectItem value="600000">{t('settings.minutes10')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}
