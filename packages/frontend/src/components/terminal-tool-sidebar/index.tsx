import type { CommandHistoryRecord, SnippetRecord } from '@/service/database'
import { ChevronRight, Clock, Code } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getCommandHistory, getSnippets } from '@/service/database'
import { terminalEmitter } from '@/service/terminal-emitter'
import { SidebarContent } from './sidebar-content'

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
          <SidebarContent
            activeTab={activeTab}
            searchQuery={searchQuery}
            snippets={filteredSnippets}
            history={filteredHistory}
            loading={loading}
            onSearchChange={setSearchQuery}
            onExecuteSnippet={handleExecuteSnippet}
            onExecuteHistory={handleExecuteHistory}
          />
        </>
      )}
    </div>
  )
}

export default TerminalToolSidebar
