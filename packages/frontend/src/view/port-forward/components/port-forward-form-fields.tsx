import type { Host } from '@/types'
import { ArrowLeftRight, Globe, Server } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { PortForwardFormState } from './port-forward-types'

interface PortForwardFormFieldsProps {
  hosts: Host[]
  form: PortForwardFormState
  onChange: (patch: Partial<PortForwardFormState>) => void
}

export const PortForwardFormFields: React.FC<PortForwardFormFieldsProps> = ({
  hosts,
  form,
  onChange,
}) => {
  const isDynamic = form.type === 'dynamic'

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-2">
        <Label>Forward Type</Label>
        <Select
          value={form.type}
          onValueChange={v =>
            onChange({ type: v as PortForwardFormState['type'] })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">
              <div className="flex items-center gap-2">
                <Globe className="size-4" />
                <span>Local Port Forward (-L)</span>
              </div>
            </SelectItem>
            <SelectItem value="remote">
              <div className="flex items-center gap-2">
                <Server className="size-4" />
                <span>Remote Port Forward (-R)</span>
              </div>
            </SelectItem>
            <SelectItem value="dynamic">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="size-4" />
                <span>Dynamic / SOCKS (-D)</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {form.type === 'local' && 'Forward local port to remote host'}
          {form.type === 'remote' && 'Forward remote port to local host'}
          {form.type === 'dynamic' &&
            'Create SOCKS proxy for dynamic forwarding'}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="forward-name">Name (optional)</Label>
        <Input
          id="forward-name"
          value={form.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="My database forward"
        />
      </div>

      {hosts.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="forward-host">Via Host</Label>
          <Select
            value={form.hostId}
            onValueChange={v => onChange({ hostId: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a host (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">None</SelectItem>
              {hosts.map(host => (
                <SelectItem key={host.id} value={host.id}>
                  {host.name} ({host.username}@{host.hostname})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {!isDynamic && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="local-host">Local Host</Label>
              <Input
                id="local-host"
                value={form.localHost}
                onChange={e => onChange({ localHost: e.target.value })}
                placeholder="127.0.0.1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="local-port">Local Port</Label>
              <Input
                id="local-port"
                type="number"
                value={form.localPort}
                onChange={e => onChange({ localPort: e.target.value })}
                placeholder="8080"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="remote-host">
                {form.type === 'local' ? 'Remote Host' : 'Target Host'}
              </Label>
              <Input
                id="remote-host"
                value={form.remoteHost}
                onChange={e => onChange({ remoteHost: e.target.value })}
                placeholder={form.type === 'local' ? 'localhost' : '0.0.0.0'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="remote-port">
                {form.type === 'local' ? 'Remote Port' : 'Target Port'}
              </Label>
              <Input
                id="remote-port"
                type="number"
                value={form.remotePort}
                onChange={e => onChange({ remotePort: e.target.value })}
                placeholder="3306"
              />
            </div>
          </div>
        </>
      )}

      {isDynamic && (
        <div className="space-y-2">
          <Label htmlFor="dynamic-port">Local Port (SOCKS)</Label>
          <Input
            id="dynamic-port"
            type="number"
            value={form.localPort}
            onChange={e => onChange({ localPort: e.target.value })}
            placeholder="1080"
          />
          <p className="text-xs text-muted-foreground">
            Configure your application to use this SOCKS proxy
          </p>
        </div>
      )}
    </div>
  )
}
