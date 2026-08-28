import type { UseTerminalOptions } from '@/hooks/use-terminal'
import type { TerminalSmokeConfig } from './terminal-smoke-contract'

export function terminalSmokeTabId(roundIndex: number): string {
  return `terminal-smoke-ssh-${roundIndex + 1}`
}

export function terminalSmokeRequest(
  config: TerminalSmokeConfig,
  roundIndex: number,
): UseTerminalOptions {
  return {
    tabId: terminalSmokeTabId(roundIndex),
    workspaceId: 'terminal-smoke',
    tabType: 'remote',
    host: {
      id: `terminal-smoke-host-${roundIndex + 1}`,
      name: `SSH smoke ${roundIndex + 1}`,
      hostname: config.ssh.host,
      port: config.ssh.port,
      username: config.ssh.username,
      authType: 'key',
      privateKey: config.ssh.privateKey,
      isFavorite: false,
      portForwards: [],
      createdAt: 0,
      updatedAt: roundIndex + 1,
    },
    expectedHostKey: config.ssh.expectedHostKey,
    cols: config.initialCols,
    rows: config.initialRows,
  }
}
