import type { Terminal as XTerminal } from '@baicie/xterm'
import { invoke } from '@tauri-apps/api/core'
import type { Host } from '@/types'
import type { UseTerminalOptions } from './terminal-session-types'

export function formatIpcError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    if (typeof record.message === 'string' && record.message.length > 0) {
      return record.message
    }
    const kind = record.type ?? record.kind
    if (typeof kind === 'string' && kind.length > 0) return kind
    try {
      return JSON.stringify(record)
    } catch {
      return 'Unknown IPC error'
    }
  }
  return String(error)
}

export function sanitizeTerminalOutput(data: string): string {
  return (
    data
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*m%\x1b\[[0-9;]*m+\r?\n/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*m%\r?\n/g, '')
      .replace(/^%\r?\n/gm, '')
  )
}

export function setupWebKitInputCompensation(
  term: XTerminal,
  send: (data: string) => void,
): () => void {
  if (typeof navigator === 'undefined') return () => {}
  const userAgent = navigator.userAgent
  const isWebKit =
    /AppleWebKit/i.test(userAgent) && !/Chrome|Chromium|Edg/i.test(userAgent)
  if (!isWebKit) return () => {}

  const root = term.element as HTMLElement | undefined
  const textarea = root?.querySelector('textarea') as HTMLTextAreaElement | null
  if (!textarea) return () => {}

  let recentSent = ''
  const recordSent = (data: string) => {
    recentSent = (recentSent + data).slice(-32)
  }
  const onDataDisposable = term.onData(recordSent)
  const onInput = (event: Event) => {
    const inputData = (event as InputEvent).data
    if (!inputData) return
    requestAnimationFrame(() => {
      if (recentSent.endsWith(inputData)) return
      send(inputData)
      recordSent(inputData)
    })
  }
  textarea.addEventListener('input', onInput)
  return () => {
    textarea.removeEventListener('input', onInput)
    onDataDisposable.dispose()
  }
}

export async function startTerminalShell(
  tabType: UseTerminalOptions['tabType'],
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
