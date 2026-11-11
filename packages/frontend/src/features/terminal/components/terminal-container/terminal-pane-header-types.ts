import type { Host, Tab } from '@/types'

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'reconnecting'
  | 'connected'
  | 'disconnected'
  | 'error'

export interface TerminalPaneHeaderProps {
  tab: Tab
  host?: Host
  status: ConnectionStatus
  errorMessage?: string
  shellCwd?: string
  /**
   * Exit status of the last command the shell reported through OSC 133 `D`.
   * Left undefined when the shell integration is not active, so a pane never
   * claims a status it did not actually observe.
   */
  lastExitCode?: number
  reconnectAttempt?: number
  reconnectReason?: string
  /**
   * True while the failure is still worth retrying on its own, for example
   * after the automatic reconnect budget ran out during host sleep. The pane
   * then reads as recoverable rather than as a hard failure.
   */
  reconnectRetryable?: boolean
  /**
   * What the failure was, when it came from the credential layer.
   *
   * The header chooses its vault action from this, never from `errorMessage`:
   * two vault states can produce similar sentences and need different fixes.
   */
  credentialKind?: string
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
