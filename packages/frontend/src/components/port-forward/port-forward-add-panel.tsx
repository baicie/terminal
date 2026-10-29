import { ArrowLeft, ArrowRightLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { PortForwardFormData } from './port-forward-dialog-types'

interface PortForwardAddPanelProps {
  formData: PortForwardFormData
  onChange: (update: Partial<PortForwardFormData>) => void
  onCancel: () => void
  onAdd: () => void
}

export function PortForwardAddPanel({
  formData,
  onChange,
  onCancel,
  onAdd,
}: PortForwardAddPanelProps) {
  return (
    <>
      <div className="flex flex-col gap-4 overflow-y-auto">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mb-1 -ml-2 w-fit gap-1 px-2"
          onClick={onCancel}
        >
          <ArrowLeft data-icon="inline-start" />
          Back to list
        </Button>

        <div>
          <Label htmlFor="forward-name">Name</Label>
          <Input
            id="forward-name"
            value={formData.name}
            onChange={event => onChange({ name: event.target.value })}
            placeholder="My Forward"
          />
        </div>

        <div>
          <Label htmlFor="forward-type">Type</Label>
          <Select
            value={formData.type}
            onValueChange={type =>
              onChange({ type: type as PortForwardFormData['type'] })
            }
          >
            <SelectTrigger id="forward-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">Local Port Forward (-L)</SelectItem>
              <SelectItem value="remote">Remote Port Forward (-R)</SelectItem>
              <SelectItem value="dynamic">Dynamic Port Forward (-D)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {formData.type === 'dynamic' ? (
          <DynamicForwardFields formData={formData} onChange={onChange} />
        ) : (
          <TcpForwardFields formData={formData} onChange={onChange} />
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={onAdd}>
          Add
        </Button>
      </DialogFooter>
    </>
  )
}

type ForwardFieldsProps = Pick<
  PortForwardAddPanelProps,
  'formData' | 'onChange'
>

function DynamicForwardFields({ formData, onChange }: ForwardFieldsProps) {
  return (
    <div>
      <Label>SOCKS Proxy</Label>
      <div className="mt-1 flex items-center gap-2">
        <Input
          value={formData.localHost}
          onChange={event => onChange({ localHost: event.target.value })}
          placeholder="localhost"
          className="font-mono"
        />
        <span>:</span>
        <Input
          type="number"
          value={formData.localPort}
          onChange={event => onChange({ localPort: event.target.value })}
          placeholder="1080"
          className="font-mono"
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Creates a SOCKS proxy at {formData.localHost}:
        {formData.localPort || '1080'}
      </p>
    </div>
  )
}

function TcpForwardFields({ formData, onChange }: ForwardFieldsProps) {
  return (
    <>
      <HostPortFields
        label="Local"
        host={formData.localHost}
        port={formData.localPort}
        onHostChange={localHost => onChange({ localHost })}
        onPortChange={localPort => onChange({ localPort })}
      />
      <div className="flex justify-center">
        <ArrowRightLeft className="size-5 text-muted-foreground" />
      </div>
      <HostPortFields
        label="Remote"
        host={formData.remoteHost}
        port={formData.remotePort}
        onHostChange={remoteHost => onChange({ remoteHost })}
        onPortChange={remotePort => onChange({ remotePort })}
      />
    </>
  )
}

interface HostPortFieldsProps {
  label: string
  host: string
  port: string
  onHostChange: (host: string) => void
  onPortChange: (port: string) => void
}

function HostPortFields({
  label,
  host,
  port,
  onHostChange,
  onPortChange,
}: HostPortFieldsProps) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 flex items-center gap-2">
        <Input
          value={host}
          onChange={event => onHostChange(event.target.value)}
          placeholder="localhost"
          className="font-mono"
        />
        <span>:</span>
        <Input
          type="number"
          value={port}
          onChange={event => onPortChange(event.target.value)}
          placeholder="Port"
          className="font-mono"
        />
      </div>
    </div>
  )
}
