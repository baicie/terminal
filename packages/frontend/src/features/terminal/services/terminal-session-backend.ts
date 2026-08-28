import { serialService } from './serial'
import type { TerminalSessionRequest } from './terminal-session-manager-types'
import { terminalSessionTransport } from './terminal-session-transport'

export async function closeTerminalBackend(
  tabType: TerminalSessionRequest['tabType'],
  sessionId: string,
): Promise<void> {
  if (tabType === 'serial') {
    await serialService.disconnect(sessionId).catch(() => {})
    return
  }
  await terminalSessionTransport.close(sessionId).catch(() => {})
}
