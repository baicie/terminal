import type { Host } from '@/types'
import type { ScriptRecord } from '@/service/database'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

interface ScriptFormDialogContentProps {
  script: ScriptRecord | null
  hosts: Host[]
  formName: string
  formDescription: string
  formScript: string
  formHostIds: string[]
  formScheduleType: 'manual' | 'once' | 'interval' | 'cron'
  formScheduleValue: string
  formTimeout: number
  formRetryCount: number
  onFormChange: (field: string, value: string | string[] | number) => void
  onHostToggle: (hostId: string) => void
}

export const ScriptFormDialogContent: React.FC<
  ScriptFormDialogContentProps
> = ({
  hosts,
  formName,
  formDescription,
  formScript,
  formHostIds,
  formScheduleType,
  formScheduleValue,
  formTimeout,
  formRetryCount,
  onFormChange,
  onHostToggle,
}) => {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="script-name">{t('scripts.name')} *</Label>
        <Input
          id="script-name"
          value={formName}
          onChange={e => onFormChange('name', e.target.value)}
          placeholder={t('scripts.namePlaceholder')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="script-description">{t('scripts.description')}</Label>
        <Input
          id="script-description"
          value={formDescription}
          onChange={e => onFormChange('description', e.target.value)}
          placeholder={t('scripts.descriptionPlaceholder')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="script-content">{t('scripts.script')} *</Label>
        <Textarea
          id="script-content"
          value={formScript}
          onChange={e => onFormChange('script', e.target.value)}
          placeholder={t('scripts.scriptPlaceholder')}
          className="font-mono text-sm min-h-[150px]"
        />
      </div>

      <div className="space-y-2">
        <Label>{t('scripts.targetHosts')}</Label>
        <div className="flex flex-wrap gap-2 p-3 border rounded-md max-h-48 overflow-y-auto">
          {hosts.map(host => (
            <div key={host.id} className="flex items-center gap-2">
              <Checkbox
                id={`script-host-${host.id}`}
                checked={formHostIds.includes(host.id)}
                onCheckedChange={() => onHostToggle(host.id)}
              />
              <Label
                htmlFor={`script-host-${host.id}`}
                className="text-sm font-normal cursor-pointer"
              >
                {host.name}
              </Label>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {formHostIds.length === 1
            ? t('scripts.hostSelectedCount', { count: formHostIds.length })
            : t('scripts.hostsSelectedCount', { count: formHostIds.length })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="schedule-type">{t('scripts.scheduleType')}</Label>
          <Select
            value={formScheduleType}
            onValueChange={v => onFormChange('scheduleType', v)}
          >
            <SelectTrigger id="schedule-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">{t('scripts.manual')}</SelectItem>
              <SelectItem value="once">{t('scripts.once')}</SelectItem>
              <SelectItem value="interval">{t('scripts.interval')}</SelectItem>
              <SelectItem value="cron">{t('scripts.cron')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="schedule-value">{t('scripts.scheduleValue')}</Label>
          <Input
            id="schedule-value"
            value={formScheduleValue}
            onChange={e => onFormChange('scheduleValue', e.target.value)}
            placeholder={
              formScheduleType === 'interval'
                ? '60000'
                : formScheduleType === 'cron'
                  ? '* * * * *'
                  : ''
            }
            disabled={formScheduleType === 'manual'}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="timeout">{t('scripts.timeoutSeconds')}</Label>
          <Input
            id="timeout"
            type="number"
            min={1}
            max={86400}
            value={formTimeout}
            onChange={e =>
              onFormChange(
                'timeout',
                Math.min(
                  Math.max(Number.parseInt(e.target.value, 10) || 60, 1),
                  86400,
                ),
              )
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="retry-count">{t('scripts.retryCount')}</Label>
          <Input
            id="retry-count"
            type="number"
            min={0}
            max={10}
            value={formRetryCount}
            onChange={e =>
              onFormChange(
                'retryCount',
                Math.min(
                  Math.max(Number.parseInt(e.target.value, 10) || 0, 0),
                  10,
                ),
              )
            }
          />
        </div>
      </div>
    </div>
  )
}
