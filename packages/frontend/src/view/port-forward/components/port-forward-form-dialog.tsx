import type { Host } from '@/types'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ResponsiveDialog } from '@/components/ui/responsive-dialog'
import type { PortForwardFormState } from './port-forward-types'
import { PortForwardFormFields } from './port-forward-form-fields'

interface PortForwardFormDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  hosts: Host[]
  form: PortForwardFormState
  onChange: (patch: Partial<PortForwardFormState>) => void
  onSubmit: () => void
  onCancel: () => void
}

export const PortForwardFormDialog: React.FC<PortForwardFormDialogProps> = ({
  open,
  onOpenChange,
  hosts,
  form,
  onChange,
  onSubmit,
  onCancel,
}) => {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      header={
        <>
          <DialogTitle>New Port Forward</DialogTitle>
          <DialogDescription>
            Set up a port forwarding rule to access remote services locally
          </DialogDescription>
        </>
      }
      footer={
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onSubmit}>
            <Play className="size-4 mr-1" />
            Start Forward
          </Button>
        </div>
      }
      className="max-w-md"
      mobileHeight="85dvh"
    >
      <PortForwardFormFields hosts={hosts} form={form} onChange={onChange} />
    </ResponsiveDialog>
  )
}
