/**
 * Session Service
 * 会话管理服务 - 统一管理本地/SSH 会话
 */

import type {
  ConnectionResult,
  LocalSessionOptions,
  SshPasswordOptions,
  SshKeyOptions,
  SshCertOptions,
  SshJumpOptions,
  SessionInfo,
  ShellOutput,
} from '../types'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  addConnectionLog,
  updateConnectionLog,
} from '@/service/database'
import type { UnlistenFn } from '@tauri-apps/api/event'

// Active connection log tracking
const activeConnectionLogs = new Map<string, { logId: string; startTime: number }>()

/**
 * 记录连接失败
 * 注意：error_message 存未翻译的英文描述（供 UI 翻译），error_raw 存原始错误
 */
async function recordConnectionFailure(
  hostInfo: { id?: string; name: string; hostname?: string; username?: string },
  connectionType: 'ssh' | 'local' | 'serial',
  errorMessage: string,
): Promise<string | null> {
  try {
    const logId = await addConnectionLog({
      host_id: hostInfo.id || null,
      host_name: hostInfo.name,
      host_address: hostInfo.hostname ?? 'unknown',
      username: hostInfo.username || null,
      connection_type: connectionType,
      started_at: Date.now(),
      ended_at: Date.now(),
      duration_seconds: 0,
      is_saved: 0,
      notes: null,
      // error_message: 英文可读描述（供 UI 翻译为 locale）
      // error_raw: 原始错误完整信息
      error_message: normalizeErrorMessage(errorMessage),
      error_raw: errorMessage,
    })
    return logId
  } catch (err) {
    console.error('[Session] Failed to record connection failure:', err)
    return null
  }
}

/**
 * 归一化错误消息为英文可读描述
 * 与 readable-error.ts 逻辑保持一致，但不使用 i18n
 */
function normalizeErrorMessage(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('no ssh agent pipe found')) {
    return 'SSH agent socket not found'
  }
  if (m.includes('ssh_auth_sock points') && m.includes('pipe was not found')) {
    return 'SSH agent socket path is invalid'
  }
  if (m.includes('permission denied when opening ssh agent pipe')) {
    return 'Permission denied when opening SSH agent socket'
  }
  if (m.includes('ssh agent has no available identities')) {
    return 'SSH agent has no available identities'
  }
  if (m.includes('all ssh agent identities rejected')) {
    return 'All SSH agent identities were rejected'
  }
  if (m.includes('failed to read identities from ssh agent')) {
    return 'Failed to read identities from SSH agent'
  }
  return msg
}

/** 会话服务 */
export class SessionService {
  // ========================================================================
  // Session Creation
  // ========================================================================

  /**
   * 创建本地 shell 会话
   */
  async createLocal(options: LocalSessionOptions = {}): Promise<ConnectionResult> {
    const { cols = 80, rows = 24, hostInfo } = options

    try {
      const sessionId = await invoke<string>('session_create_local', { cols, rows })

      // 记录连接日志
      if (hostInfo) {
        const logId = await addConnectionLog({
          host_id: hostInfo.id || null,
          host_name: hostInfo.name,
          host_address: hostInfo.hostname || 'localhost',
          username: hostInfo.username || 'local',
          connection_type: 'local',
          started_at: Date.now(),
          ended_at: null,
          duration_seconds: null,
          is_saved: 0,
          notes: null,
          error_message: null,
          error_raw: null,
        })
        activeConnectionLogs.set(sessionId, { logId, startTime: Date.now() })
      }

      return { success: true, message: 'Local session created', sessionId }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      void recordConnectionFailure(
        hostInfo ?? { name: 'Local', hostname: 'localhost', username: 'local' },
        'local',
        msg,
      )
      return { success: false, message: msg }
    }
  }

  /**
   * 创建 SSH 会话 (密码认证)
   */
  async createSshPassword(options: SshPasswordOptions): Promise<ConnectionResult> {
    const { host, cols = 80, rows = 24 } = options

    try {
      const sessionId = await invoke<string>('session_create_ssh_password', {
        host: host.hostname,
        port: host.port,
        username: host.username,
        password: host.password,
        cols,
        rows,
      })

      // 记录连接日志
      const logId = await addConnectionLog({
        host_id: host.id || null,
        host_name: host.name,
        host_address: host.hostname,
        username: host.username,
        connection_type: 'ssh',
        started_at: Date.now(),
        ended_at: null,
        duration_seconds: null,
        is_saved: 0,
        notes: null,
        error_message: null,
        error_raw: null,
      })
      activeConnectionLogs.set(sessionId, { logId, startTime: Date.now() })

      return { success: true, message: 'SSH session created', sessionId }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      void recordConnectionFailure(
        { id: host.id, name: host.name, hostname: host.hostname, username: host.username },
        'ssh',
        msg,
      )
      return { success: false, message: msg }
    }
  }

  /**
   * 创建 SSH 会话 (密钥认证)
   */
  async createSshKey(options: SshKeyOptions): Promise<ConnectionResult> {
    const { host, cols = 80, rows = 24 } = options

    try {
      const sessionId = await invoke<string>('session_create_ssh_key', {
        host: host.hostname,
        port: host.port,
        username: host.username,
        privateKey: host.privateKey,
        password: host.password,
        cols,
        rows,
      })

      // 记录连接日志
      const logId = await addConnectionLog({
        host_id: host.id || null,
        host_name: host.name,
        host_address: host.hostname,
        username: host.username,
        connection_type: 'ssh',
        started_at: Date.now(),
        ended_at: null,
        duration_seconds: null,
        is_saved: 0,
        notes: null,
        error_message: null,
        error_raw: null,
      })
      activeConnectionLogs.set(sessionId, { logId, startTime: Date.now() })

      return { success: true, message: 'SSH session created', sessionId }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      void recordConnectionFailure(
        { id: host.id, name: host.name, hostname: host.hostname, username: host.username },
        'ssh',
        msg,
      )
      return { success: false, message: msg }
    }
  }

