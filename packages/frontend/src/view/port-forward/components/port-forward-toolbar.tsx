import { Plus, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ViewToolbar } from '@/components/view-container'

interface PortForwardToolbarProps {
  searchQuery: string
  loading: boolean
  onSearchChange: (query: string) => void
  onRefresh: () => void
  onAdd: () => void
}

export function PortForwardToolbar({
  searchQuery,
  loading,
  onSearchChange,
  onRefresh,
  onAdd,
}: PortForwardToolbarProps) {
  return (
    <ViewToolbar className="gap-2 sm:gap-4">
      <div className="relative min-w-0 flex-1 sm:max-w-sm">
        <Search className="absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search forwards..."
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          className="pl-8 sm:pl-9 h-8 sm:h-9 text-xs sm:text-sm"
        />
      </div>

      <div className="ml-auto flex shrink-0 gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={onRefresh}
        >
          <RefreshCw
            data-icon="inline-start"
            className={loading ? 'animate-spin' : undefined}
          />
          <span className="hidden sm:inline">Refresh</span>
        </Button>

        <Button size="sm" className="h-8 text-xs gap-1" onClick={onAdd}>
          <Plus data-icon="inline-start" />
          <span className="hidden sm:inline">New Forward</span>
          <span className="sm:hidden">Add</span>
        </Button>
      </div>
    </ViewToolbar>
  )
}
