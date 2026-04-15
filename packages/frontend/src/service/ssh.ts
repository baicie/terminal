import type { UnlistenFn } from '@tauri-apps/api/event'
import type { Host, PortForwardConfig } from '@/types'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  addCommandHistory,
  addConnectionLog,
  updateConnectionLog,
} from '@/service/database'

export interface SSHConnectionResult {
  success: boolean
  message: string
  sessionId?: string
}

export interface SSHOutput {
  stdout: string
  stderr: string
  exitCode: number
}

export interface ShellOutput {
  session_id: string
  data: string
  is_stderr: boolean
}

export interface SessionInfo {
  id: string
  session_type: 'local' | 'ssh'
  is_alive: boolean
  created_at: number
}

// Active connection log tracking
const activeConnectionLogs = new Map<
  string,
  { logId: string; startTime: number }
>()

export class SSHService {
  // ========================================================================
  // Unified Session API
  // ========================================================================

  /**
   * Create a local shell session
   */
  async createLocalSession(
    cols: number = 80,
    rows: number = 24,
    hostInfo?: {
      id?: string
      name: string
      hostname?: string
      username?: string
    },
  ): Promise<SSHConnectionResult> {
    try {
      const sessionId = await invoke<string>('session_create_local', { cols, rows })

      // Record connection log
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
   * Create an SSH session with password authentication
   */
  async createSshSessionPassword(
    host: Host,
    cols: number = 80,
    rows: number = 24,
  ): Promise<SSHConnectionResult> {
    try {
      const sessionId = await invoke<string>('session_create_ssh_password', {
        host: host.hostname,
        port: host.port,
        username: host.username,
        password: host.password,
        cols,
        rows,
      })

      // Record connection log
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
   * Create an SSH session with key authentication
   */
  async createSshSessionKey(
    host: Host,
    cols: number = 80,
    rows: number = 24,
  ): Promise<SSHConnectionResult> {
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

      // Record connection log
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
   * Create an SSH session via jump host
   */
  async createSshSessionJump(
    targetHost: Host,
    jumpHost: {
      host: string
      port: number
      username: string
      authType: 'password' | 'key'
      password?: string
      privateKey?: string
    },
    cols: number = 80,
    rows: number = 24,
  ): Promise<SSHConnectionResult> {
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

      // Record connection log
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

  /**
   * Write data to a session (unified for local and SSH)
   */
  async write(sessionId: string, data: string): Promise<void> {
    await invoke('session_write', { sessionId, data })
  }

  /**
   * Resize a session (unified for local and SSH)
   */
  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await invoke('session_resize', { sessionId, cols, rows })
  }

  /**
   * Close a session (unified for local and SSH)
   */
  async close(sessionId: string): Promise<void> {
    await invoke('session_close', { sessionId })

    // Update connection log with end time
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
        console.error('[SSH] Failed to update connection log:', error)
      }
      activeConnectionLogs.delete(sessionId)
    }
  }

  /**
   * List all active sessions
   */
  async listSessions(): Promise<SessionInfo[]> {
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
   * Listen for SSH data events
   */
  async onData(callback: (output: ShellOutput) => void): Promise<UnlistenFn> {
    return listen<ShellOutput>('ssh-data', event => {
      callback(event.payload)
    })
  }

  /**
   * Listen for SSH session close events
   */
  async onClose(callback: (sessionId: string) => void): Promise<UnlistenFn> {
    return listen<string>('ssh-close', event => {
      callback(event.payload)
    })
  }

  /**
   * Listen for SSH exit events
   */
  async onExit(
    callback: (sessionId: string, exitCode: number) => void,
  ): Promise<UnlistenFn> {
    return listen<[string, number]>('ssh-exit', event => {
      const [sessionId, exitCode] = event.payload
      callback(sessionId, exitCode)
    })
  }

  /**
   * Listen for local session data events
   */
  async onLocalData(
    callback: (output: ShellOutput) => void,
  ): Promise<UnlistenFn> {
    return listen<ShellOutput>('local-data', event => {
      callback(event.payload)
    })
  }

  /**
   * Listen for local session close events
   */
  async onLocalClose(
    callback: (sessionId: string) => void,
  ): Promise<UnlistenFn> {
    return listen<string>('local-close', event => {
      callback(event.payload)
    })
  }

  // ========================================================================
  // SFTP Methods
  // ========================================================================

  async sftpConnect(
    sessionId: string,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      await invoke('sftp_connect', { sessionId })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async sftpList(
    sessionId: string,
    path: string,
  ): Promise<{ success: boolean; files?: FileItem[]; message?: string }> {
    try {
      const files = await invoke<FileItem[]>('sftp_list', { sessionId, path })
      return { success: true, files }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async sftpUpload(
    sessionId: string,
    localPath: string,
    remotePath: string,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      await invoke('sftp_upload', { sessionId, localPath, remotePath })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async sftpDownload(
    sessionId: string,
    remotePath: string,
    localPath: string,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      await invoke('sftp_download', { sessionId, remotePath, localPath })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async sftpMkdir(
    sessionId: string,
    path: string,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      await invoke('sftp_mkdir', { sessionId, path })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async sftpDelete(
    sessionId: string,
    path: string,
    isDirectory: boolean,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      await invoke('sftp_delete', { sessionId, path, isDirectory })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async sftpRename(
    sessionId: string,
    oldPath: string,
    newPath: string,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      await invoke('sftp_rename', { sessionId, oldPath, newPath })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // ========================================================================
  // Command History
  // ========================================================================

  async saveCommandHistory(
    hostId: string,
    command: string,
    sessionId?: string,
  ): Promise<void> {
    try {
      await addCommandHistory({
        host_id: hostId,
        command,
        executed_at: Date.now(),
        session_id: sessionId,
      })
    } catch (error) {
      console.error('Failed to save command history:', error)
    }
  }

  // ========================================================================
  // Port Forward Methods
  // ========================================================================

  async portForwardStart(
    sessionId: string,
    config: PortForwardConfig,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      await invoke('port_forward_start', { sessionId, config })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async portForwardStop(
    forwardId: string,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      await invoke('port_forward_stop', { forwardId })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async portForwardList(): Promise<string[]> {
    try {
      return await invoke<string[]>('port_forward_list')
    } catch (error) {
      console.error('Failed to list port forwards:', error)
      return []
    }
  }
}

export interface FileItem {
  name: string
  path: string
  is_directory: boolean
  size: number
  modified_time: number
  permissions: string
}

export const sshService = new SSHService()
