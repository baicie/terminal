import type { FileItem } from '@/service/ssh'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

interface DeleteDialogProps {
  open: boolean
  file: FileItem | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export const DeleteDialog: React.FC<DeleteDialogProps> = ({
  open,
  file,
  onOpenChange,
  onConfirm,
}) => {
  const { t } = useTranslation()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {file?.is_directory
              ? t('sftp.deleteFolderTitle')
              : t('sftp.deleteFileTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('sftp.deleteConfirm', { name: file?.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t('common.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

interface DeleteTriggerProps {
  file: FileItem | null
  onOpen: (file: FileItem) => void
  children: React.ReactNode
}

export const DeleteTrigger: React.FC<DeleteTriggerProps> = ({
  file,
  onOpen,
  children,
}) => {
  const handleClick = () => {
    if (file) onOpen(file)
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 text-xs"
      onClick={handleClick}
    >
      {children}
    </Button>
  )
}
