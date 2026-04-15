import type { Host } from '@/types'
import type { ScriptRecord } from '@/service/database'
import { Button } from '@/components/ui/button'
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

export const ScriptFormDialogContent: React.FC<ScriptFormDialogContentProps> = ({
  script,
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
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="script-name">Name *</Label>
        <Input
          id="script-name"
          value={formName}
          onChange={e => onFormChange('name', e.target.value)}
          placeholder="Script name"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="script-description">Description</Label>
        <Input
          id="script-description"
          value={formDescription}
          onChange={e => onFormChange('description', e.target.value)}
          placeholder="Optional description"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="script-content">Script *</Label>
        <Textarea
          id="script-content"
          value={formScript}
          onChange={e => onFormChange('script', e.target.value)}
          placeholder="Enter script..."
          className="font-mono text-sm min-h-[150px]"
        />
      </div>

      <div className="space-y-2">
        <Label>Target Hosts</Label>
        <div className="flex flex-wrap gap-2 p-3 border rounded-md max-h-48 overflow-y-auto">
          {hosts.map(host => (
            <div key={host.id} className="flex items-center gap-2">
              <Checkbox
                id={`script-host-${host.id}`}
                checked={formHostIds.includes(host.id)}
                onCheckedChange={() => onHostToggle(host.id)}
              />
              <Label htmlFor={`script-host-${host.id}`} className="text-sm font-normal cursor-pointer">
                {host.name}
              </Label>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {formHostIds.length} {formHostIds.length !== 1 ? 'hosts selected' : 'host selected'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="schedule-type">Schedule Type</Label>
          <Select
            value={formScheduleType}
            onValueChange={v => onFormChange('scheduleType', v)}
          >
            <SelectTrigger id="schedule-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="once">Once</SelectItem>
              <SelectItem value="interval">Interval</SelectItem>
              <SelectItem value="cron">Cron</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="schedule-value">Schedule Value</Label>
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
          <Label htmlFor="timeout">Timeout (seconds)</Label>
          <Input
            id="timeout"
            type="number"
            value={formTimeout}
            onChange={e => onFormChange('timeout', Number.parseInt(e.target.value) || 60)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="retry-count">Retry Count</Label>
          <Input
            id="retry-count"
            type="number"
            value={formRetryCount}
            onChange={e => onFormChange('retryCount', Number.parseInt(e.target.value) || 0)}
          />
        </div>
      </div>
    </div>
  )
}
