import type { Host } from '@/types'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

interface HostFormActionsProps {
  host?: Host | null
  saving: boolean
  deleteDialogOpen: boolean
  onClose: () => void
  onDelete: () => void
  onDeleteDialogOpenChange: (open: boolean) => void
  onSubmit: () => void
}

export const HostFormActions: React.FC<HostFormActionsProps> = ({
  host,
  saving,
  deleteDialogOpen,
  onClose,
  onDelete,
  onDeleteDialogOpenChange,
  onSubmit,
}) => {
  return (
    <div className="p-4 border-t flex justify-between">
      <div>
        {host && (
          <AlertDialog
            open={deleteDialogOpen}
            onOpenChange={onDeleteDialogOpenChange}
          >
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Delete</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Host</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete "{host.name}
                  "? This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={onSubmit}
          disabled={
            saving || !onSubmit || !host?.name || !host?.hostname || !host?.username
          }
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
