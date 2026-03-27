import type { SnippetPackageRecord } from '@/service/database'
import { FolderPlus, Trash2 } from 'lucide-react'
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
  return (
    <div className="w-48 border-r pr-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-sm">Packages</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onCreatePackage}
        >
          <FolderPlus className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-1">
        <Button
          variant="ghost"
          className={`w-full justify-start px-2 py-1 h-auto text-sm ${
            selectedPackage === null
              ? 'bg-secondary'
              : 'hover:bg-secondary/60'
          }`}
          onClick={() => onSelectPackage(null)}
        >
          All Snippets
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
                  <AlertDialogTitle>Delete Package</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete "{pkg.name}
                    "? All snippets in this package will be moved to
                    uncategorized.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDeletePackage(pkg.id)}>
                    Delete
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
