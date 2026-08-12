import { invoke } from '@tauri-apps/api/core'
import type { Host } from '@/types'
import type { TabType } from '../types'

export async function startTerminalShell(
  tabType: TabType,
  host: Host | undefined,
  serialSessionId: string | undefined,
  cols: number,
  rows: number,
  jumpHost?: Host,
): Promise<string> {
  if (tabType === 'local') {
    return invoke<string>('session_create_local', { cols, rows })
  }

  if (tabType === 'remote') {
    if (!host) throw new Error('Host info required for remote connection')
    if (host.jumpHostId) {
      if (!jumpHost || jumpHost.id !== host.jumpHostId) {
        throw new Error('Configured jump host could not be resolved')
      }
      const jumpAuthType = host.jumpHostAuthType ?? jumpHost.authType
      if (host.authType === 'cert' || jumpAuthType === 'cert') {
        throw new Error(
          'Certificate authentication through a jump host is not supported yet',
        )
      }
      return invoke<string>('session_create_ssh_jump', {
        targetHost: host.hostname,
        targetPort: host.port,
        targetUsername: host.username,
        targetPassword: host.password ?? null,
        targetPrivateKey: host.privateKey ?? null,
        jumpHost: {
          host: jumpHost.hostname,
          port: jumpHost.port,
          username: jumpHost.username,
          authType: jumpAuthType,
          password: jumpHost.password ?? null,
          privateKey: jumpHost.privateKey ?? null,
          certificate: jumpHost.certificate ?? null,
          targetAuthType: host.authType,
        },
        cols,
        rows,
      })
    }

    const base = {
      host: host.hostname,
      port: host.port,
      username: host.username,
      cols,
      rows,
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
