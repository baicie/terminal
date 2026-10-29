import type { CommandHistoryRecord, SnippetRecord } from '@/service/database'
import { Clock, Code, Loader2, Play, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatRelativeTime } from '@/lib/date-utils'

interface SidebarContentProps {
  activeTab: 'snippets' | 'history'
  searchQuery: string
  snippets: SnippetRecord[]
  history: CommandHistoryRecord[]
  loading: boolean
  onSearchChange: (query: string) => void
  onExecuteSnippet: (snippet: SnippetRecord) => void
  onExecuteHistory: (record: CommandHistoryRecord) => void
}

export function SidebarContent({
  activeTab,
  searchQuery,
  snippets,
  history,
  loading,
  onSearchChange,
  onExecuteSnippet,
  onExecuteHistory,
}: SidebarContentProps) {
  return (
    <>
      <div className="shrink-0 border-b border-border/50 px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-7 pl-8 text-xs"
            placeholder={
              activeTab === 'snippets'
                ? 'Filter snippets...'
                : 'Filter history...'
            }
            value={searchQuery}
            onChange={event => onSearchChange(event.target.value)}
          />
        </div>
      </div>

      {activeTab === 'snippets' && (
        <div className="flex shrink-0 flex-col gap-1.5 border-b border-border/50 px-3 py-2">
          <p className="text-[10px] font-medium uppercase text-muted-foreground">
            Quick Run
          </p>
          <div className="flex flex-col gap-1">
            {snippets.slice(0, 3).map(snippet => (
              <Button
                key={snippet.id}
                type="button"
                variant="ghost"
                className="group h-auto justify-start gap-2 px-2 py-1.5"
                onClick={() => onExecuteSnippet(snippet)}
                title={snippet.script.slice(0, 60)}
              >
                <Code className="shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-left text-xs">
                  {snippet.name}
                </span>
                <Play className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
              </Button>
            ))}
          </div>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-3">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin text-muted-foreground" />
            </div>
          ) : activeTab === 'snippets' ? (
            snippets.length === 0 ? (
              <EmptyMessage hasSearch={Boolean(searchQuery)} type="snippets" />
            ) : (
              snippets.map(snippet => (
                <Button
                  type="button"
                  variant="ghost"
                  key={snippet.id}
                  className="group h-auto w-full items-start justify-start gap-2 whitespace-normal rounded p-2 text-left hover:bg-accent/50"
                  onClick={() => onExecuteSnippet(snippet)}
                >
                  <span className="mt-0.5 shrink-0 rounded bg-primary/10 p-1 text-primary">
                    <Code />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {snippet.name}
                    </span>
                    {snippet.description && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {snippet.description}
                      </span>
                    )}
                    <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground/70">
                      {snippet.script.slice(0, 80)}
                    </span>
                  </span>
                  <Play className="mt-1 shrink-0 opacity-0 group-hover:opacity-100" />
                </Button>
              ))
            )
          ) : history.length === 0 ? (
            <EmptyMessage hasSearch={Boolean(searchQuery)} type="history" />
          ) : (
            history.map((record, index) => (
              <Button
                type="button"
                variant="ghost"
                key={record.id || index}
                className="group h-auto w-full items-start justify-start gap-2 whitespace-normal rounded p-2 text-left hover:bg-accent/50"
                onClick={() => onExecuteHistory(record)}
              >
                <span className="mt-0.5 shrink-0 rounded bg-secondary/80 p-1 text-muted-foreground">
                  <Clock />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs">
                    {record.command}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {formatRelativeTime(record.executed_at)}
                  </span>
                </span>
                <Play className="mt-1 shrink-0 opacity-0 group-hover:opacity-100" />
              </Button>
            ))
          )}
        </div>
      </ScrollArea>
    </>
  )
}

function EmptyMessage({
  hasSearch,
  type,
}: {
  hasSearch: boolean
  type: 'snippets' | 'history'
}) {
  const message = hasSearch
    ? type === 'snippets'
      ? 'No matching snippets'
      : 'No matching commands'
    : type === 'snippets'
      ? 'No snippets yet'
      : 'No command history'
  return (
    <div className="py-8 text-center text-xs text-muted-foreground">
      {message}
    </div>
  )
}
