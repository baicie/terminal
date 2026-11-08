import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileItem } from '@/service/ssh'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface RenameDialogProps {
  open: boolean
  file: FileItem | null
  onOpenChange: (open: boolean) => void
  onConfirm: (newName: string) => void
}

export const RenameDialog: React.FC<RenameDialogProps> = ({
  open,
  file,
  onOpenChange,
  onConfirm,
}) => {
  const { t } = useTranslation()
  const initial = file?.name.split('/').pop() || ''
  const [value, setValue] = useState(initial)

  // Reset value when dialog opens with new file
  useEffect(() => {
    if (open) setValue(file?.name.split('/').pop() || '')
  }, [open, file])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('sftp.renameTitle')}</DialogTitle>
          <DialogDescription>
            {t('sftp.renameDescription')}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && value.trim()) onConfirm(value.trim())
          }}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => value.trim() && onConfirm(value.trim())} disabled={!value.trim()}>
            {t('sftp.rename')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
