import type { TerminalRecord } from './terminal-session-manager-types'

export interface TerminalSessionResourceSnapshot {
  recordTabIds: string[]
  sessionMappings: Array<{ sessionId: string; tabId: string }>
}

export function terminalSessionResourceSnapshot(
  records: Map<string, TerminalRecord>,
  sessionToTab: Map<string, string>,
): TerminalSessionResourceSnapshot {
  return {
    recordTabIds: [...records.keys()].sort(),
    sessionMappings: [...sessionToTab.entries()]
      .map(([sessionId, tabId]) => ({ sessionId, tabId }))
      .sort((left, right) =>
        left.sessionId === right.sessionId
          ? left.tabId.localeCompare(right.tabId)
          : left.sessionId.localeCompare(right.sessionId),
      ),
  }
}
