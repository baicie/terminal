import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Computer,
  Home,
  RefreshCw,
  Server,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface FilePaneNavigationProps {
  type: 'local' | 'remote'
  currentPath: string
  pathHistoryLength: number
  pathHistoryIndex: number
  loading: boolean
  filter: string
  onFilterChange: (filter: string) => void
  onNavigate: (path: string) => void
  onBack: () => void
  onForward: () => void
  onRefresh: () => void
}

export function FilePaneNavigation({
  type,
  currentPath,
  pathHistoryLength,
  pathHistoryIndex,
  loading,
  filter,
  onFilterChange,
  onNavigate,
  onBack,
  onForward,
  onRefresh,
}: FilePaneNavigationProps) {
  const pathParts = currentPath.split('/').filter(Boolean)

  return (
    <>
      <div className="shrink-0 px-3 py-2 bg-secondary/40 border-b border-border/50 flex items-center gap-2">
        <div className="flex items-center gap-1 text-sm font-medium">
          {type === 'local' ? (
            <Computer className="size-4" />
          ) : (
            <Server className="size-4" />
          )}
          <span>{type === 'local' ? 'Local' : 'Remote'}</span>
        </div>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onBack}
          disabled={pathHistoryIndex <= 0}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onForward}
          disabled={pathHistoryIndex >= pathHistoryLength - 1}
        >
          <ArrowRight className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onRefresh}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      <div className="shrink-0 px-3 py-1.5 flex items-center gap-1 text-xs border-b border-border/50 overflow-x-auto">
        <button
          className="hover:text-primary shrink-0"
          onClick={() => onNavigate(type === 'remote' ? '/' : '')}
        >
          <Home className="size-3.5" />
        </button>
        {pathParts.map((part, index) => (
          <span key={index} className="flex items-center gap-1 shrink-0">
            <ChevronRight className="size-3 text-muted-foreground" />
            <button
              className="hover:text-primary"
              onClick={() =>
                onNavigate(`/${pathParts.slice(0, index + 1).join('/')}`)
              }
            >
              {part}
            </button>
          </span>
        ))}
        {type === 'remote' && (
          <Input
            className="h-5 text-xs ml-2 flex-1 min-w-0 max-w-[200px]"
            value={filter}
            onChange={e => onFilterChange(e.target.value)}
            placeholder="Filter..."
          />
        )}
      </div>

      {type === 'local' && (
        <div className="shrink-0 px-3 py-1 border-b border-border/50">
          <Input
            className="h-6 text-xs"
            value={filter}
            onChange={e => onFilterChange(e.target.value)}
            placeholder="Filter files..."
          />
        </div>
      )}
    </>
  )
}
