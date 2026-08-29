import type { PortForward } from '@/types'
import { Network } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PortForwardAddPanel } from './port-forward-add-panel'
import {
  createEmptyPortForwardForm,
  type PortForwardFormData,
} from './port-forward-dialog-types'
import { PortForwardListPanel } from './port-forward-list-panel'

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
  const [formData, setFormData] = useState(createEmptyPortForwardForm)

  useEffect(() => {
    if (open) {
      setPortForwards(initialForwards || [])
      setPanel('list')
    }
  }, [initialForwards, open])

  const resetForm = () => {
    setFormData(createEmptyPortForwardForm())
  }

  const leaveAddPanel = () => {
    setPanel('list')
    resetForm()
  }

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
    leaveAddPanel()
  }

  const updateFormData = (update: Partial<PortForwardFormData>) => {
    setFormData(current => ({ ...current, ...update }))
  }

  const handleSave = () => {
    onSave(portForwards)
    onClose()
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
          <PortForwardListPanel
            portForwards={portForwards}
            onAdd={() => setPanel('add')}
            onDelete={id =>
              setPortForwards(current =>
                current.filter(forward => forward.id !== id),
              )
            }
            onToggleActive={id =>
              setPortForwards(current =>
                current.map(forward =>
                  forward.id === id
                    ? { ...forward, active: !forward.active }
                    : forward,
                ),
              )
            }
            onCancel={onClose}
            onSave={handleSave}
          />
        ) : (
          <PortForwardAddPanel
            formData={formData}
            onChange={updateFormData}
            onCancel={leaveAddPanel}
            onAdd={handleAdd}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

export default PortForwardDialog
