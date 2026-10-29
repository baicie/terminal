import type { UseTerminalOptions } from '@/hooks/use-terminal'
import type { Host } from '@/types'
import type { TerminalSmokeConfig } from './terminal-smoke-contract'

const JUMP_HOST_ID = 'terminal-smoke-jump'

export function terminalSmokeTabId(roundIndex: number): string {
  return `terminal-smoke-ssh-${roundIndex + 1}`
}

function smokeHost(
  config: TerminalSmokeConfig,
  roundIndex: number,
): Host {
  const { ssh } = config
  const base = {
    id: `terminal-smoke-host-${roundIndex + 1}`,
    name: `SSH smoke ${roundIndex + 1}`,
    hostname: ssh.host,
    port: ssh.port,
    username: ssh.username,
    isFavorite: false,
    portForwards: [],
    createdAt: 0,
    updatedAt: roundIndex + 1,
  }
  switch (ssh.authMode) {
    case 'password':
      return {
        ...base,
        authType: 'password',
        password: ssh.password ?? undefined,
      }
    case 'agent':
      return { ...base, authType: 'agent' }
    case 'cert':
      return {
        ...base,
        authType: 'cert',
        certificate: ssh.certificate ?? undefined,
        privateKey: ssh.privateKey ?? undefined,
        password: ssh.password ?? undefined,
      }
    case 'key':
    default:
      return {
        ...base,
        authType: 'key',
        privateKey: ssh.privateKey ?? undefined,
        ...(ssh.jump ? { jumpHostId: JUMP_HOST_ID } : {}),
      }
  }
}

export function terminalSmokeRequest(
  config: TerminalSmokeConfig,
  roundIndex: number,
): UseTerminalOptions {
  const { ssh } = config
  const request: UseTerminalOptions = {
    tabId: terminalSmokeTabId(roundIndex),
    workspaceId: 'terminal-smoke',
    tabType: 'remote',
    host: smokeHost(config, roundIndex),
    expectedHostKey: ssh.expectedHostKey,
    cols: config.initialCols,
    rows: config.initialRows,
  }
  if (ssh.jump) {
    request.jumpHost = {
      id: JUMP_HOST_ID,
      name: 'SSH smoke jump host',
      hostname: ssh.jump.host,
      port: ssh.jump.port,
      username: ssh.jump.username,
      authType: 'key',
      privateKey: ssh.jump.privateKey,
      isFavorite: false,
      portForwards: [],
      createdAt: 0,
      updatedAt: roundIndex + 1,
    }
    request.expectedJumpHostKey = ssh.jump.expectedHostKey
  }
  return request
}
