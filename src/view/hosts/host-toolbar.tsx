import type { Host } from '@/types'
import {
  CalendarDays,
  ChevronDown,
  LayoutGrid,
  List,
  Server,
  Tag,
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

interface HostToolbarProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  gridView: boolean
  onGridViewChange: (gridView: boolean) => void
  onConnect: () => void
  onNewHost: () => void
  onNewTerminal: () => void
  onSerialConnection: () => void
}

export const HostToolbar: React.FC<HostToolbarProps> = ({
  searchQuery,
  onSearchChange,
  gridView,
  onGridViewChange,
  onConnect,
  onNewHost,
  onNewTerminal,
  onSerialConnection,
}) => {
  const { t } = useTranslation()

  return (
    <div className="shrink-0 border-b border-border/60 bg-background px-4 py-3 flex flex-col gap-3 slide-in-from-top fade-in">
      <div className="flex items-stretch gap-2 w-full">
        <Input
          placeholder={t('hosts.search')}
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          className="h-10 flex-1 rounded-lg bg-secondary/40 border-border/60"
        />
        <Button className="h-10 px-6 shrink-0 rounded-lg" onClick={onConnect}>
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
            <DropdownMenuItem onClick={onNewHost}>
              <Server className="size-4" data-icon="inline-start" />
              {t('hosts.sshHost')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled>{t('hosts.importFromFile')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" size="sm" className="h-9 rounded-md" onClick={onNewTerminal}>
          <Terminal className="size-4" data-icon="inline-start" />
          {t('hosts.terminal')}
        </Button>

        <Button variant="outline" size="sm" className="h-9 rounded-md" onClick={onSerialConnection}>
          <Usb className="size-4" data-icon="inline-start" />
          {t('hosts.serial')}
        </Button>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost" size="icon"
            className={cn('size-9 rounded-md', gridView && 'bg-secondary/80')}
            title={t('hosts.grid')} onClick={() => onGridViewChange(true)}>
            <LayoutGrid className="size-4" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className={cn('size-9 rounded-md', !gridView && 'bg-secondary/80')}
            title={t('hosts.list')} onClick={() => onGridViewChange(false)}>
            <List className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-9 rounded-md" title={t('hosts.tags')}>
            <Tag className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-9 rounded-md" title={t('hosts.calendar')}>
            <CalendarDays className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
