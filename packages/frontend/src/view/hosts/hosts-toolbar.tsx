import {
  ChevronDown,
  LayoutGrid,
  List,
  Server,
  Terminal,
  Usb,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface HostsToolbarProps {
  searchQuery: string
  onSearchChange: (q: string) => void
  onConnectBarSubmit: (q: string) => void
  onOpenHostDialog: () => void
  onNewLocalTerminal: () => void
  onOpenSerialDialog: () => void
  gridView: boolean
  onGridViewChange: (grid: boolean) => void
}

/** 桌面端 Hosts 视图工具栏 */
export const HostsToolbar: React.FC<HostsToolbarProps> = ({
  searchQuery,
  onSearchChange,
  onConnectBarSubmit,
  onOpenHostDialog,
  onNewLocalTerminal,
  onOpenSerialDialog,
  gridView,
  onGridViewChange,
}) => {
  const { t } = useTranslation()

  return (
    <div className="shrink-0 border-b border-border/60 bg-background px-4 py-3 flex flex-col gap-3 slide-in-from-top fade-in">
      <div className="flex items-stretch gap-2 w-full">
        <Input
          placeholder={t('hosts.search')}
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onConnectBarSubmit(searchQuery)
          }}
          className="h-10 flex-1 rounded-lg bg-secondary/40 border-border/60"
        />
        <Button
          className="h-10 px-6 shrink-0 rounded-lg"
          onClick={() => onConnectBarSubmit(searchQuery)}
        >
          {t('hosts.connect')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" className="gap-1 rounded-md h-9">
              {t('hosts.newHost')}
              <ChevronDown className="size-4 opacity-70" data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={onOpenHostDialog}>
              <Server className="size-4" data-icon="inline-start" />
              {t('hosts.sshHost')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onNewLocalTerminal}>
              <Terminal className="size-4" data-icon="inline-start" />
              {t('hosts.terminal')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenSerialDialog}>
              <Usb className="size-4" data-icon="inline-start" />
              {t('hosts.serial')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled>{t('hosts.importFromFile')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5 rounded-md bg-secondary/40 p-0.5">
          <Button
            variant="ghost"
            size="icon"
            className={cn('size-8 rounded', gridView && 'bg-background shadow-sm')}
            title={t('hosts.grid')}
            onClick={() => onGridViewChange(true)}
          >
            <LayoutGrid className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn('size-8 rounded', !gridView && 'bg-background shadow-sm')}
            title={t('hosts.list')}
            onClick={() => onGridViewChange(false)}
          >
            <List className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
