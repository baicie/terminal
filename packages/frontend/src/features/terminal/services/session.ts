/** 会话管理服务 - 统一管理本地/SSH 会话。 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  ConnectionResult,
  LocalSessionOptions,
  SessionInfo,
  ShellOutput,
  SshAgentOptions,
  SshCertOptions,
  SshJumpOptions,
  SshKeyOptions,
  SshPasswordOptions,
} from '../types'
import {
  finishConnectionLog,
  recordConnectionFailure,
  recordConnectionSuccess,
} from './session-connection-logs'

/** 会话服务 */
export class SessionService {
  async createLocal(
    options: LocalSessionOptions = {},
  ): Promise<ConnectionResult> {
    const { cols = 80, rows = 24, hostInfo } = options
    try {
      const sessionId = await invoke<string>('session_create_local', {
        cols,
        rows,
      })
      if (hostInfo)
        await recordConnectionSuccess(sessionId, hostInfo, 'local', {
          hostname: 'localhost',
          username: 'local',
        })
      return { success: true, message: 'Local session created', sessionId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void recordConnectionFailure(
        hostInfo ?? { name: 'Local', hostname: 'localhost', username: 'local' },
        'local',
        message,
      )
      return { success: false, message }
    }
  }

  async createSshPassword(
    options: SshPasswordOptions,
  ): Promise<ConnectionResult> {
    const { host, cols = 80, rows = 24 } = options
    try {
      const sessionId = await invoke<string>('session_create_ssh_password', {
        host: host.hostname,
        port: host.port,
        username: host.username,
        password: host.password,
        agentForwarding: host.agentForwarding ?? false,
        cols,
        rows,
      })
      await recordConnectionSuccess(sessionId, host, 'ssh', {
        hostname: host.hostname,
        username: host.username,
      })
      return { success: true, message: 'SSH session created', sessionId }
    } catch (error) {
      return this.sshFailure(host, error)
    }
  }

  async createSshKey(options: SshKeyOptions): Promise<ConnectionResult> {
    const { host, cols = 80, rows = 24 } = options
    try {
      const sessionId = await invoke<string>('session_create_ssh_key', {
        host: host.hostname,
        port: host.port,
        username: host.username,
        privateKey: host.privateKey,
        password: host.password,
        agentForwarding: host.agentForwarding ?? false,
        cols,
        rows,
      })
      await recordConnectionSuccess(sessionId, host, 'ssh', {
        hostname: host.hostname,
        username: host.username,
      })
      return { success: true, message: 'SSH session created', sessionId }
    } catch (error) {
      return this.sshFailure(host, error)
    }
  }

  async createSshCert(options: SshCertOptions): Promise<ConnectionResult> {
    const { host, cols = 80, rows = 24 } = options
    try {
      const sessionId = await invoke<string>('session_create_ssh_cert', {
        host: host.hostname,
        port: host.port,
        username: host.username,
        certificate: host.certificate ?? '',
        privateKey: host.privateKey ?? '',
        password: host.password ?? null,
        agentForwarding: host.agentForwarding ?? false,
        cols,
        rows,
      })
      await recordConnectionSuccess(sessionId, host, 'ssh', {
        hostname: host.hostname,
        username: host.username,
      })
      return { success: true, message: 'SSH session created', sessionId }
    } catch (error) {
      return this.sshFailure(host, error)
    }
  }

  async createSshAgent(options: SshAgentOptions): Promise<ConnectionResult> {
    const { host, cols = 80, rows = 24 } = options
    try {
      const sessionId = await invoke<string>('session_create_ssh_agent', {
        host: host.hostname,
        port: host.port,
        username: host.username,
        agentForwarding: host.agentForwarding ?? false,
        cols,
        rows,
      })
      await recordConnectionSuccess(sessionId, host, 'ssh', {
        hostname: host.hostname,
        username: host.username,
      })
      return { success: true, message: 'SSH session created', sessionId }
    } catch (error) {
      return this.sshFailure(host, error)
    }
  }

  async createSshJump(options: SshJumpOptions): Promise<ConnectionResult> {
    const { targetHost, jumpHost, cols = 80, rows = 24 } = options
    try {
      const sessionId = await invoke<string>('session_create_ssh_jump', {
        targetHost: targetHost.hostname,
        targetPort: targetHost.port,
        targetUsername: targetHost.username,
        targetPassword: targetHost.password,
        targetPrivateKey: targetHost.privateKey,
        targetCertificate:
          targetHost.authType === 'cert' ? targetHost.certificate : undefined,
        agentForwarding: targetHost.agentForwarding ?? false,
        jumpHost: {
          ...jumpHost,
          targetAuthType: jumpHost.targetAuthType ?? targetHost.authType,
        },
        cols,
        rows,
      })
      await recordConnectionSuccess(
        sessionId,
        {
          ...targetHost,
          hostname: `${targetHost.hostname} (via ${jumpHost.host})`,
        },
        'ssh',
        { hostname: targetHost.hostname, username: targetHost.username },
      )
      return {
        success: true,
        message: 'SSH session via jump host created',
        sessionId,
      }
    } catch (error) {
      return this.sshFailure(targetHost, error)
    }
  }

  async write(sessionId: string, data: string): Promise<void> {
    await invoke('session_write', { sessionId, data })
  }
  async writeRaw(sessionId: string, data: Uint8Array): Promise<void> {
    await invoke('session_write_raw', { sessionId, data })
  }
  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await invoke('session_resize', { sessionId, cols, rows })
  }
  async ackOutput(sessionId: string, bytes: number): Promise<void> {
    await invoke('session_ack_output', { sessionId, bytes })
  }
  async close(sessionId: string): Promise<void> {
    await invoke('session_close', { sessionId })
    await finishConnectionLog(sessionId)
  }

  async list(): Promise<SessionInfo[]> {
    try {
      return await invoke<SessionInfo[]>('session_list')
    } catch (error) {
      console.error('Failed to list sessions:', error)
      return []
    }
  }

  async onData(callback: (output: ShellOutput) => void): Promise<UnlistenFn> {
    return listen<ShellOutput>('ssh-data', event => callback(event.payload))
  }
  async onClose(callback: (sessionId: string) => void): Promise<UnlistenFn> {
    return listen<string>('ssh-close', event => callback(event.payload))
  }
  async onExit(
    callback: (sessionId: string, exitCode: number) => void,
  ): Promise<UnlistenFn> {
    return listen<[string, number]>('ssh-exit', event =>
      callback(event.payload[0], event.payload[1]),
    )
  }
  async onLocalData(
    callback: (output: ShellOutput) => void,
  ): Promise<UnlistenFn> {
    return listen<ShellOutput>('local-data', event => callback(event.payload))
  }
  async onLocalClose(
    callback: (sessionId: string) => void,
  ): Promise<UnlistenFn> {
    return listen<string>('local-close', event => callback(event.payload))
  }

  private sshFailure(
    host: SshPasswordOptions['host'],
    error: unknown,
  ): ConnectionResult {
    const message = error instanceof Error ? error.message : String(error)
    void recordConnectionFailure(
      {
        id: host.id,
        name: host.name,
        hostname: host.hostname,
        username: host.username,
      },
      'ssh',
      message,
    )
    return { success: false, message }
  }
}

/** 会话服务单例 */
export const sessionService = new SessionService()
