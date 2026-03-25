import type { PortForward, PortForwardType } from '@/types'
import {
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

const PortForwardDialog: React.FC<PortForwardDialogProps> = ({
  open,
  onClose,
  portForwards: initialForwards,
  onSave,
}) => {
  const [portForwards, setPortForwards] = useState<PortForward[]>([])
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)

  const [formData, setFormData] = useState({
    name: '',
    type: 'local' as PortForwardType,
    localPort: '',
    localHost: 'localhost',
    remotePort: '',
    remoteHost: 'localhost',
  })

  useEffect(() => {
    setPortForwards(initialForwards || [])
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
    setIsAddDialogOpen(false)
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

  if (!open) return null

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Network className="h-5 w-5" />
              Port Forwards
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-muted-foreground">
              {portForwards.length} forward
              {portForwards.length !== 1 ? 's' : ''} configured
            </span>
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Forward
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {portForwards.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No port forwards configured
              </div>
            ) : (
              <div className="space-y-2">
                {portForwards.map(forward => (
                  <div
                    key={forward.id}
                    className={`border rounded-lg p-3 flex items-center justify-between ${
                      forward.active ? 'bg-accent/50' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{forward.name}</span>
                        <span className="text-xs px-2 py-0.5 bg-muted rounded">
                          {getTypeLabel(forward.type)}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground mt-1 font-mono">
                        {getForwardDescription(forward)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleActive(forward.id)}
                        title={forward.active ? 'Stop' : 'Start'}
                      >
                        {forward.active ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(forward.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Forward Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Port Forward</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
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
                  <SelectItem value="local">Local Port Forward (-L)</SelectItem>
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
                <div className="flex items-center gap-2 mt-1">
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
                <p className="text-xs text-muted-foreground mt-1">
                  Creates a SOCKS proxy at {formData.localHost}:
                  {formData.localPort || '1080'}
                </p>
              </div>
            ) : (
              <>
                <div>
                  <Label>Local</Label>
                  <div className="flex items-center gap-2 mt-1">
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
                  <ArrowRightLeft className="h-5 w-5 text-muted-foreground" />
                </div>

                <div>
                  <Label>Remote</Label>
                  <div className="flex items-center gap-2 mt-1">
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
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default PortForwardDialog
