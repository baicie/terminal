import type { CommandHistoryRecord, SnippetRecord } from '@/service/database'
import type { Host } from '@/types'
import {
  ChevronRight,
  Clock,
  Code,
  FileUp,
  FolderOpen,
  FolderClosed,
  Keyboard,
  Search,
  Server,
  Settings,
  Square,
  Terminal,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { useAppStore, RecentlyClosedTab } from '@/store/app'
import { useHostStore } from '@/store/host'
import { useTransferQueue } from '@/store/transfer-queue'
import { useWorkspaceStore } from '@/store/workspace'

type PaletteTab =
  | 'all'
  | 'hosts'
  | 'snippets'
  | 'history'
  | 'actions'
  | 'sftp'
  | 'workspaces'
  | 'tabs'

type ResultType =
  | 'host'
  | 'snippet'
  | 'history'
  | 'action'
  | 'sftp'
  | 'workspace'
  | 'closed-tab'
  | 'open-tab'

interface SearchResult {
  id: string
  type: ResultType
  title: string
  description?: string
  hint?: string
  icon: React.ReactNode
  data: unknown
  score?: number
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

// ─── Fuzzy search (simple, no external dep) ──────────────────────────

function fuzzyScore(pattern: string, text: string): number {
  if (!pattern) return 1
  const lowerPattern = pattern.toLowerCase()
  const lowerText = text.toLowerCase()

  // Exact prefix match gets highest score
  if (lowerText.startsWith(lowerPattern)) return 100 + pattern.length
  // Contains full pattern
  if (lowerText.includes(lowerPattern)) {
    return 50 + pattern.length / text.length
  }

  // Character-by-character fuzzy: each matched consecutive char adds score
  let pi = 0
  let consecutive = 0
  let score = 0
  for (let i = 0; i < text.length && pi < pattern.length; i++) {
    if (lowerText[i] === lowerPattern[pi]) {
      pi++
      consecutive++
      score += consecutive * 2
    } else {
      consecutive = 0
    }
  }
  if (pi < pattern.length) return 0 // not all chars matched
  return score
}

function fuzzyMatch(pattern: string, text: string): boolean {
  return fuzzyScore(pattern, text) > 0
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose }) => {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [activeTab, setActiveTab] = useState<PaletteTab>('all')
  const [loading, setLoading] = useState(false)

  const app = useAppStore()
  const hosts = useHostStore(s => s.hosts)
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore(s => s.activeWorkspaceId)
  const setActiveWorkspace = useWorkspaceStore(s => s.setActiveWorkspace)
  const setPanelOpen = useTransferQueue(s => s.setPanelOpen)
  const navigate = useNavigate()

  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const isOpenRef = useRef(false)

  // ─── All available tabs ────────────────────────────────────────────

  const allTabs: { key: PaletteTab; label: string; icon: React.ReactNode }[] =
    useMemo(
      () => [
        { key: 'all', label: t('cmdPalette.all'), icon: <Search className="h-3 w-3" /> },
        { key: 'hosts', label: t('cmdPalette.hosts'), icon: <Server className="h-3 w-3" /> },
        { key: 'sftp', label: t('cmdPalette.sftp'), icon: <FileUp className="h-3 w-3" /> },
        { key: 'snippets', label: t('cmdPalette.snippets'), icon: <Code className="h-3 w-3" /> },
        { key: 'history', label: t('cmdPalette.history'), icon: <Clock className="h-3 w-3" /> },
        { key: 'tabs', label: t('cmdPalette.closedTabs'), icon: <Square className="h-3 w-3" /> },
        { key: 'workspaces', label: t('cmdPalette.workspaces'), icon: <FolderClosed className="h-3 w-3" /> },
        { key: 'actions', label: t('cmdPalette.actions'), icon: <Zap className="h-3 w-3" /> },
      ],
      [t],
    )

  // ─── Open tabs ─────────────────────────────────────────────────────

  const openTabs = useMemo(
    () =>
      app.tabs.map(tab => ({
        id: tab.id,
        type: 'open-tab' as const,
        title: tab.label,
        description: `${tab.type}${tab.hostId ? ` · ${hosts.find(h => h.id === tab.hostId)?.name ?? tab.hostId}` : ''}`,
        hint: t('cmdPalette.switchToTabHint'),
        icon: <Square className="h-4 w-4" />,
        data: tab,
        score: 0,
      })),
    [app.tabs, hosts, t],
  )

  // ─── Recently closed tabs ─────────────────────────────────────────

  const closedTabs = useMemo(
    () =>
      app.recentlyClosedTabs.map(closed => ({
        id: closed.id,
        type: 'closed-tab' as const,
        title: t('cmdPalette.reopenTab', { label: closed.label }),
        description: `${closed.type} · ${formatTimeAgo(closed.closedAt)}`,
        hint: t('cmdPalette.reopenTabHint'),
        icon: <Square className="h-4 w-4" />,
        data: closed,
        score: 0,
      })),
    [app.recentlyClosedTabs, t],
  )

  // ─── Workspaces ────────────────────────────────────────────────────

  const workspaceResults = useMemo(
    () =>
      workspaces.map(ws => ({
        id: ws.id,
        type: 'workspace' as const,
        title: ws.name,
        description: `${ws.description ?? ''} · ${ws.icon ?? '📁'}`,
        hint: t('cmdPalette.switchWorkspaceHint'),
        icon: <FolderClosed className="h-4 w-4" />,
        data: ws,
        score: 0,
      })),
    [workspaces, t],
  )

  // ─── Quick actions (shown when no query) ──────────────────────────

  const quickActions: SearchResult[] = useMemo(
    () => [
      {
        id: 'new-local',
        type: 'action',
        title: t('cmdPalette.newLocalTerminal'),
        description: t('cmdPalette.createSession'),
        icon: <Terminal className="h-4 w-4" />,
        data: { action: 'new-local' },
        score: 0,
      },
      {
        id: 'new-host',
        type: 'action',
        title: t('cmdPalette.newSSHConnection'),
        description: t('cmdPalette.addHost'),
        icon: <Server className="h-4 w-4" />,
        data: { action: 'new-host' },
        score: 0,
      },
      {
        id: 'toggle-sidebar',
        type: 'action',
        title: t('cmdPalette.toggleSidebar'),
        description: t('cmdPalette.showSidebar'),
        icon: <FolderOpen className="h-4 w-4" />,
        data: { action: 'toggle-sidebar' },
        score: 0,
      },
      {
        id: 'split-horizontal',
        type: 'action',
        title: t('cmdPalette.splitHorizontal'),
        description: t('cmdPalette.splitHoriz'),
        icon: <Zap className="h-4 w-4" />,
        data: { action: 'split-horizontal' },
        score: 0,
      },
      {
        id: 'split-vertical',
        type: 'action',
        title: t('cmdPalette.splitVertical'),
        description: t('cmdPalette.splitVert'),
        icon: <Zap className="h-4 w-4" />,
        data: { action: 'split-vertical' },
        score: 0,
      },
      {
        id: 'keyboard-shortcuts',
        type: 'action',
        title: t('cmdPalette.keyboardShortcuts'),
        description: t('cmdPalette.viewShortcuts'),
        icon: <Keyboard className="h-4 w-4" />,
        data: { action: 'shortcuts' },
        score: 0,
      },
      {
        id: 'settings',
        type: 'action',
        title: t('cmdPalette.openSettings'),
        description: t('cmdPalette.openSettingsHint'),
        icon: <Settings className="h-4 w-4" />,
        data: { action: 'settings' },
        score: 0,
      },
      {
        id: 'transfer-queue',
        type: 'action',
        title: t('cmdPalette.openTransferQueue'),
        description: t('cmdPalette.openTransferQueueHint'),
        icon: <FileUp className="h-4 w-4" />,
        data: { action: 'transfer-queue' },
        score: 0,
      },
    ],
    [t],
  )

  // ─── Search hosts ──────────────────────────────────────────────────

  const searchHosts = useCallback(
    (searchQuery: string): SearchResult[] => {
      const targets = hosts.slice(0, 20)
      if (!searchQuery) {
        return targets.map(host => ({
          id: host.id,
          type: 'host' as const,
          title: host.name,
          description: `${host.username}@${host.hostname}:${host.port}`,
          hint: t('cmdPalette.openSftpHint'),
          icon: <Server className="h-4 w-4" />,
          data: host,
          score: 0,
        }))
      }

      return targets
        .filter(host => {
          const haystack = `${host.name} ${host.hostname} ${host.username} ${host.tags?.join(' ') ?? ''}`.toLowerCase()
          return fuzzyMatch(searchQuery, haystack)
        })
        .map(host => ({
          id: host.id,
          type: 'host' as const,
          title: host.name,
          description: `${host.username}@${host.hostname}:${host.port}`,
          hint: t('cmdPalette.openSftpHint'),
          icon: <Server className="h-4 w-4" />,
          data: host,
          score: fuzzyScore(
            searchQuery,
            `${host.name} ${host.hostname} ${host.username}`,
          ),
        }))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 10)
    },
    [hosts, t],
  )

  // ─── SFTP actions for hosts ────────────────────────────────────────

  const sftpActions = useCallback(
    (searchQuery: string): SearchResult[] => {
      if (!searchQuery && hosts.length === 0) return []
      const targets = hosts.slice(0, 20)
      const filtered = searchQuery
        ? targets.filter(
            host =>
              fuzzyMatch(searchQuery, host.name) ||
              fuzzyMatch(searchQuery, host.hostname),
          )
        : targets

      return filtered.map(host => ({
        id: `sftp-${host.id}`,
        type: 'sftp' as const,
        title: t('cmdPalette.openSftpSession', { host: host.name }),
        description: `${host.username}@${host.hostname}:${host.port}`,
        hint: t('cmdPalette.openSftpHint'),
        icon: <FileUp className="h-4 w-4" />,
        data: { host },
        score: searchQuery ? fuzzyScore(searchQuery, host.name) : 0,
      })).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 10)
    },
    [hosts, t],
  )

  // ─── Search snippets ───────────────────────────────────────────────

  const searchSnippetsAction = useCallback(
    async (searchQuery: string): Promise<SearchResult[]> => {
      if (!searchQuery) return []
      try {
        const snippets = await searchSnippets(searchQuery)
        return snippets.slice(0, 10).map(snippet => ({
          id: snippet.id,
          type: 'snippet' as const,
          title: snippet.name,
          description: snippet.description || snippet.script.slice(0, 50),
          icon: <Code className="h-4 w-4" />,
          data: snippet,
          score: fuzzyScore(searchQuery, snippet.name),
        }))
      } catch {
        return []
      }
    },
    [],
  )

  // ─── Search command history ────────────────────────────────────────

  const searchHistory = useCallback(
    async (searchQuery: string): Promise<SearchResult[]> => {
      if (!searchQuery) return []
      try {
        const history = await getCommandHistory(undefined, 20)
        const filtered = history
          .filter(h => fuzzyMatch(searchQuery, h.command))
          .slice(0, 10)
        return filtered.map(record => ({
          id: `history-${record.id}`,
          type: 'history' as const,
          title: record.command,
          description: `Executed ${new Date(record.executed_at).toLocaleDateString()}`,
          icon: <Clock className="h-4 w-4" />,
          data: record,
          score: fuzzyScore(searchQuery, record.command),
        }))
      } catch {
        return []
      }
    },
    [],
  )

  // ─── Combine all search results ───────────────────────────────────

  const performSearch = useCallback(async () => {
    setLoading(true)
    try {
      const [snippets, history] = await Promise.all([
        searchSnippetsAction(query),
        searchHistory(query),
      ])

      let filtered: SearchResult[]

      if (activeTab === 'all') {
        const hosts2 = searchHosts(query)
        const sftp = sftpActions(query)
        filtered = [
          ...(query ? [] : quickActions),
          ...hosts2,
          ...sftp,
          ...snippets,
          ...history,
          ...(query ? [] : openTabs),
          ...(query ? [] : closedTabs),
          ...(query ? [] : workspaceResults.filter(w => w.id !== activeWorkspaceId)),
        ]
          .filter(r => {
            if (!query) return true
            return fuzzyMatch(query, r.title) || fuzzyMatch(query, r.description ?? '')
          })
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, 20)
      } else if (activeTab === 'hosts') {
        filtered = searchHosts(query)
      } else if (activeTab === 'sftp') {
        filtered = sftpActions(query)
      } else if (activeTab === 'snippets') {
        filtered = snippets
      } else if (activeTab === 'history') {
        filtered = history
      } else if (activeTab === 'tabs') {
        const open = openTabs.filter(r =>
          query ? fuzzyMatch(query, r.title) : true,
        )
        const closed = closedTabs.filter(r =>
          query ? fuzzyMatch(query, r.title) : true,
        )
        filtered = [...open, ...closed]
      } else if (activeTab === 'workspaces') {
        filtered = workspaceResults.filter(w => w.id !== activeWorkspaceId)
      } else {
        filtered = quickActions.filter(r =>
          query ? fuzzyMatch(query, r.title) : true,
        )
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
    sftpActions,
    searchSnippetsAction,
    searchHistory,
    quickActions,
    openTabs,
    closedTabs,
    workspaceResults,
    activeWorkspaceId,
  ])

  // ─── Focus input when opened ──────────────────────────────────────

  useEffect(() => {
    if (open) {
      isOpenRef.current = true
      setQuery('')
      setActiveTab('all')
      performSearch()
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      isOpenRef.current = false
    }
  }, [open, performSearch])

  // Re-run search on query/tab change
  useEffect(() => {
    if (isOpenRef.current) {
      performSearch()
    }
  }, [query, activeTab, performSearch])

  // ─── Handle selection ───────────────────────────────────────────────

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
        case 'sftp': {
          const { host } = result.data as { host: Host }
          navigate(`/sftp?host=${host.id}`)
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
        case 'open-tab': {
          const tab = result.data as { id: string }
          app.setActiveTab(tab.id)
          navigate(`/terminal?tab=${tab.id}`)
          break
        }
        case 'closed-tab': {
          const closed = result.data as RecentlyClosedTab
          app.reopenTab(closed)
          const reopened = app.tabs[app.tabs.length - 1]
          if (reopened) {
            navigate(`/terminal?tab=${reopened.id}`)
          }
          break
        }
        case 'workspace': {
          const ws = result.data as { id: string; name: string }
          setActiveWorkspace(ws.id)
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
              window.dispatchEvent(new CustomEvent('shortcut:new-ssh'))
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
            case 'shortcuts':
              window.dispatchEvent(new CustomEvent('open-shortcuts-help'))
              break
            case 'settings':
              navigate('/settings')
              break
            case 'transfer-queue':
              setPanelOpen(true)
              break
          }
          break
        }
      }
      onClose()
    },
    [app, onClose, navigate, setActiveWorkspace, setPanelOpen],
  )

  // ─── Keyboard navigation ───────────────────────────────────────────

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
          const tabs = allTabs.map(t => t.key)
          const currentIndex = tabs.indexOf(activeTab)
          const nextIndex = e.shiftKey
            ? (currentIndex - 1 + tabs.length) % tabs.length
            : (currentIndex + 1) % tabs.length
          setActiveTab(tabs[nextIndex])
          break
      }
    },
    [results, selectedIndex, onClose, activeTab, allTabs, handleSelect],
  )

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current && results.length > 0) {
      const children = resultsRef.current.children
      if (children[selectedIndex]) {
        ;(children[selectedIndex] as HTMLElement).scrollIntoView({
          block: 'nearest',
        })
      }
    }
  }, [selectedIndex, results.length])

  // ─── Type badge color ─────────────────────────────────────────────

  const typeBadge = (type: ResultType) => {
    switch (type) {
      case 'host':
        return 'bg-blue-500/10 text-blue-500'
      case 'sftp':
        return 'bg-teal-500/10 text-teal-500'
      case 'snippet':
        return 'bg-green-500/10 text-green-500'
      case 'history':
        return 'bg-orange-500/10 text-orange-500'
      case 'workspace':
        return 'bg-violet-500/10 text-violet-500'
      case 'open-tab':
        return 'bg-cyan-500/10 text-cyan-500'
      case 'closed-tab':
        return 'bg-muted text-muted-foreground'
      default:
        return 'bg-purple-500/10 text-purple-500'
    }
  }

  const typeLabel = (type: ResultType) => {
    switch (type) {
      case 'host': return 'host'
      case 'sftp': return 'sftp'
      case 'snippet': return 'snippet'
      case 'history': return 'history'
      case 'workspace': return 'workspace'
      case 'open-tab': return 'tab'
      case 'closed-tab': return 'closed'
      case 'action': return 'action'
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose()
      }}
    >
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
              placeholder={t('cmdPalette.placeholder')}
              className="pl-10 text-base"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b bg-muted/30 overflow-x-auto">
          {allTabs.map(tab => (
            <Button
              key={tab.key}
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-none px-3 py-2 h-auto gap-1.5 text-sm shrink-0 ${
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
              {t('cmdPalette.searching')}
            </div>
          ) : results.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              {query
                ? t('cmdPalette.noResults', { query })
                : activeTab === 'all'
                  ? t('cmdPalette.startTyping')
                  : t('cmdPalette.noTab', { tab: activeTab })}
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
                    {(result.description || result.hint) && (
                      <div className="text-xs text-muted-foreground truncate">
                        {result.description || result.hint}
                      </div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 text-xs px-2 py-0.5 rounded ${typeBadge(result.type)}`}
                  >
                    {typeLabel(result.type)}
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
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">↑↓</kbd>{' '}
              {t('cmdPalette.navigate')}
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Enter</kbd>{' '}
              {t('cmdPalette.select')}
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Tab</kbd>{' '}
              {t('cmdPalette.switchTabs')}
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Esc</kbd>{' '}
              {t('cmdPalette.close')}
            </span>
          </div>
          <span>{t('cmdPalette.results', { count: results.length })}</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default CommandPalette

// ─── Helpers ────────────────────────────────────────────────────────

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
