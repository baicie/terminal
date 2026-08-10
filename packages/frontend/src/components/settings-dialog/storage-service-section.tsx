import { Eye, EyeOff, Server } from 'lucide-react'
import type { TFunction } from 'i18next'
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
import type {
  StorageSettings,
  UpdateStorageSetting,
} from './storage-settings-types'

export function StorageServiceSection({
  settings,
  updateSetting,
  t,
  showTokenVisible,
  onToggleToken,
}: {
  settings: StorageSettings
  updateSetting: UpdateStorageSetting
  t: TFunction
  showTokenVisible: boolean
  onToggleToken: () => void
}) {
  const endpoint =
    settings.syncServiceType === 'webdav'
      ? 'https://dav.example.com/backup/'
      : settings.syncServiceType === 's3'
        ? 'https://s3.amazonaws.com'
        : 'https://api.example.com/sync/'
  const username =
    settings.syncServiceType === 's3'
      ? 'YOUR_ACCESS_KEY_ID'
      : t('settings.username')
  const token =
    settings.syncServiceType === 's3'
      ? 'YOUR_SECRET_ACCESS_KEY'
      : ''
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium flex items-center gap-2">
        <Server className="h-4 w-4" />
        {t('settings.syncService')}
      </h4>
      <p className="text-sm text-muted-foreground">
        {t('settings.syncServiceDesc')}
      </p>
      <div className="space-y-2">
        <Label htmlFor="syncServiceType">{t('settings.serviceType')}</Label>
        <Select
          value={settings.syncServiceType}
          onValueChange={value =>
            updateSetting(
              'syncServiceType',
              value as StorageSettings['syncServiceType'],
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
      <div className="space-y-2">
        <Label htmlFor="syncServiceEndpoint">{t('settings.endpoint')}</Label>
        <Input
          id="syncServiceEndpoint"
          placeholder={endpoint}
          value={settings.syncServiceEndpoint}
          onChange={e => updateSetting('syncServiceEndpoint', e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="syncServiceUsername">
          {settings.syncServiceType === 's3'
            ? 'Access Key ID'
            : t('settings.username')}
        </Label>
        <Input
          id="syncServiceUsername"
          placeholder={username}
          value={settings.syncServiceUsername}
          onChange={e => updateSetting('syncServiceUsername', e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="syncServiceToken">
          {settings.syncServiceType === 's3'
            ? 'Secret Access Key'
            : settings.syncServiceType === 'webdav'
              ? 'Password / Token'
              : 'API Token'}
        </Label>
        <div className="relative">
          <Input
            id="syncServiceToken"
            type={showTokenVisible ? 'text' : 'password'}
            placeholder={token}
            value={settings.syncServiceToken}
            onChange={e => updateSetting('syncServiceToken', e.target.value)}
            className="pr-10"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2"
            onClick={onToggleToken}
          >
            {showTokenVisible ? <EyeOff /> : <Eye />}
          </Button>
        </div>
      </div>
      {settings.syncServiceType === 's3' && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="syncServiceBucket">{t('settings.bucket')}</Label>
            <Input
              id="syncServiceBucket"
              placeholder="my-bucket"
              value={settings.syncServiceBucket || ''}
              onChange={e => updateSetting('syncServiceBucket', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="syncServiceRegion">Region</Label>
            <Input
              id="syncServiceRegion"
              placeholder="us-east-1"
              value={settings.syncServiceRegion || ''}
              onChange={e => updateSetting('syncServiceRegion', e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
