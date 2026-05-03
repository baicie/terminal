import { useEffect, useState } from 'react'
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

interface MkdirDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (name: string) => void
}

export const MkdirDialog: React.FC<MkdirDialogProps> = ({
  open,
  onOpenChange,
  onConfirm,
}) => {
  const [value, setValue] = useState('')

  useEffect(() => {
    if (!open) setValue('')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New Folder</DialogTitle>
          <DialogDescription>
            Enter the name for the new folder
          </DialogDescription>
        </DialogHeader>
        <Input
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="folder-name"
          onKeyDown={e => {
            if (e.key === 'Enter' && value.trim()) onConfirm(value.trim())
          }}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => value.trim() && onConfirm(value.trim())} disabled={!value.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
