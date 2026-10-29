import {
  Clock,
  Code,
  FileUp,
  FolderClosed,
  FolderOpen,
  Keyboard,
  Search,
  Server,
  Settings,
  Square,
  Terminal,
  Zap,
} from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { useWorkspaceStore } from '@/store/workspace'
import { formatTimeAgo } from './command-palette-utils'
import type { PaletteTabItem, SearchResult } from './command-palette-types'

export function usePaletteStaticResults() {
  const { t } = useTranslation()
  const app = useAppStore()
  const hosts = useHostStore(state => state.hosts)
  const workspaces = useWorkspaceStore(state => state.workspaces)
  const allTabs: PaletteTabItem[] = useMemo(
    () => [
      {
        key: 'all',
        label: t('cmdPalette.all'),
        icon: <Search className="h-3 w-3" />,
      },
      {
        key: 'hosts',
        label: t('cmdPalette.hosts'),
        icon: <Server className="h-3 w-3" />,
      },
      {
        key: 'sftp',
        label: t('cmdPalette.sftp'),
        icon: <FileUp className="h-3 w-3" />,
      },
      {
        key: 'snippets',
        label: t('cmdPalette.snippets'),
        icon: <Code className="h-3 w-3" />,
      },
      {
        key: 'history',
        label: t('cmdPalette.history'),
        icon: <Clock className="h-3 w-3" />,
      },
      {
        key: 'tabs',
        label: t('cmdPalette.closedTabs'),
        icon: <Square className="h-3 w-3" />,
      },
      {
        key: 'workspaces',
        label: t('cmdPalette.workspaces'),
        icon: <FolderClosed className="h-3 w-3" />,
      },
      {
        key: 'actions',
        label: t('cmdPalette.actions'),
        icon: <Zap className="h-3 w-3" />,
      },
    ],
    [t],
  )
  const openTabs = useMemo(
    () =>
      app.tabs.map(tab => ({
        id: tab.id,
        type: 'open-tab' as const,
        title: tab.label,
        description: `${tab.type}${tab.hostId ? ` · ${hosts.find(host => host.id === tab.hostId)?.name ?? tab.hostId}` : ''}`,
        hint: t('cmdPalette.switchToTabHint'),
        icon: <Square className="h-4 w-4" />,
        data: tab,
        score: 0,
      })),
    [app.tabs, hosts, t],
  )
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
  const workspaceResults = useMemo(
    () =>
      workspaces.map(workspace => ({
        id: workspace.id,
        type: 'workspace' as const,
        title: workspace.name,
        description: `${workspace.description ?? ''} · ${workspace.icon ?? '📁'}`,
        hint: t('cmdPalette.switchWorkspaceHint'),
        icon: <FolderClosed className="h-4 w-4" />,
        data: workspace,
        score: 0,
      })),
    [workspaces, t],
  )
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
  return { allTabs, openTabs, closedTabs, workspaceResults, quickActions }
}
