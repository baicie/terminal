import type { CommandHistoryRecord, SnippetRecord } from '@/service/database'
import { ChevronRight, Clock, Code, Loader2, Play, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from '@/components/ui/sonner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatRelativeTime } from '@/lib/date-utils'
import { getCommandHistory, getSnippets } from '@/service/database'
import { terminalEmitter } from '@/service/terminal-emitter'

interface TerminalToolSidebarProps {
  /** 是否展开侧栏 */
  visible: boolean
  onToggle: () => void
}

type ActiveTab = 'snippets' | 'history'

const TerminalToolSidebar: React.FC<TerminalToolSidebarProps> = ({
  visible,
  onToggle,
}) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('snippets')
  const [searchQuery, setSearchQuery] = useState('')
  const [snippets, setSnippets] = useState<SnippetRecord[]>([])
  const [history, setHistory] = useState<CommandHistoryRecord[]>([])
  const [loading, setLoading] = useState(false)

  // Load data based on active tab
  useEffect(() => {
    if (!visible) return
    const loadData = async () => {
      setLoading(true)
      try {
        if (activeTab === 'snippets') {
          const data = await getSnippets()
          setSnippets(data)
        } else {
          const data = await getCommandHistory(undefined, 100)
          setHistory(data)
        }
      } catch (error) {
        console.error('Failed to load sidebar data:', error)
      } finally {
        setLoading(false)
      }
    }
    void loadData()
  }, [visible, activeTab])

  const filteredSnippets = snippets.filter(
    s =>
      !searchQuery ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description?.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const filteredHistory = history.filter(
    h =>
      !searchQuery ||
      h.command.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  // Execute snippet (parse variables and send)
  const handleExecuteSnippet = useCallback((snippet: SnippetRecord) => {
    let script = snippet.script

    // Parse variables from script
    const variableRegex = /\$\{?([A-Z_]\w*)\}?/gi
    const foundVars = new Set<string>()
    let match
    while ((match = variableRegex.exec(script)) !== null) {
      foundVars.add(match[1])
    }

    if (foundVars.size > 0) {
      // Collect variable values via prompts
      const values: Record<string, string> = {}
      for (const varName of foundVars) {
        let defaultValue = ''
        try {
          const stored = snippet.variables ? JSON.parse(snippet.variables) : []
          const def = stored.find(
            (v: { name: string; defaultValue?: string }) => v.name === varName,
          )
          if (def?.defaultValue) defaultValue = def.defaultValue
        } catch {
          /* ignore */
        }
        const value = window.prompt(`Enter value for ${varName}:`, defaultValue)
        if (value === null) return // User cancelled
        values[varName] = value
      }
      script = script.replace(
        /\$\{?([A-Z_]\w*)\}?/gi,
        (_, varName) => values[varName] ?? '',
      )
    }

    terminalEmitter.writeCommand(script)
    toast.success(`Executing: ${snippet.name}`)
  }, [])

  // Execute history command
  const handleExecuteHistory = useCallback((record: CommandHistoryRecord) => {
    terminalEmitter.writeCommand(record.command)
  }, [])

  return (
    <div
      className={`
          shrink-0 flex flex-col border-l border-border/50 bg-card
          transition-all duration-200 overflow-hidden
          ${visible ? 'w-72' : 'w-0'}
        `}
    >
      {/* Header */}
      <div className="shrink-0 flex items-center h-10 px-2 border-b border-border/50">
        {visible && (
          <>
            {/* Tab buttons */}
            <div className="flex items-center gap-0.5 flex-1">
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 px-2 gap-1 text-xs ${
                  activeTab === 'snippets'
                    ? 'bg-secondary/80 text-foreground'
                    : 'text-muted-foreground'
                }`}
                onClick={() => setActiveTab('snippets')}
              >
                <Code className="size-3.5" />
                Snippets
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 px-2 gap-1 text-xs ${
                  activeTab === 'history'
                    ? 'bg-secondary/80 text-foreground'
                    : 'text-muted-foreground'
                }`}
                onClick={() => setActiveTab('history')}
              >
                <Clock className="size-3.5" />
                History
              </Button>
            </div>

            {/* Collapse button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={onToggle}
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Collapse</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>

      {/* Content */}
      {visible && (
        <>
          {/* Search */}
          <div className="shrink-0 px-3 py-2 border-b border-border/50">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                className="h-7 text-xs pl-8"
                placeholder={
                  activeTab === 'snippets'
                    ? 'Filter snippets...'
                    : 'Filter history...'
                }
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Quick Snippets Bar (only in snippets tab) */}
          {activeTab === 'snippets' && (
            <div className="shrink-0 px-3 py-2 border-b border-border/50 space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Quick Run
              </p>
              <div className="flex flex-col gap-1">
                {filteredSnippets.slice(0, 3).map(snippet => (
                  <button
                    key={snippet.id}
                    type="button"
                    className="flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-accent/60 transition-colors group"
                    onClick={() => handleExecuteSnippet(snippet)}
                    title={snippet.script.slice(0, 60)}
                  >
                    <Code className="size-3 text-primary shrink-0" />
                    <span className="text-xs truncate flex-1">
                      {snippet.name}
                    </span>
                    <Play className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Scrollable list */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-3 space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : activeTab === 'snippets' ? (
                filteredSnippets.length === 0 ? (
                  <div className="text-center text-muted-foreground text-xs py-8">
                    {searchQuery ? 'No matching snippets' : 'No snippets yet'}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {filteredSnippets.map(snippet => (
                      <div
                        key={snippet.id}
                        className="group flex items-start gap-2 p-2 rounded-lg hover:bg-accent/50 cursor-pointer transition-colors"
                        onClick={() => handleExecuteSnippet(snippet)}
                      >
                        <div className="p-1 rounded bg-primary/10 text-primary shrink-0 mt-0.5">
                          <Code className="size-3" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {snippet.name}
                          </div>
                          {snippet.description && (
                            <div className="text-xs text-muted-foreground truncate">
                              {snippet.description}
                            </div>
                          )}
                          <pre className="text-[10px] text-muted-foreground/70 font-mono mt-1 truncate">
                            {snippet.script.slice(0, 80)}
                          </pre>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 opacity-0 group-hover:opacity-100 shrink-0 mt-0.5"
                          onClick={e => {
                            e.stopPropagation()
                            handleExecuteSnippet(snippet)
                          }}
                        >
                          <Play className="size-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )
              ) : filteredHistory.length === 0 ? (
                <div className="text-center text-muted-foreground text-xs py-8">
                  {searchQuery ? 'No matching commands' : 'No command history'}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filteredHistory.map((record, i) => (
                    <div
                      key={record.id || i}
                      className="group flex items-start gap-2 p-2 rounded-lg hover:bg-accent/50 cursor-pointer transition-colors"
                      onClick={() => handleExecuteHistory(record)}
                    >
                      <div className="p-1 rounded bg-secondary/80 text-muted-foreground shrink-0 mt-0.5">
                        <Clock className="size-3" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-xs truncate">
                          {record.command}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {formatRelativeTime(record.executed_at)}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 opacity-0 group-hover:opacity-100 shrink-0 mt-0.5"
                        onClick={e => {
                          e.stopPropagation()
                          handleExecuteHistory(record)
                        }}
                      >
                        <Play className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  )
}

export default TerminalToolSidebar
