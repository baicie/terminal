import type { AuthType, Host } from '@/types'
import { Network } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import * as React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface HostFormBasicProps {
  form: Omit<Host, 'id' | 'createdAt' | 'updatedAt'>
  groups: Array<{ id: string; name: string }>
  hosts: Host[]
  currentHostId?: string
  onChange: (partial: Partial<Host>) => void
}

export const HostFormBasic: React.FC<HostFormBasicProps> = ({
  form,
  groups,
  hosts,
  currentHostId,
  onChange,
}) => {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <Label htmlFor="name" className="text-sm font-medium mb-1 block">
          {t('hosts.form.name')}
        </Label>
        <Input
          id="name"
          value={form.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder={t('hosts.form.namePlaceholder')}
        />
      </div>

      <div>
        <Label htmlFor="hostname" className="text-sm font-medium mb-1 block">
          {t('hosts.form.hostname')}
        </Label>
        <Input
          id="hostname"
          value={form.hostname}
          onChange={e => onChange({ hostname: e.target.value })}
          placeholder={t('hosts.form.hostnamePlaceholder')}
        />
      </div>

      <div>
        <Label htmlFor="port" className="text-sm font-medium mb-1 block">
          {t('hosts.form.port')}
        </Label>
        <Input
          id="port"
          type="number"
          value={form.port}
          onChange={e =>
            onChange({
              port: Number.parseInt(e.target.value) || 22,
            })
          }
        />
      </div>

      <div>
        <Label htmlFor="username" className="text-sm font-medium mb-1 block">
          {t('hosts.form.username')}
        </Label>
        <Input
          id="username"
          value={form.username}
          onChange={e => onChange({ username: e.target.value })}
          placeholder="root"
        />
      </div>

      <div>
        <Label htmlFor="group" className="text-sm font-medium mb-1 block">
          {t('hosts.form.group')}
        </Label>
        <Select
          value={form.groupId || ''}
          onValueChange={v => onChange({ groupId: v || undefined })}
        >
          <SelectTrigger id="group">
            <SelectValue placeholder={t('hosts.form.noGroup')} />
          </SelectTrigger>
          <SelectContent>
            {groups.map(g => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="col-span-2">
        <Label
          htmlFor="jumpHost"
          className="text-sm font-medium mb-1 flex items-center gap-1"
        >
          <Network className="size-3.5" />
          {t('hosts.form.jumpHost')}
        </Label>
        <Select
          value={form.jumpHostId || ''}
          onValueChange={v => onChange({ jumpHostId: v || undefined })}
        >
          <SelectTrigger id="jumpHost">
            <SelectValue placeholder={t('hosts.form.directConnection')} />
          </SelectTrigger>
          <SelectContent>
            {hosts
              .filter(h => h.id !== currentHostId)
              .map(h => (
                <SelectItem key={h.id} value={h.id}>
                  {h.name} ({h.username}@{h.hostname})
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {t('hosts.form.jumpHostDesc')}
        </p>
      </div>

      {form.jumpHostId && (
        <div className="col-span-2">
          <Label htmlFor="jumpHostAuth" className="text-sm font-medium mb-1 block">
            {t('hosts.form.jumpHostAuth')}
          </Label>
          <Select
            value={form.jumpHostAuthType || ''}
            onValueChange={v =>
              onChange({
                jumpHostAuthType: (v as AuthType) || undefined,
              })
            }
          >
            <SelectTrigger id="jumpHostAuth">
              <SelectValue placeholder={t('hosts.form.defaultAuth')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="password">{t('hosts.form.password')}</SelectItem>
              <SelectItem value="key">{t('hosts.form.sshKey')}</SelectItem>
              <SelectItem value="agent">{t('hosts.form.sshAgent')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}
