import type { AuthType, Host } from '@/types'
import { Network } from 'lucide-react'
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
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <Label htmlFor="authType" className="text-sm font-medium mb-1 block">
          Authentication
        </Label>
        <Select
          value={form.authType}
          onValueChange={v => onChange({ ...form, authType: v as AuthType })}
        >
          <SelectTrigger id="authType">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="password">Password</SelectItem>
            <SelectItem value="key">SSH Key</SelectItem>
            <SelectItem value="agent">SSH Agent</SelectItem>
            <SelectItem value="cert">SSH Certificate</SelectItem>
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
          <Label htmlFor="agentForwarding">Forward SSH agent</Label>
          <p className="text-xs text-muted-foreground">
            Allow this host to use identities from your local SSH agent.
          </p>
        </div>
        <Switch
          id="agentForwarding"
          aria-label="Forward SSH agent"
          checked={form.agentForwarding ?? false}
          onCheckedChange={agentForwarding =>
            onChange({ ...form, agentForwarding })
          }
        />
      </div>

      <div className="col-span-2">
        <Label
          htmlFor="startupCommand"
          className="text-sm font-medium mb-1 block"
        >
          Startup Command (optional)
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
          Environment Variables
        </Label>
        <Button variant="outline" size="sm" onClick={onOpenEnvironment}>
          <Network className="h-4 w-4 mr-1" />
          Configure Environment ({Object.keys(form.environment || {}).length})
        </Button>
      </div>

      <div className="col-span-2">
        <Label
          htmlFor="portForwards"
          className="text-sm font-medium mb-1 block"
        >
          Port Forwards
        </Label>
        <Button
          id="portForwards"
          variant="outline"
          size="sm"
          onClick={onOpenPortForwards}
        >
          <Network className="h-4 w-4 mr-1" />
          Configure Port Forwards ({form.portForwards?.length || 0})
        </Button>
      </div>
    </div>
  )
}
