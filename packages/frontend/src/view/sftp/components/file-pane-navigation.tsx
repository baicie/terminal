import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Computer,
  Home,
  RefreshCw,
  Server,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
          <span>
            {type === 'local' ? t('sftp.local') : t('sftp.remote')}
          </span>
        </div>
        <div className="flex-1" />
        {/*
          ## Why these three carry test ids and accessible names

          They were icon-only buttons with no name at all: no text, no `aria-label`, no
          `data-testid`. That is a real accessibility gap first (`<Button>` with one
          child `<ArrowLeft>` announces as "button"), and the reason `e2e-03`'s
          navigation case could not refresh a directory: the spec had to find the Home
          control by "the first svg-only button", which is a guess about document order.

          The ids are per-`type` because both panes render this component at once in the
          split layout, and a spec that refreshes "the remote pane" must not refresh the
          local one.
        */}
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          data-testid={`sftp-${type}-back`}
          aria-label={t('sftp.back')}
          onClick={onBack}
          disabled={pathHistoryIndex <= 0}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          data-testid={`sftp-${type}-forward`}
          aria-label={t('sftp.forward')}
          onClick={onForward}
          disabled={pathHistoryIndex >= pathHistoryLength - 1}
        >
          <ArrowRight className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          data-testid={`sftp-${type}-refresh`}
          aria-label={t('sftp.refresh')}
          onClick={onRefresh}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      <div className="shrink-0 px-3 py-1.5 flex items-center gap-1 text-xs border-b border-border/50 overflow-x-auto">
        {/*
          ## Home means the session's home directory, not the server's root

          This was `onNavigate(type === 'remote' ? '/' : '')`, so on a remote pane the
          Home button listed `/` — measured in `e2e-03`: `.nofollow, .vol,
          Applications, bin, cores, dev, Library, opt, private, sbin, System, Users,
          usr, Volumes, …`. A user pressing Home in a file browser expects their own
          directory; listing the whole filesystem instead is both surprising and, on a
          shared server, a way to browse paths they were not looking for.

          `.` is what the pane opens at and what `resolveListingPath` turns into the
          server's answer for "where this user starts" (`sftp_list` resolves it, the
          same round trip the first load uses). Passing `.` reuses that path rather than
          inventing a second notion of home.
        */}
        <button
          className="hover:text-primary shrink-0"
          data-testid={`sftp-${type}-home`}
          aria-label={t('sftp.goHome')}
          onClick={() => onNavigate(type === 'remote' ? '.' : '')}
        >
          <Home className="size-3.5" />
        </button>
        {pathParts.map((part, index) => (
          <span
            key={`/${pathParts.slice(0, index + 1).join('/')}`}
            className="flex items-center gap-1 shrink-0"
          >
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
            placeholder={t('sftp.filter')}
          />
        )}
      </div>

      {type === 'local' && (
        <div className="shrink-0 px-3 py-1 border-b border-border/50">
          <Input
            className="h-6 text-xs"
            value={filter}
            onChange={e => onFilterChange(e.target.value)}
            placeholder={t('sftp.filterFiles')}
          />
        </div>
      )}
    </>
  )
}
