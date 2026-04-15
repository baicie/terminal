import type { PortForward, PortForwardType } from '@/types'
import {
  ArrowLeft,
  ArrowRightLeft,
  Network,
  Pause,
  Play,
  Plus,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface PortForwardDialogProps {
  open: boolean
  onClose: () => void
  portForwards: PortForward[]
  onSave: (portForwards: PortForward[]) => void
}

type Panel = 'list' | 'add'

const PortForwardDialog: React.FC<PortForwardDialogProps> = ({
  open,
  onClose,
  portForwards: initialForwards,
  onSave,
}) => {
  const [portForwards, setPortForwards] = useState<PortForward[]>([])
  const [panel, setPanel] = useState<Panel>('list')

  const [formData, setFormData] = useState({
    name: '',
    type: 'local' as PortForwardType,
    localPort: '',
    localHost: 'localhost',
    remotePort: '',
    remoteHost: 'localhost',
  })

  useEffect(() => {
    if (open) {
      setPortForwards(initialForwards || [])
      setPanel('list')
    }
  }, [initialForwards, open])

  const handleAdd = () => {
    const newForward: PortForward = {
      id: `pf-${Date.now()}`,
      name: formData.name || `${formData.type} forward`,
      type: formData.type,
      localPort: Number.parseInt(formData.localPort) || 0,
      localHost: formData.localHost || 'localhost',
      remotePort: Number.parseInt(formData.remotePort) || 0,
      remoteHost: formData.remoteHost || 'localhost',
      active: false,
    }
    setPortForwards([...portForwards, newForward])
    setPanel('list')
    resetForm()
  }

  const handleDelete = (id: string) => {
    setPortForwards(portForwards.filter(f => f.id !== id))
  }

  const handleToggleActive = (id: string) => {
    setPortForwards(
      portForwards.map(f => (f.id === id ? { ...f, active: !f.active } : f)),
    )
  }

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'local',
      localPort: '',
      localHost: 'localhost',
      remotePort: '',
      remoteHost: 'localhost',
    })
  }

  const handleSave = () => {
    onSave(portForwards)
    onClose()
  }

  const leaveAddPanel = () => {
    setPanel('list')
    resetForm()
  }

  const getTypeLabel = (type: PortForwardType) => {
    switch (type) {
      case 'local':
        return 'Local (-L)'
      case 'remote':
        return 'Remote (-R)'
      case 'dynamic':
        return 'Dynamic (-D)'
      default:
        return type
    }
  }

  const getForwardDescription = (forward: PortForward) => {
    switch (forward.type) {
      case 'local':
        return `${forward.localHost}:${forward.localPort} → ${forward.remoteHost}:${forward.remotePort}`
      case 'remote':
        return `${forward.remoteHost}:${forward.remotePort} → ${forward.localHost}:${forward.localPort}`
      case 'dynamic':
        return `${forward.localHost}:${forward.localPort} (SOCKS)`
      default:
        return ''
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) {
          leaveAddPanel()
          onClose()
        }
      }}
    >
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="size-5" />
            {panel === 'list' ? 'Port Forwards' : 'Add Port Forward'}
          </DialogTitle>
        </DialogHeader>

        {panel === 'list' ? (
          <>
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {portForwards.length} forward
                {portForwards.length !== 1 ? 's' : ''} configured
              </span>
              <Button type="button" onClick={() => setPanel('add')}>
                <Plus className="mr-1 size-4" />
                Add Forward
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {portForwards.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  No port forwards configured
                </div>
              ) : (
                <div className="space-y-2">
                  {portForwards.map(forward => (
                    <div
                      key={forward.id}
                      className={`flex items-center justify-between rounded-lg border p-3 ${
                        forward.active ? 'bg-accent/50' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{forward.name}</span>
                          <span className="rounded bg-muted px-2 py-0.5 text-xs">
                            {getTypeLabel(forward.type)}
                          </span>
                        </div>
                        <div className="mt-1 font-mono text-sm text-muted-foreground">
                          {getForwardDescription(forward)}
                        </div>
                      </div>
                      <div className="ml-2 flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          type="button"
                          onClick={() => handleToggleActive(forward.id)}
                          title={forward.active ? 'Stop' : 'Start'}
                        >
                          {forward.active ? (
                            <Pause className="size-4" />
                          ) : (
                            <Play className="size-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          type="button"
                          onClick={() => handleDelete(forward.id)}
                          title="Delete"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSave}>
                Save
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4 overflow-y-auto">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mb-1 -ml-2 w-fit gap-1 px-2"
                onClick={leaveAddPanel}
              >
                <ArrowLeft className="size-4" />
                Back to list
              </Button>
              <div>
                <Label htmlFor="forward-name">Name</Label>
                <Input
                  id="forward-name"
                  value={formData.name}
                  onChange={e =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="My Forward"
                />
              </div>

              <div>
                <Label htmlFor="forward-type">Type</Label>
                <Select
                  value={formData.type}
                  onValueChange={v =>
                    setFormData({ ...formData, type: v as PortForwardType })
                  }
                >
                  <SelectTrigger id="forward-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">
                      Local Port Forward (-L)
                    </SelectItem>
                    <SelectItem value="remote">
                      Remote Port Forward (-R)
                    </SelectItem>
                    <SelectItem value="dynamic">
                      Dynamic Port Forward (-D)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formData.type === 'dynamic' ? (
                <div>
                  <Label>SOCKS Proxy</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <Input
                      value={formData.localHost}
                      onChange={e =>
                        setFormData({ ...formData, localHost: e.target.value })
                      }
                      placeholder="localhost"
                      className="font-mono"
                    />
                    <span>:</span>
                    <Input
                      type="number"
                      value={formData.localPort}
                      onChange={e =>
                        setFormData({ ...formData, localPort: e.target.value })
                      }
                      placeholder="1080"
                      className="font-mono"
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Creates a SOCKS proxy at {formData.localHost}:
                    {formData.localPort || '1080'}
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <Label>Local</Label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input
                        value={formData.localHost}
                        onChange={e =>
                          setFormData({
                            ...formData,
                            localHost: e.target.value,
                          })
                        }
                        placeholder="localhost"
                        className="font-mono"
                      />
                      <span>:</span>
                      <Input
                        type="number"
                        value={formData.localPort}
                        onChange={e =>
                          setFormData({
                            ...formData,
                            localPort: e.target.value,
                          })
                        }
                        placeholder="Port"
                        className="font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex justify-center">
                    <ArrowRightLeft className="size-5 text-muted-foreground" />
                  </div>

                  <div>
                    <Label>Remote</Label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input
                        value={formData.remoteHost}
                        onChange={e =>
                          setFormData({
                            ...formData,
                            remoteHost: e.target.value,
                          })
                        }
                        placeholder="localhost"
                        className="font-mono"
                      />
                      <span>:</span>
                      <Input
                        type="number"
                        value={formData.remotePort}
                        onChange={e =>
                          setFormData({
                            ...formData,
                            remotePort: e.target.value,
                          })
                        }
                        placeholder="Port"
                        className="font-mono"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={leaveAddPanel}>
                Cancel
              </Button>
              <Button type="button" onClick={handleAdd}>
                Add
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default PortForwardDialog
