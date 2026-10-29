import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface SnippetPackageDialogProps {
  open: boolean
  onClose: () => void
  packageName: string
  onPackageNameChange: (name: string) => void
  onSubmit: () => void
}

export const SnippetPackageDialog: React.FC<SnippetPackageDialogProps> = ({
  open,
  onClose,
  packageName,
  onPackageNameChange,
  onSubmit,
}) => {
  const handleSubmit = () => {
    onSubmit()
    onPackageNameChange('')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Package</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="package-name">Package Name</Label>
            <Input
              id="package-name"
              value={packageName}
              onChange={e => onPackageNameChange(e.target.value)}
              placeholder="My Package"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleSubmit}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
