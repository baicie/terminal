import { LayoutGrid, List, Plus, Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface HostsMobileToolbarProps {
  searchQuery: string
  onSearchChange: (q: string) => void
  onConnectBarSubmit: (q: string) => void
  onOpenMobileSheet: () => void
  gridView: boolean
  onGridViewChange: (grid: boolean) => void
}

/** 移动端 Hosts 视图工具栏 */
export const HostsMobileToolbar: React.FC<HostsMobileToolbarProps> = ({
  searchQuery,
  onSearchChange,
  onConnectBarSubmit,
  onOpenMobileSheet,
  gridView,
  onGridViewChange,
}) => {
  const { t } = useTranslation()

  return (
    <div className="shrink-0 border-b border-border/60 bg-background px-3 py-2.5 flex flex-col gap-2">
      <Input
        placeholder={t('hosts.search')}
        value={searchQuery}
        onChange={e => onSearchChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') onConnectBarSubmit(searchQuery)
        }}
        className="h-10 w-full rounded-lg bg-secondary/40 border-border/60"
      />
      <div className="flex items-center gap-2 overflow-x-auto">
        <Button
          variant="secondary"
          size="sm"
          className="gap-1 shrink-0 h-8 text-xs"
          onClick={onOpenMobileSheet}
        >
          <Plus className="size-3.5" data-icon="inline-start" />
          {t('common.new')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1 shrink-0 h-8 text-xs"
          onClick={() => {
            const q = searchQuery.trim()
            if (q) onConnectBarSubmit(q)
          }}
        >
          <Terminal className="size-3.5" data-icon="inline-start" />
          {t('hosts.connect')}
        </Button>
        <div className="flex items-center gap-0.5 ml-auto shrink-0 rounded-md bg-secondary/40 p-0.5">
          <Button
            variant="ghost"
            size="icon"
            className={cn('size-7 rounded', gridView && 'bg-background shadow-sm')}
            onClick={() => onGridViewChange(true)}
          >
            <LayoutGrid className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn('size-7 rounded', !gridView && 'bg-background shadow-sm')}
            onClick={() => onGridViewChange(false)}
          >
            <List className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
