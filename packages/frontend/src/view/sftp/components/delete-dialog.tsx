import type { FileItem } from '@/service/ssh'
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
}) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          Delete {file?.is_directory ? 'Folder' : 'File'}
        </AlertDialogTitle>
        <AlertDialogDescription>
          Are you sure you want to delete &quot;{file?.name}&quot;? This action cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          onClick={onConfirm}
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >
          Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)

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
