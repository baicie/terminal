import type { PortForward } from '@/types'
import { Pause, Play, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  getPortForwardDescription,
  getPortForwardTypeLabel,
} from './port-forward-dialog-types'

interface PortForwardListPanelProps {
  portForwards: PortForward[]
  onAdd: () => void
  onDelete: (id: string) => void
  onToggleActive: (id: string) => void
  onCancel: () => void
  onSave: () => void
}

export function PortForwardListPanel({
  portForwards,
  onAdd,
  onDelete,
  onToggleActive,
  onCancel,
  onSave,
}: PortForwardListPanelProps) {
  const { t } = useTranslation()
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {t('portForward.configured', { count: portForwards.length })}
        </span>
        <Button type="button" onClick={onAdd}>
          <Plus data-icon="inline-start" />
          {t('portForward.addForward')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {portForwards.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            {t('portForward.noConfigured')}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {portForwards.map(forward => (
              <div
                key={forward.id}
                className={cn(
                  'flex items-center justify-between rounded-lg border p-3',
                  forward.active && 'bg-accent/50',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{forward.name}</span>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">
                      {getPortForwardTypeLabel(forward.type)}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-sm text-muted-foreground">
                    {getPortForwardDescription(forward)}
                  </div>
                </div>
                <div className="ml-2 flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    onClick={() => onToggleActive(forward.id)}
                    title={forward.active
                      ? t('portForward.stop')
                      : t('portForward.start')}
                  >
                    {forward.active ? <Pause /> : <Play />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    onClick={() => onDelete(forward.id)}
                    title={t('common.delete')}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="button" onClick={onSave}>
          {t('common.save')}
        </Button>
      </DialogFooter>
    </>
  )
}
