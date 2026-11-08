import { ArrowLeft, ArrowRightLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
          {t('portForward.backToList')}
        </Button>

        <div>
          <Label htmlFor="forward-name">{t('portForward.name')}</Label>
          <Input
            id="forward-name"
            value={formData.name}
            onChange={event => onChange({ name: event.target.value })}
            placeholder={t('portForward.myForward')}
          />
        </div>

        <div>
          <Label htmlFor="forward-type">{t('portForward.type')}</Label>
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
              <SelectItem value="local">{t('portForward.localForward')}</SelectItem>
              <SelectItem value="remote">{t('portForward.remoteForward')}</SelectItem>
              <SelectItem value="dynamic">{t('portForward.dynamicForward')}</SelectItem>
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
          {t('common.cancel')}
        </Button>
        <Button type="button" onClick={onAdd}>
          {t('common.add')}
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
  const { t } = useTranslation()
  return (
    <div>
      <Label>{t('portForward.socksProxy')}</Label>
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
        {t('portForward.socksDesc', {
          host: formData.localHost,
          port: formData.localPort || '1080',
        })}
      </p>
    </div>
  )
}

function TcpForwardFields({ formData, onChange }: ForwardFieldsProps) {
  const { t } = useTranslation()
  return (
    <>
      <HostPortFields
        label={t('portForward.local')}
        host={formData.localHost}
        port={formData.localPort}
        onHostChange={localHost => onChange({ localHost })}
        onPortChange={localPort => onChange({ localPort })}
      />
      <div className="flex justify-center">
        <ArrowRightLeft className="size-5 text-muted-foreground" />
      </div>
      <HostPortFields
        label={t('portForward.remote')}
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
  const { t } = useTranslation()
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
          placeholder={t('portForward.port')}
          className="font-mono"
        />
      </div>
    </div>
  )
}
