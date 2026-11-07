import {
  FileUp,
  FolderOpen,
  Keyboard,
  Server,
  Settings,
  Terminal,
  Zap,
} from 'lucide-react'
import type { TFunction } from 'i18next'
import { useMemo } from 'react'
import type { SearchResult } from './command-palette-types'

/** The fixed action list shown alongside search results. */
export function usePaletteQuickActions(t: TFunction): SearchResult[] {
  return useMemo(
    () => [
      {
        id: 'new-local',
        type: 'action',
        title: t('cmdPalette.newLocalTerminal'),
        description: t('cmdPalette.createSession'),
        icon: <Terminal className="size-4" />,
        data: { action: 'new-local' },
        score: 0,
      },
      {
        id: 'new-host',
        type: 'action',
        title: t('cmdPalette.newSSHConnection'),
        description: t('cmdPalette.addHost'),
        icon: <Server className="size-4" />,
        data: { action: 'new-host' },
        score: 0,
      },
      {
        id: 'toggle-sidebar',
        type: 'action',
        title: t('cmdPalette.toggleSidebar'),
        description: t('cmdPalette.showSidebar'),
        icon: <FolderOpen className="size-4" />,
        data: { action: 'toggle-sidebar' },
        score: 0,
      },
      {
        id: 'split-horizontal',
        type: 'action',
        title: t('cmdPalette.splitHorizontal'),
        description: t('cmdPalette.splitHoriz'),
        icon: <Zap className="size-4" />,
        data: { action: 'split-horizontal' },
        score: 0,
      },
      {
        id: 'split-vertical',
        type: 'action',
        title: t('cmdPalette.splitVertical'),
        description: t('cmdPalette.splitVert'),
        icon: <Zap className="size-4" />,
        data: { action: 'split-vertical' },
        score: 0,
      },
      {
        id: 'keyboard-shortcuts',
        type: 'action',
        title: t('cmdPalette.keyboardShortcuts'),
        description: t('cmdPalette.viewShortcuts'),
        icon: <Keyboard className="size-4" />,
        data: { action: 'shortcuts' },
        score: 0,
      },
      {
        id: 'settings',
        type: 'action',
        title: t('cmdPalette.openSettings'),
        description: t('cmdPalette.openSettingsHint'),
        icon: <Settings className="size-4" />,
        data: { action: 'settings' },
        score: 0,
      },
      {
        id: 'transfer-queue',
        type: 'action',
        title: t('cmdPalette.openTransferQueue'),
        description: t('cmdPalette.openTransferQueueHint'),
        icon: <FileUp className="size-4" />,
        data: { action: 'transfer-queue' },
        score: 0,
      },
    ],
    [t],
  )
}
