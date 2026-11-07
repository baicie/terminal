import type { FileItem } from '@/service/ssh'
import { DeleteDialog } from './delete-dialog'
import { MkdirDialog } from './mkdir-dialog'
import { RenameDialog } from './rename-dialog'

interface SftpDialogsProps {
  deleteOpen: boolean
  fileToDelete: FileItem | null
  onDeleteOpenChange: (open: boolean) => void
  onDeleteConfirm: () => void
  renameOpen: boolean
  fileToRename: FileItem | null
  onRenameOpenChange: (open: boolean) => void
  onRenameConfirm: (name: string) => void
  mkdirOpen: boolean
  onMkdirOpenChange: (open: boolean) => void
  onMkdirConfirm: (name: string) => void
}

/** The three file-operation dialogs, kept out of the pane container. */
export function SftpDialogs({
  deleteOpen,
  fileToDelete,
  onDeleteOpenChange,
  onDeleteConfirm,
  renameOpen,
  fileToRename,
  onRenameOpenChange,
  onRenameConfirm,
  mkdirOpen,
  onMkdirOpenChange,
  onMkdirConfirm,
}: SftpDialogsProps) {
  return (
    <>
      <DeleteDialog
        open={deleteOpen}
        file={fileToDelete}
        onOpenChange={onDeleteOpenChange}
        onConfirm={onDeleteConfirm}
      />
      <RenameDialog
        open={renameOpen}
        file={fileToRename}
        onOpenChange={onRenameOpenChange}
        onConfirm={onRenameConfirm}
      />
      <MkdirDialog
        open={mkdirOpen}
        onOpenChange={onMkdirOpenChange}
        onConfirm={onMkdirConfirm}
      />
    </>
  )
}
