import type { SnippetPackageRecord, SnippetRecord } from '@/service/database'
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

interface SnippetFormDialogProps {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  snippet?: SnippetRecord | null
  packages: SnippetPackageRecord[]
  formData: {
    name: string
    description: string
    script: string
    packageId: string
  }
  onFormChange: (data: Partial<SnippetFormDialogProps['formData']>) => void
  onSubmit: () => void
}

export const SnippetFormDialog: React.FC<SnippetFormDialogProps> = ({
  open,
  onClose,
  mode,
  snippet,
  packages,
  formData,
  onFormChange,
  onSubmit,
}) => {
  const isEdit = mode === 'edit'

  const handleSubmit = () => {
    onSubmit()
    if (!isEdit) {
      onFormChange({
        name: '',
        description: '',
        script: '',
        packageId: '',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Snippet' : 'Create Snippet'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="snippet-name">Name</Label>
            <Input
              id="snippet-name"
              value={isEdit && snippet ? snippet.name : formData.name}
              onChange={e =>
                onFormChange({ name: e.target.value })
              }
              placeholder="My Snippet"
            />
          </div>

          <div>
            <Label htmlFor="snippet-description">Description</Label>
            <Input
              id="snippet-description"
              value={isEdit && snippet ? snippet.description || '' : formData.description}
              onChange={e =>
                onFormChange({ description: e.target.value })
              }
              placeholder="Optional description"
            />
          </div>

          <div>
            <Label htmlFor="snippet-script">Script</Label>
            <textarea
              id="snippet-script"
              value={isEdit && snippet ? snippet.script : formData.script}
              onChange={e =>
                onFormChange({ script: e.target.value })
              }
              placeholder="echo 'Hello World'"
              className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
            />
          </div>

          <div>
            <Label htmlFor="snippet-package">Package</Label>
            <Select
              value={isEdit && snippet ? snippet.package_id || '' : formData.packageId}
              onValueChange={v => onFormChange({ packageId: v })}
            >
              <SelectTrigger id="snippet-package">
                <SelectValue placeholder="No Package" />
              </SelectTrigger>
              <SelectContent>
                {packages.map(pkg => (
                  <SelectItem key={pkg.id} value={pkg.id}>
                    {pkg.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            {isEdit ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
