import type { SnippetPackageRecord, SnippetRecord } from '@/service/database'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('snippets.editSnippet') : t('snippets.createSnippet')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="snippet-name">{t('common.name')}</Label>
            <Input
              id="snippet-name"
              value={isEdit && snippet ? snippet.name : formData.name}
              onChange={e =>
                onFormChange({ name: e.target.value })
              }
              placeholder={t('snippets.namePlaceholder')}
            />
          </div>

          <div>
            <Label htmlFor="snippet-description">
              {t('common.description')}
            </Label>
            <Input
              id="snippet-description"
              value={isEdit && snippet ? snippet.description || '' : formData.description}
              onChange={e =>
                onFormChange({ description: e.target.value })
              }
              placeholder={t('snippets.optionalDesc')}
            />
          </div>

          <div>
            <Label htmlFor="snippet-script">{t('snippets.script')}</Label>
            <textarea
              id="snippet-script"
              value={isEdit && snippet ? snippet.script : formData.script}
              onChange={e =>
                onFormChange({ script: e.target.value })
              }
              placeholder={t('snippets.helloWorld')}
              className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
            />
          </div>

          <div>
            <Label htmlFor="snippet-package">
              {t('snippets.packageLabel')}
            </Label>
            <Select
              value={isEdit && snippet ? snippet.package_id || '' : formData.packageId}
              onValueChange={v => onFormChange({ packageId: v })}
            >
              <SelectTrigger id="snippet-package">
                <SelectValue placeholder={t('snippets.noPackage')} />
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
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleSubmit}>
            {isEdit ? t('common.save') : t('snippets.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