  /**
   * 创建 SSH 会话 (证书认证)
   */
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
        cols,
        rows,
      })

      const logId = await addConnectionLog({
        host_id: host.id || null,
        host_name: host.name,
        host_address: host.hostname,
        username: host.username,
        connection_type: 'ssh',
        started_at: Date.now(),
        ended_at: null,
        duration_seconds: null,
        is_saved: 0,
        notes: null,
        error_message: null,
        error_raw: null,
      })
      activeConnectionLogs.set(sessionId, { logId, startTime: Date.now() })

      return { success: true, message: 'SSH session created', sessionId }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      void recordConnectionFailure(
        { id: host.id, name: host.name, hostname: host.hostname, username: host.username },
        'ssh',
        msg,
      )
      return { success: false, message: msg }
    }
  }

  /**
   * 创建 SSH 会话 (跳板机)
   */
  async createSshJump(options: SshJumpOptions): Promise<ConnectionResult> {
    const { targetHost, jumpHost, cols = 80, rows = 24 } = options

    try {
      const sessionId = await invoke<string>('session_create_ssh_jump', {
        targetHost: targetHost.hostname,
        targetPort: targetHost.port,
        targetUsername: targetHost.username,
        targetPassword: targetHost.password,
        targetPrivateKey: targetHost.privateKey,
        jumpHost: {
          ...jumpHost,
          targetAuthType: jumpHost.targetAuthType ?? targetHost.authType,
        },
        cols,
        rows,
      })

      // 记录连接日志
      const logId = await addConnectionLog({
        host_id: targetHost.id || null,
        host_name: targetHost.name,
        host_address: `${targetHost.hostname} (via ${jumpHost.host})`,
        username: targetHost.username,
        connection_type: 'ssh',
        started_at: Date.now(),
        ended_at: null,
        duration_seconds: null,
        is_saved: 0,
        notes: null,
        error_message: null,
        error_raw: null,
      })
      activeConnectionLogs.set(sessionId, { logId, startTime: Date.now() })

      return { success: true, message: 'SSH session via jump host created', sessionId }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      void recordConnectionFailure(
        { id: targetHost.id, name: targetHost.name, hostname: targetHost.hostname, username: targetHost.username },
        'ssh',
        msg,
      )
      return { success: false, message: msg }
    }
  }

  // ========================================================================
  // Session Operations
  // ========================================================================

  /**
   * 写入数据到会话
   */
  async write(sessionId: string, data: string): Promise<void> {
    await invoke('session_write', { sessionId, data })
  }

  /**
   * 调整会话大小
   */
  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await invoke('session_resize', { sessionId, cols, rows })
  }

  /**
   * 关闭会话
   */
  async close(sessionId: string): Promise<void> {
    await invoke('session_close', { sessionId })

    // 更新连接日志
    const logInfo = activeConnectionLogs.get(sessionId)
    if (logInfo) {
      const endTime = Date.now()
      const durationSeconds = Math.round((endTime - logInfo.startTime) / 1000)
      try {
        await updateConnectionLog(logInfo.logId, {
          ended_at: endTime,
          duration_seconds: durationSeconds,
        })
      } catch (error) {
        console.error('[Session] Failed to update connection log:', error)
      }
      activeConnectionLogs.delete(sessionId)
    }
  }

  /**
   * 列出所有活跃会话
   */
  async list(): Promise<SessionInfo[]> {
    try {
      return await invoke<SessionInfo[]>('session_list')
    } catch (error) {
      console.error('Failed to list sessions:', error)
      return []
    }
  }

  // ========================================================================
  // Event Listeners
  // ========================================================================

  /**
   * 监听 SSH 数据事件
   */
  async onData(callback: (output: ShellOutput) => void): Promise<UnlistenFn> {
    return listen<ShellOutput>('ssh-data', event => {
      callback(event.payload)
    })
  }

  /**
   * 监听 SSH 会话关闭事件
   */
  async onClose(callback: (sessionId: string) => void): Promise<UnlistenFn> {
    return listen<string>('ssh-close', event => {
      callback(event.payload)
    })
  }

  /**
   * 监听 SSH 退出事件
   */
  async onExit(callback: (sessionId: string, exitCode: number) => void): Promise<UnlistenFn> {
    return listen<[string, number]>('ssh-exit', event => {
      const [sessionId, exitCode] = event.payload
      callback(sessionId, exitCode)
    })
  }

  /**
   * 监听本地会话数据事件
   */
  async onLocalData(callback: (output: ShellOutput) => void): Promise<UnlistenFn> {
    return listen<ShellOutput>('local-data', event => {
      callback(event.payload)
    })
  }

  /**
   * 监听本地会话关闭事件
   */
  async onLocalClose(callback: (sessionId: string) => void): Promise<UnlistenFn> {
    return listen<string>('local-close', event => {
      callback(event.payload)
    })
  }
}

/** 会话服务单例 */
export const sessionService = new SessionService()
