import type { TFunction } from 'i18next'
import { RefreshCw, Server } from 'lucide-react'
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
import type { AppSettings } from '@/service/database'

interface StorageServicePanelProps {
  settings: AppSettings
  onSettingChange: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => void
  showTokenVisible: boolean
  onToggleToken: () => void
  t: TFunction<'settings'>
}

function endpointPlaceholder(type: AppSettings['syncServiceType']): string {
  switch (type) {
    case 'webdav':
      return 'https://dav.example.com/backup/'
    case 's3':
      return 'https://s3.example.com/bucket/'
    default:
      return 'https://api.example.com/sync/'
  }
}

export function StorageServicePanel({
  settings,
  onSettingChange,
  showTokenVisible,
  onToggleToken,
  t,
}: StorageServicePanelProps) {
  return (
    <>
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Server className="size-4" />
        {t('settings.syncService')}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t('settings.syncServiceDesc')}
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="syncServiceType">{t('settings.serviceType')}</Label>
        <Select
          value={settings.syncServiceType}
          onValueChange={value =>
            onSettingChange(
              'syncServiceType',
              value as AppSettings['syncServiceType'],
            )
          }
        >
          <SelectTrigger id="syncServiceType">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="webdav">WebDAV</SelectItem>
            <SelectItem value="s3">S3 / S3-Compatible</SelectItem>
            <SelectItem value="custom">Custom REST API</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <SettingInput
        id="syncServiceEndpoint"
        label={t('settings.endpoint')}
        placeholder={endpointPlaceholder(settings.syncServiceType)}
        value={settings.syncServiceEndpoint}
        onChange={value => onSettingChange('syncServiceEndpoint', value)}
      />
      <SettingInput
        id="syncServiceUsername"
        label={
          settings.syncServiceType === 's3'
            ? 'Access Key ID'
            : t('settings.username')
        }
        value={settings.syncServiceUsername}
        onChange={value => onSettingChange('syncServiceUsername', value)}
      />

      <div className="flex flex-col gap-2">
        <Label htmlFor="syncServiceToken">{t('settings.password')}</Label>
        <div className="relative">
          <Input
            id="syncServiceToken"
            type={showTokenVisible ? 'text' : 'password'}
            value={settings.syncServiceToken}
            onChange={event =>
              onSettingChange('syncServiceToken', event.target.value)
            }
            className="pr-10"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2"
            onClick={onToggleToken}
            title={t('settings.password')}
          >
            {showTokenVisible ? <RefreshCw /> : <Server />}
          </Button>
        </div>
      </div>

      {settings.syncServiceType === 's3' && (
        <>
          <SettingInput
            id="syncServiceBucket"
            label={t('settings.bucket')}
            value={settings.syncServiceBucket || ''}
            onChange={value => onSettingChange('syncServiceBucket', value)}
          />
          <SettingInput
            id="syncServiceRegion"
            label="Region"
            placeholder="us-east-1"
            value={settings.syncServiceRegion || ''}
            onChange={value => onSettingChange('syncServiceRegion', value)}
          />
        </>
      )}
    </>
  )
}

interface SettingInputProps {
  id: string
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}

function SettingInput({
  id,
  label,
  value,
  placeholder,
  onChange,
}: SettingInputProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        placeholder={placeholder}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </div>
  )
}
