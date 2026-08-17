import { ArrowLeft, FolderUp, Home, PanelLeft, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import WorkspaceSwitcher from '@/components/workspace-switcher'

interface MobileToolbarProps {
  currentPath: string
  drawerOpen: boolean
  onDrawerOpenChange: (open: boolean) => void
  onNavigate: (path: string) => void
  onBack: () => void
}

export function MobileToolbar({
  currentPath,
  drawerOpen,
  onDrawerOpenChange,
  onNavigate,
  onBack,
}: MobileToolbarProps) {
  const { t } = useTranslation()
  const navigationItems = [
    { label: t('nav.hosts'), icon: <Home />, path: '/hosts' },
    { label: t('toolbar.sftp'), icon: <FolderUp />, path: '/sftp' },
  ]
  const pageTitle =
    navigationItems.find(item => item.path === currentPath)?.label ??
    pageTitles[currentPath] ??
    t('nav.hosts')

  return (
    <>
      <header
        className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background px-3"
        data-tauri-drag-region
      >
        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => onDrawerOpenChange(true)}
          aria-label={t('toolbar.menu')}
          title={t('toolbar.menu')}
          data-tauri-drag-region="false"
        >
          <PanelLeft />
        </Button>
        <div
          className="min-w-0 flex-1 text-center"
          data-tauri-drag-region="false"
        >
          <span className="block truncate text-sm font-medium text-foreground">
            {pageTitle}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onBack}
          aria-label={t('common.back')}
          title={t('common.back')}
          data-tauri-drag-region="false"
        >
          <ArrowLeft />
        </Button>
      </header>

      <Sheet open={drawerOpen} onOpenChange={onDrawerOpenChange}>
        <SheetContent side="left" className="w-[280px]">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-base">{t('app.name')}</SheetTitle>
            <SheetDescription className="sr-only">
              {t('toolbar.mobileNavigationDescription')}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-1 pt-2">
            <div className="px-2 pb-2">
              <WorkspaceSwitcher />
            </div>
            {navigationItems.map(item => (
              <Button
                key={item.path}
                variant="ghost"
                className={cn(
                  'h-11 w-full justify-start gap-3 px-3 text-muted-foreground',
                  currentPath === item.path &&
                    'bg-secondary/80 font-medium text-foreground',
                )}
                onClick={() => onNavigate(item.path)}
              >
                {item.icon}
                <span>{item.label}</span>
              </Button>
            ))}
            <Separator className="my-3" />
            <Button
              variant="ghost"
              className="h-11 w-full justify-start gap-3 px-3 text-muted-foreground"
              onClick={() => onNavigate('/settings')}
            >
              <Settings />
              <span>{t('nav.settings')}</span>
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

const pageTitles: Record<string, string> = {
  '/keychain': 'Keychain',
  '/port-forward': 'Port Forward',
  '/snippets': 'Snippets',
  '/known-hosts': 'Known Hosts',
  '/logs': 'Logs',
  '/settings': 'Settings',
  '/terminal': 'Terminal',
}
