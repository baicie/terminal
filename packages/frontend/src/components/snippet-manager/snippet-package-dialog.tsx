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
  const { t } = useTranslation()
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
          <DialogTitle>{t('snippets.createPackage')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="package-name">{t('snippets.packageName')}</Label>
            <Input
              id="package-name"
              value={packageName}
              onChange={e => onPackageNameChange(e.target.value)}
              placeholder={t('snippets.myPackage')}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleSubmit}>
            {t('snippets.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
