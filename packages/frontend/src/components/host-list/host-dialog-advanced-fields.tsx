import type { AuthType, Host } from '@/types'
import { Network } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AuthFields } from './host-dialog-auth-fields'

export type HostFormState = Omit<Host, 'id' | 'createdAt' | 'updatedAt'>

interface HostDialogAdvancedFieldsProps {
  form: HostFormState
  onChange: (form: HostFormState) => void
  onOpenEnvironment: () => void
  onOpenPortForwards: () => void
}

export function HostDialogAdvancedFields({
  form,
  onChange,
  onOpenEnvironment,
  onOpenPortForwards,
}: HostDialogAdvancedFieldsProps) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <Label htmlFor="authType" className="text-sm font-medium mb-1 block">
          {t('hosts.form.authentication')}
        </Label>
        <Select
          value={form.authType}
          onValueChange={v => onChange({ ...form, authType: v as AuthType })}
        >
          <SelectTrigger id="authType">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="password">{t('hosts.form.password')}</SelectItem>
            <SelectItem value="key">{t('hosts.form.sshKey')}</SelectItem>
            <SelectItem value="agent">{t('hosts.form.sshAgent')}</SelectItem>
            <SelectItem value="cert">{t('hosts.form.sshCertificate')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <AuthFields
        authType={form.authType}
        password={form.password}
        privateKey={form.privateKey}
        certificate={form.certificate}
        onPasswordChange={password => onChange({ ...form, password })}
        onPrivateKeyChange={privateKey => onChange({ ...form, privateKey })}
        onCertificateChange={certificate => onChange({ ...form, certificate })}
      />

      <div className="col-span-2 flex items-start justify-between gap-4 rounded-md border p-3">
        <div className="space-y-1">
          <Label htmlFor="agentForwarding">{t('hosts.form.forwardAgent')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('hosts.form.forwardAgentDesc')}
          </p>
        </div>
        <Switch
          id="agentForwarding"
          aria-label={t('hosts.form.forwardAgent')}
          checked={form.agentForwarding ?? false}
          onCheckedChange={agentForwarding =>
            onChange({ ...form, agentForwarding })
          }
        />
      </div>

      <div className="col-span-2">
        <Label
          htmlFor="shellIntegration"
          className="text-sm font-medium mb-1 block"
        >
          {t('hosts.form.shellIntegration')}
        </Label>
        <Select
          value={form.shellIntegration ?? 'off'}
          onValueChange={shellIntegration =>
            onChange({
              ...form,
              shellIntegration:
                shellIntegration as HostFormState['shellIntegration'],
            })
          }
        >
          <SelectTrigger id="shellIntegration">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">{t('hosts.form.disabled')}</SelectItem>
            <SelectItem value="bash">Bash</SelectItem>
            <SelectItem value="zsh">Zsh</SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('hosts.form.shellIntegrationDesc')}
        </p>
      </div>

      <div className="col-span-2">
        <Label
          htmlFor="startupCommand"
          className="text-sm font-medium mb-1 block"
        >
          {t('hosts.form.startupCommand')}
        </Label>
        <Input
          id="startupCommand"
          value={form.startupCommand}
          onChange={e => onChange({ ...form, startupCommand: e.target.value })}
          placeholder="ls -la"
        />
      </div>

      <div className="col-span-2">
        <Label className="text-sm font-medium mb-1 block">
          {t('hosts.form.environment')}
        </Label>
        <Button variant="outline" size="sm" onClick={onOpenEnvironment}>
          <Network className="size-4 mr-1" />
          {t('hosts.form.configureEnvironment', {
            count: Object.keys(form.environment || {}).length,
          })}
        </Button>
      </div>

      <div className="col-span-2">
        <Label
          htmlFor="portForwards"
          className="text-sm font-medium mb-1 block"
        >
          {t('hosts.form.portForwards')}
        </Label>
        <Button
          id="portForwards"
          variant="outline"
          size="sm"
          onClick={onOpenPortForwards}
        >
          <Network className="size-4 mr-1" />
          {t('hosts.form.configurePortForwards', {
            count: form.portForwards?.length || 0,
          })}
        </Button>
      </div>
    </div>
  )
}
