import type { Host } from '@/types'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  return (
    <div className="p-4 border-t flex justify-between">
      <div>
        {host && (
          <AlertDialog
            open={deleteDialogOpen}
            onOpenChange={onDeleteDialogOpenChange}
          >
            <AlertDialogTrigger asChild>
              <Button variant="destructive">{t('common.delete')}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('hosts.form.deleteHost')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('hosts.form.deleteConfirm', { name: host.name })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>{t('common.delete')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button onClick={onSubmit} disabled={saving}>
          {saving ? t('hosts.form.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  )
}
