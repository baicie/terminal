import type { PortForward } from '@/types'
import { Pause, Play, Plus, Trash2 } from 'lucide-react'
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
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {portForwards.length} forward
          {portForwards.length !== 1 ? 's' : ''} configured
        </span>
        <Button type="button" onClick={onAdd}>
          <Plus data-icon="inline-start" />
          Add Forward
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {portForwards.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            No port forwards configured
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
                    title={forward.active ? 'Stop' : 'Start'}
                  >
                    {forward.active ? <Pause /> : <Play />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    onClick={() => onDelete(forward.id)}
                    title="Delete"
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
          Cancel
        </Button>
        <Button type="button" onClick={onSave}>
          Save
        </Button>
      </DialogFooter>
    </>
  )
}
