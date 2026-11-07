import {
  Clock,
  Code,
  FileUp,
  FolderClosed,
  Search,
  Server,
  Square,
  Zap,
} from 'lucide-react'
import type { TFunction } from 'i18next'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { useWorkspaceStore } from '@/store/workspace'
import { formatTimeAgo } from './command-palette-utils'
import { usePaletteQuickActions } from './palette-quick-actions'
import type { PaletteTabItem } from './command-palette-types'

function getTabTypeLabel(type: string, t: TFunction): string {
  switch (type) {
    case 'local':
      return t('sftp.local')
    case 'remote':
      return t('sftp.remote')
    case 'sftp':
      return t('sftp.title')
    case 'serial':
      return t('toolbar.serial')
    default:
      return type
  }
}

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
        icon: <Search className="size-3" />,
      },
      {
        key: 'hosts',
        label: t('cmdPalette.hosts'),
        icon: <Server className="size-3" />,
      },
      {
        key: 'sftp',
        label: t('cmdPalette.sftp'),
        icon: <FileUp className="size-3" />,
      },
      {
        key: 'snippets',
        label: t('cmdPalette.snippets'),
        icon: <Code className="size-3" />,
      },
      {
        key: 'history',
        label: t('cmdPalette.history'),
        icon: <Clock className="size-3" />,
      },
      {
        key: 'tabs',
        label: t('cmdPalette.closedTabs'),
        icon: <Square className="size-3" />,
      },
      {
        key: 'workspaces',
        label: t('cmdPalette.workspaces'),
        icon: <FolderClosed className="size-3" />,
      },
      {
        key: 'actions',
        label: t('cmdPalette.actions'),
        icon: <Zap className="size-3" />,
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
        description: `${getTabTypeLabel(tab.type, t)}${tab.hostId ? ` · ${hosts.find(host => host.id === tab.hostId)?.name ?? tab.hostId}` : ''}`,
        hint: t('cmdPalette.switchToTabHint'),
        icon: <Square className="size-4" />,
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
        description: `${getTabTypeLabel(closed.type, t)} · ${formatTimeAgo(closed.closedAt, t)}`,
        hint: t('cmdPalette.reopenTabHint'),
        icon: <Square className="size-4" />,
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
        icon: <FolderClosed className="size-4" />,
        data: workspace,
        score: 0,
      })),
    [workspaces, t],
  )
  const quickActions = usePaletteQuickActions(t)
  return { allTabs, openTabs, closedTabs, workspaceResults, quickActions }
}
