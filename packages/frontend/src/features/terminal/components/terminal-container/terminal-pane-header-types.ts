import type { Host, Tab } from '@/types'

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'

export interface TerminalPaneHeaderProps {
  tab: Tab
  host?: Host
  status: ConnectionStatus
  errorMessage?: string
  fontSize: number
  isMobile: boolean
  toolsOpen: boolean
  fullscreen: boolean
  onSearch: () => void
  onClear: () => void
  onToggleTools: () => void
  onFontSizeChange: (delta: number) => void
  onResetFontSize: () => void
  onToggleFullscreen: () => void
  onRequestFocus: () => void
  onReconnect?: () => void
  onDisconnect?: () => void
}
