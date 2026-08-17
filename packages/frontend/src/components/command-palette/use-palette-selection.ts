import type { CommandHistoryRecord, SnippetRecord } from '@/service/database'
import type { Host } from '@/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/components/ui/sonner'
import { terminalEmitter } from '@/service/terminal-emitter'
import { switchWorkspaceLayout } from '@/service/workspace-switch'
import { useAppStore, type RecentlyClosedTab } from '@/store/app'
import { useTransferQueue } from '@/store/transfer-queue'
import type { SearchResult } from './command-palette-types'

export function usePaletteSelection(onClose: () => void) {
  const { t } = useTranslation()
  const app = useAppStore()
  const navigate = useNavigate()
  const setPanelOpen = useTransferQueue(state => state.setPanelOpen)
  return useCallback(
    async (result: SearchResult) => {
      switch (result.type) {
        case 'host': {
          const host = result.data as Host
          const tab = app.addTab({
            label: host.name,
            type: 'remote',
            hostId: host.id,
          })
          navigate(`/terminal?tab=${tab.id}`)
          break
        }
        case 'sftp':
          navigate(`/sftp?host=${(result.data as { host: Host }).host.id}`)
          break
        case 'snippet': {
          const snippet = result.data as SnippetRecord
          const variables = snippet.variables
            ? (JSON.parse(snippet.variables) as Array<{
                name: string
                defaultValue?: string
              }>)
            : []
          let script = snippet.script.replace(
            /\$\{([^}]+)\}/g,
            (_, variableName) =>
              window.prompt(
                `Enter value for ${variableName}:`,
                variables.find(variable => variable.name === variableName)
                  ?.defaultValue || '',
              ) || '',
          )
          script = script.replace(/\$([A-Z_]\w*)/gi, (_, variableName) => {
            const variable = variables.find(item => item.name === variableName)
            return variable
              ? window.prompt(
                  `Enter value for ${variableName}:`,
                  variable.defaultValue || '',
                ) || ''
              : ''
          })
          terminalEmitter.writeCommand(script)
          toast.success(`Executing: ${snippet.name}`)
          break
        }
        case 'history':
          terminalEmitter.writeCommand(
            (result.data as CommandHistoryRecord).command,
          )
          break
        case 'open-tab': {
          const tab = result.data as { id: string }
          app.setActiveTab(tab.id)
          navigate(`/terminal?tab=${tab.id}`)
          break
        }
        case 'closed-tab': {
          const reopened = app.reopenTab(result.data as RecentlyClosedTab)
          navigate(`/terminal?tab=${reopened.id}`)
          break
        }
        case 'workspace':
          try {
            await switchWorkspaceLayout((result.data as { id: string }).id)
          } catch (error) {
            toast.error(t('workspace.switchFailed'), {
              description:
                error instanceof Error ? error.message : String(error),
            })
          }
          break
        case 'action': {
          switch ((result.data as { action: string }).action) {
            case 'new-local': {
              const tab = app.addTab({ label: 'Local', type: 'local' })
              navigate(`/terminal?tab=${tab.id}`)
              break
            }
            case 'new-host':
              window.dispatchEvent(new CustomEvent('shortcut:new-ssh'))
              break
            case 'toggle-sidebar':
              app.toggleSidebar()
              break
            case 'split-horizontal':
              if (app.activeTabId) app.splitTab(app.activeTabId, 'horizontal')
              break
            case 'split-vertical':
              if (app.activeTabId) app.splitTab(app.activeTabId, 'vertical')
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
        }
      }
      onClose()
    },
    [app, navigate, onClose, setPanelOpen, t],
  )
}
