import type { CommandHistoryRecord, SnippetRecord } from '@/service/database'
import type { Host } from '@/types'
import {
  ChevronRight,
  Clock,
  Code,
  FolderOpen,
  Keyboard,
  Search,
  Server,
  Terminal,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/sonner'
import { getCommandHistory, searchSnippets } from '@/service/database'
import { terminalEmitter } from '@/service/terminal-emitter'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'

interface SearchResult {
  id: string
  type: 'host' | 'snippet' | 'history' | 'action'
  title: string
  description?: string
  icon: React.ReactNode
  data: unknown
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose }) => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [activeTab, setActiveTab] = useState<
    'all' | 'hosts' | 'snippets' | 'history' | 'actions'
  >('all')
  const [loading, setLoading] = useState(false)

  const app = useAppStore()
  const hosts = useHostStore(s => s.hosts)
  const navigate = useNavigate()

  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  // Quick actions
  const quickActions: SearchResult[] = useMemo(
    () => [
      {
        id: 'new-local',
        type: 'action',
        title: 'New Local Terminal',
        description: 'Create a new local shell session',
        icon: <Terminal className="h-4 w-4" />,
        data: { action: 'new-local' },
      },
      {
        id: 'new-host',
        type: 'action',
        title: 'New SSH Connection',
        description: 'Add a new host configuration',
        icon: <Server className="h-4 w-4" />,
        data: { action: 'new-host' },
      },
      {
        id: 'toggle-sidebar',
        type: 'action',
        title: 'Toggle Sidebar',
        description: 'Show or hide the host sidebar',
        icon: <FolderOpen className="h-4 w-4" />,
        data: { action: 'toggle-sidebar' },
      },
      {
        id: 'split-horizontal',
        type: 'action',
        title: 'Split Horizontal',
        description: 'Split terminal horizontally',
        icon: <Zap className="h-4 w-4" />,
        data: { action: 'split-horizontal' },
      },
      {
        id: 'split-vertical',
        type: 'action',
        title: 'Split Vertical',
        description: 'Split terminal vertically',
        icon: <Zap className="h-4 w-4" />,
        data: { action: 'split-vertical' },
      },
      {
        id: 'shortcuts',
        type: 'action',
        title: 'Keyboard Shortcuts',
        description: 'View all keyboard shortcuts',
        icon: <Keyboard className="h-4 w-4" />,
        data: { action: 'shortcuts' },
      },
    ],
    [],
  )

  // Filter hosts based on query
  const searchHosts = useCallback(
    (searchQuery: string): SearchResult[] => {
      if (!searchQuery) {
        return hosts.slice(0, 10).map(host => ({
          id: host.id,
          type: 'host' as const,
          title: host.name,
          description: `${host.username}@${host.hostname}:${host.port}`,
          icon: <Server className="h-4 w-4" />,
          data: host,
        }))
      }

      const lowerQuery = searchQuery.toLowerCase()
      return hosts
        .filter(
          host =>
            host.name.toLowerCase().includes(lowerQuery) ||
            host.hostname.toLowerCase().includes(lowerQuery) ||
            host.username.toLowerCase().includes(lowerQuery) ||
            host.tags?.some(tag => tag.toLowerCase().includes(lowerQuery)),
        )
        .slice(0, 10)
        .map(host => ({
          id: host.id,
          type: 'host' as const,
          title: host.name,
          description: `${host.username}@${host.hostname}:${host.port}`,
          icon: <Server className="h-4 w-4" />,
          data: host,
        }))
    },
    [hosts],
  )

  // Search snippets
  const searchSnippetsAction = useCallback(
    async (searchQuery: string): Promise<SearchResult[]> => {
      if (!searchQuery) {
        return []
      }
      try {
        const snippets = await searchSnippets(searchQuery)
        return snippets.slice(0, 10).map(snippet => ({
          id: snippet.id,
          type: 'snippet' as const,
          title: snippet.name,
          description: snippet.description || snippet.script.slice(0, 50),
          icon: <Code className="h-4 w-4" />,
          data: snippet,
        }))
      } catch {
        return []
      }
    },
    [],
  )

  // Search command history
  const searchHistory = useCallback(
    async (searchQuery: string): Promise<SearchResult[]> => {
      if (!searchQuery) {
        return []
      }
      try {
        const history = await getCommandHistory(undefined, 20)
        const filtered = history
          .filter(h =>
            h.command.toLowerCase().includes(searchQuery.toLowerCase()),
          )
          .slice(0, 10)
        return filtered.map(record => ({
          id: `history-${record.id}`,
          type: 'history' as const,
          title: record.command,
          description: `Executed ${new Date(record.executed_at).toLocaleDateString()}`,
          icon: <Clock className="h-4 w-4" />,
          data: record,
        }))
      } catch {
        return []
      }
    },
    [],
  )

  // Combine all search results
  const performSearch = useCallback(async () => {
    setLoading(true)
    try {
      const [hosts, snippets, history] = await Promise.all([
        Promise.resolve(searchHosts(query)),
        searchSnippetsAction(query),
        searchHistory(query),
      ])

      let filtered: SearchResult[]

      if (activeTab === 'all') {
        filtered = [
          ...hosts,
          ...snippets,
          ...history,
          ...(query ? [] : quickActions),
        ]
      } else if (activeTab === 'hosts') {
        filtered = hosts
      } else if (activeTab === 'snippets') {
        filtered = snippets
      } else if (activeTab === 'history') {
        filtered = history
      } else {
        filtered = quickActions
      }

      setResults(filtered)
      setSelectedIndex(0)
    } finally {
      setLoading(false)
    }
  }, [
    query,
    activeTab,
    searchHosts,
    searchSnippetsAction,
    searchHistory,
    quickActions,
  ])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveTab('all')
      performSearch()
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open, performSearch])

  useEffect(() => {
    performSearch()
  }, [query, activeTab, performSearch])

  // Handle selection
  const handleSelect = useCallback(
    (result: SearchResult) => {
      switch (result.type) {
        case 'host': {
          const host = result.data as Host
          const newTab = app.addTab({
            label: host.name,
            type: 'remote',
            hostId: host.id,
          })
          navigate(`/terminal?tab=${newTab.id}`)
          break
        }
        case 'snippet': {
          const snippet = result.data as SnippetRecord
          let script = snippet.script
          const variables = snippet.variables
            ? (JSON.parse(snippet.variables) as Array<{
                name: string
                defaultValue?: string
              }>)
            : []
          script = script.replace(/\$\{([^}]+)\}/g, (_, varName) => {
            const variable = variables.find(v => v.name === varName)
            return (
              window.prompt(
                `Enter value for ${varName}:`,
                variable?.defaultValue || '',
              ) || ''
            )
          })
          script = script.replace(/\$([A-Z_]\w*)/gi, (_, varName) => {
            const variable = variables.find(v => v.name === varName)
            if (variable) {
              return (
                window.prompt(
                  `Enter value for ${varName}:`,
                  variable?.defaultValue || '',
                ) || ''
              )
            }
            return ''
          })
          terminalEmitter.writeCommand(script)
          toast.success(`Executing: ${snippet.name}`)
          break
        }
        case 'history': {
          const historyRecord = result.data as CommandHistoryRecord
          terminalEmitter.writeCommand(historyRecord.command)
          break
        }
        case 'action': {
          const action = result.data as { action: string }
          switch (action.action) {
            case 'new-local': {
              const localTab = app.addTab({ label: 'Local', type: 'local' })
              navigate(`/terminal?tab=${localTab.id}`)
              break
            }
            case 'new-host':
              break
            case 'toggle-sidebar':
              app.toggleSidebar()
              break
            case 'split-horizontal':
              if (app.activeTabId) {
                app.splitTab(app.activeTabId, 'horizontal')
              }
              break
            case 'split-vertical':
              if (app.activeTabId) {
                app.splitTab(app.activeTabId, 'vertical')
              }
              break
          }
          break
        }
      }
      onClose()
    },
    [app, onClose, navigate],
  )

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => Math.min(prev + 1, results.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (results[selectedIndex]) {
            handleSelect(results[selectedIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
        case 'Tab':
          e.preventDefault()
          const tabs: Array<typeof activeTab> = [
            'all',
            'hosts',
            'snippets',
            'history',
            'actions',
          ]
          const currentIndex = tabs.indexOf(activeTab)
          const nextIndex = e.shiftKey
            ? (currentIndex - 1 + tabs.length) % tabs.length
            : (currentIndex + 1) % tabs.length
          setActiveTab(tabs[nextIndex])
          break
      }
    },
    [results, selectedIndex, onClose, activeTab, handleSelect],
  )

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current) {
      const selectedElement = resultsRef.current.children[
        selectedIndex
      ] as HTMLElement
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex])

  const tabs = [
    {
      key: 'all' as const,
      label: 'All',
      icon: <Search className="h-3 w-3" />,
    },
    {
      key: 'hosts' as const,
      label: 'Hosts',
      icon: <Server className="h-3 w-3" />,
    },
    {
      key: 'snippets' as const,
      label: 'Snippets',
      icon: <Code className="h-3 w-3" />,
    },
    {
      key: 'history' as const,
      label: 'History',
      icon: <Clock className="h-3 w-3" />,
    },
    {
      key: 'actions' as const,
      label: 'Actions',
      icon: <Zap className="h-3 w-3" />,
    },
  ]

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Command Palette</DialogTitle>
        </DialogHeader>
        {/* Search Input */}
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Search hosts, snippets, commands... (Tab to switch tabs)"
              className="pl-10 text-base"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b bg-muted/30">
          {tabs.map(tab => (
            <Button
              key={tab.key}
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-none px-4 py-2 h-auto gap-1.5 text-sm ${
                activeTab === tab.key
                  ? 'bg-background border-b-2 border-primary rounded-t-md'
                  : 'hover:bg-muted/50'
              }`}
            >
              {tab.icon}
              {tab.label}
            </Button>
          ))}
        </div>

        {/* Results */}
        <div ref={resultsRef} className="max-h-[400px] overflow-y-auto p-2">
          {loading ? (
            <div className="text-center text-muted-foreground py-8">
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              {query
                ? `No results found for "${query}"`
                : activeTab === 'all'
                  ? 'Start typing to search...'
                  : `No ${activeTab} found`}
            </div>
          ) : (
            <div className="space-y-1">
              {results.map((result, index) => (
                <Button
                  key={result.id}
                  variant="ghost"
                  className={`w-full justify-start h-auto py-3 px-3 gap-3 ${
                    index === selectedIndex
                      ? 'bg-primary/10 border border-primary/20'
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => handleSelect(result)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span
                    className={`shrink-0 ${
                      index === selectedIndex
                        ? 'text-primary'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {result.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div
                      className={`font-medium truncate ${
                        index === selectedIndex ? 'text-primary' : ''
                      }`}
                    >
                      {result.title}
                    </div>
                    {result.description && (
                      <div className="text-xs text-muted-foreground truncate">
                        {result.description}
                      </div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 text-xs px-2 py-0.5 rounded ${
                      result.type === 'host'
                        ? 'bg-blue-500/10 text-blue-500'
                        : result.type === 'snippet'
                          ? 'bg-green-500/10 text-green-500'
                          : result.type === 'history'
                            ? 'bg-orange-500/10 text-orange-500'
                            : 'bg-purple-500/10 text-purple-500'
                    }`}
                  >
                    {result.type}
                  </span>
                  <ChevronRight
                    className={`size-4 shrink-0 ${
                      index === selectedIndex
                        ? 'text-primary'
                        : 'text-muted-foreground'
                    }`}
                  />
                </Button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">
                ↑↓
              </kbd>{' '}
              Navigate
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">
                Enter
              </kbd>{' '}
              Select
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">
                Tab
              </kbd>{' '}
              Switch tabs
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">
                Esc
              </kbd>{' '}
              Close
            </span>
          </div>
          <span>
            {results.length} result
            {results.length !== 1 ? 's' : ''}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default CommandPalette
