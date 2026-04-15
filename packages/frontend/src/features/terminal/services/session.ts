/**
 * Session Service
 * 会话管理服务 - 统一管理本地/SSH 会话
 */

import type {
  ConnectionResult,
  LocalSessionOptions,
  SshPasswordOptions,
  SshKeyOptions,
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

// Active connection log tracking
const activeConnectionLogs = new Map<string, { logId: string; startTime: number }>()

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
        })
        activeConnectionLogs.set(sessionId, { logId, startTime: Date.now() })
      }

      return { success: true, message: 'Local session created', sessionId }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
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
      })
      activeConnectionLogs.set(sessionId, { logId, startTime: Date.now() })

      return { success: true, message: 'SSH session created', sessionId }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
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
      })
      activeConnectionLogs.set(sessionId, { logId, startTime: Date.now() })

      return { success: true, message: 'SSH session created', sessionId }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
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
        jumpHost,
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
      })
      activeConnectionLogs.set(sessionId, { logId, startTime: Date.now() })

      return { success: true, message: 'SSH session via jump host created', sessionId }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
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
