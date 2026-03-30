import type { SnippetPackageRecord } from '@/service/database'
import { FolderPlus, Trash2 } from 'lucide-react'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

interface PackageSidebarProps {
  packages: SnippetPackageRecord[]
  selectedPackage: string | null
  onSelectPackage: (id: string | null) => void
  onCreatePackage: () => void
  onDeletePackage: (id: string) => void
}

export const PackageSidebar: React.FC<PackageSidebarProps> = ({
  packages,
  selectedPackage,
  onSelectPackage,
  onCreatePackage,
  onDeletePackage,
}) => {
  const { t } = useTranslation()

  return (
    <div className="w-full shrink-0 border-border bg-muted/30 p-3 sm:p-4 md:w-48 md:border-r md:border-b-0 border-b">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{t('snippets.packages')}</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={onCreatePackage}
          title={t('snippets.newPackage')}
        >
          <FolderPlus className="size-4" />
        </Button>
      </div>
      <div className="max-h-40 space-y-1 overflow-y-auto md:max-h-none">
        <Button
          variant="ghost"
          className={`h-auto w-full justify-start px-2 py-1.5 text-sm ${
            selectedPackage === null
              ? 'bg-secondary'
              : 'hover:bg-secondary/60'
          }`}
          onClick={() => onSelectPackage(null)}
        >
          {t('snippets.allSnippets')}
        </Button>
        {packages.map(pkg => (
          <div
            key={pkg.id}
            className={`group flex items-center justify-between w-full text-left px-2 py-1 rounded text-sm ${
              selectedPackage === pkg.id
                ? 'bg-secondary'
                : 'hover:bg-secondary/60'
            }`}
          >
            <Button
              variant="ghost"
              className="flex-1 justify-start truncate px-0"
              onClick={() => onSelectPackage(pkg.id)}
            >
              {pkg.name}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5 opacity-0 group-hover:opacity-100"
                  onClick={e => e.stopPropagation()}
                >
                  <Trash2 className="size-3" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('snippets.deletePackage')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('snippets.deletePackageConfirm', { name: pkg.name })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDeletePackage(pkg.id)}>
                    {t('common.delete')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ))}
      </div>
    </div>
  )
}
