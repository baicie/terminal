import type { TabType } from '@/features/terminal/types'
import type { Host } from '@/types'

export interface ShellOutput {
  session_id: string
  data: string
  is_stderr: boolean
}

export interface UseTerminalOptions {
  /** Stable AppStore tab id that owns the terminal session. */
  tabId: string
  /** Workspace namespace that prevents cross-workspace session reuse. */
  workspaceId: string
  /** Tab type: local, remote, or serial. */
  tabType: TabType
  /** Required when tabType is remote. */
  host?: Host
  /** Resolved host referenced by host.jumpHostId. */
  jumpHost?: Host
  /** Existing serial session ID, required when tabType is serial. */
  serialSessionId?: string
  cols?: number
  rows?: number
  onTabPress?: (
    currentLine: string,
    cursorPos: number,
    history: string[],
  ) => void
}

export interface UseTerminalResult {
  sessionId: string | null
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
  error: string | null
  write: (data: string) => void
  reconnect: () => void
  disconnect: () => void
}
