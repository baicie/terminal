import type { Workspace } from '@/types'
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
import { useTranslation } from 'react-i18next'

interface WorkspaceDeleteDialogProps {
  workspace: Workspace | null
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function WorkspaceDeleteDialog({
  workspace,
  busy,
  onConfirm,
  onCancel,
}: WorkspaceDeleteDialogProps) {
  const { t } = useTranslation()
  if (!workspace) return null

  return (
    <AlertDialog
      open
      onOpenChange={next => {
        if (!next && !busy) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('workspace.delete')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('workspace.deleteConfirm', { name: workspace.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t('common.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={event => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {t('common.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
