import { invoke } from '@tauri-apps/api/core'
import type { Host } from '@/types'
import type { TabType } from '../types'
import { buildSshJumpHostIpcConfig } from './ssh-jump-config'

function profileForHost(host: Host):
  | { startupCommand?: string; environment?: Record<string, string> }
  | undefined {
  const environment = host.environment
  const hasEnvironment = Boolean(environment && Object.keys(environment).length)
  const startupCommand = host.startupCommand?.trim()
  if (!hasEnvironment && !startupCommand) return undefined
  return {
    ...(startupCommand ? { startupCommand } : {}),
    ...(hasEnvironment ? { environment } : {}),
  }
}

export async function startTerminalShell(
  tabType: TabType,
  host: Host | undefined,
  serialSessionId: string | undefined,
  cols: number,
  rows: number,
  jumpHost?: Host,
  expectedHostKey?: string,
  expectedJumpHostKey?: string,
): Promise<string> {
  if (tabType === 'local') {
    return invoke<string>('session_create_local', { cols, rows })
  }

  if (tabType === 'remote') {
    if (!host) throw new Error('Host info required for remote connection')
    const profile = profileForHost(host)
    if (host.jumpHostId) {
      if (!jumpHost || jumpHost.id !== host.jumpHostId) {
        throw new Error('Configured jump host could not be resolved')
      }
      return invoke<string>('session_create_ssh_jump', {
        targetHost: host.hostname,
        targetPort: host.port,
        targetUsername: host.username,
        targetPassword: host.password ?? null,
        targetPrivateKey: host.privateKey ?? null,
        targetCertificate: host.authType === 'cert' ? (host.certificate ?? null) : null,
        agentForwarding: host.agentForwarding ?? false,
        ...(expectedHostKey === undefined ? {} : { expectedHostKey }),
        ...(profile ? { profile } : {}),
        jumpHost: buildSshJumpHostIpcConfig(
          host,
          jumpHost,
          expectedJumpHostKey,
        ),
        cols,
        rows,
      })
    }

    const base = {
      host: host.hostname,
      port: host.port,
      username: host.username,
      agentForwarding: host.agentForwarding ?? false,
      ...(expectedHostKey === undefined ? {} : { expectedHostKey }),
      cols,
      rows,
      ...(profile ? { profile } : {}),
    }
    if (host.authType === 'password') {
      return invoke<string>('session_create_ssh_password', {
        ...base,
        password: host.password,
      })
    }
    if (host.authType === 'key') {
      return invoke<string>('session_create_ssh_key', {
        ...base,
        privateKey: host.privateKey ?? '',
        password: host.password ?? null,
      })
    }
    if (host.authType === 'agent') {
      return invoke<string>('session_create_ssh_agent', base)
    }
    if (host.authType === 'cert') {
      return invoke<string>('session_create_ssh_cert', {
        ...base,
        certificate: host.certificate ?? '',
        privateKey: host.privateKey ?? '',
        password: host.password ?? null,
      })
    }
    throw new Error('Unsupported auth type: ' + host.authType)
  }

  if (tabType === 'serial') {
    if (!serialSessionId) throw new Error('Serial session ID required')
    return serialSessionId
  }

  throw new Error('Unknown tab type: ' + tabType)
}
