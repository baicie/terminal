/**
 * SSH Service - 兼容层
 *
 * 此文件已重构为使用 features/terminal/services/ 中的独立服务模块。
 * 保留此文件以保持向后兼容，新代码应直接使用新服务模块。
 *
 * @deprecated 请使用 features/terminal/services/ 中的对应服务
 */

import type { Host, PortForwardConfig } from '@/types'
import {
  sessionService,
  sftpService,
  portForwardService,
} from '@/features/terminal/services'
import type { SessionInfo } from '@/features/terminal/types'
import { invoke } from '@tauri-apps/api/core'

// Re-export types from new location
export type { SessionInfo, ShellOutput } from '@/features/terminal/types'

// Re-export SSH-specific types
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

export interface FileItem {
  name: string
  path: string
  is_directory: boolean
  size: number
  modified_time: number
  permissions: string
}

// Legacy SSHService wrapper for backward compatibility
// @deprecated Use sessionService, sftpService, portForwardService directly
class SSHServiceLegacy {
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
    return sessionService.createLocal({ cols, rows, hostInfo })
  }

  async createSshSessionPassword(host: Host, cols: number = 80, rows: number = 24): Promise<SSHConnectionResult> {
    return sessionService.createSshPassword({ host, cols, rows })
  }

  async createSshSessionKey(host: Host, cols: number = 80, rows: number = 24): Promise<SSHConnectionResult> {
    return sessionService.createSshKey({ host, cols, rows })
  }

  async createSshSessionJump(
    targetHost: Host,
    jumpHost: { host: string; port: number; username: string; authType: 'password' | 'key' | 'agent'; password?: string; privateKey?: string; targetAuthType?: 'password' | 'key' | 'agent' },
    cols: number = 80,
    rows: number = 24,
  ): Promise<SSHConnectionResult> {
    return sessionService.createSshJump({ targetHost, jumpHost, cols, rows })
  }

  async write(sessionId: string, data: string): Promise<void> {
    return sessionService.write(sessionId, data)
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    return sessionService.resize(sessionId, cols, rows)
  }

  async close(sessionId: string): Promise<void> {
    return sessionService.close(sessionId)
  }

  async listSessions(): Promise<SessionInfo[]> {
    return sessionService.list()
  }

  async onData(callback: (output: ShellOutput) => void) {
    return sessionService.onData(callback)
  }

  async onClose(callback: (sessionId: string) => void) {
    return sessionService.onClose(callback)
  }

  async onExit(callback: (sessionId: string, exitCode: number) => void) {
    return sessionService.onExit(callback)
  }

  async onLocalData(callback: (output: ShellOutput) => void) {
    return sessionService.onLocalData(callback)
  }

  async onLocalClose(callback: (sessionId: string) => void) {
    return sessionService.onLocalClose(callback)
  }

  // SFTP methods
  async sftpConnect(sessionId: string) {
    return sftpService.connect(sessionId)
  }

  async sftpList(sessionId: string, path: string) {
    return sftpService.list(sessionId, path)
  }

  async sftpUpload(sessionId: string, localPath: string, remotePath: string) {
    return sftpService.upload(sessionId, localPath, remotePath)
  }

  async sftpDownload(sessionId: string, remotePath: string, localPath: string) {
    return sftpService.download(sessionId, remotePath, localPath)
  }

  async sftpMkdir(sessionId: string, path: string) {
    return sftpService.mkdir(sessionId, path)
  }

  async sftpDelete(sessionId: string, path: string, isDirectory: boolean) {
    return sftpService.delete(sessionId, path, isDirectory)
  }

  async sftpRename(sessionId: string, oldPath: string, newPath: string) {
    return sftpService.rename(sessionId, oldPath, newPath)
  }

  // Port forward methods
  async portForwardStart(sessionId: string, config: PortForwardConfig) {
    return portForwardService.start(sessionId, config)
  }

  async portForwardStop(forwardId: string) {
    return portForwardService.stop(forwardId)
  }

  async portForwardList() {
    return portForwardService.list()
  }

  // Generate SSH key pair
  async generateSSHKey(
    keyType: 'ed25519' | 'rsa' | 'rsa4096' | 'ecdsa' | 'ecdsa-nistp256' | 'ecdsa-nistp384' | 'ecdsa-nistp521',
    comment: string,
    passphrase?: string,
  ): Promise<{ private_key: string; public_key: string; key_type: string; fingerprint: string }> {
    const result = await invoke<{
      private_key: string
      public_key: string
      key_type: string
      fingerprint: string
    }>('key_generate', {
      keyType,
      comment,
      passphrase: passphrase || null,
    })
    return result
  }

  // Execute a command on a host — uses session_exec which opens a dedicated exec channel
  // rather than the PTY shell hack, so exit codes are captured correctly.
  async execute(host: Host, command: string, timeoutMs = 30000): Promise<SSHOutput> {
    // Create SSH session based on auth type
    let result: SSHConnectionResult
    if (host.authType === 'key' && host.privateKey) {
      result = await sessionService.createSshKey({ host, cols: 80, rows: 24 })
    } else {
      result = await sessionService.createSshPassword({ host, cols: 80, rows: 24 })
    }

    if (!result.success || !result.sessionId) {
      return { stdout: '', stderr: result.message, exitCode: 1 }
    }

    const sessionId = result.sessionId

    try {
      const execResult = await invoke<{ stdout: string; stderr: string; exit_code: number }>(
        'session_exec',
        {
          sessionId,
          command,
          timeoutMs,
        },
      )
      return {
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        exitCode: execResult.exit_code,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { stdout: '', stderr: msg, exitCode: 1 }
    } finally {
      // Clean up the temporary session
      sessionService.close(sessionId).catch(() => {})
    }
  }

  // Command history — forwards to the dedicated database service.
  async saveCommandHistory(hostId: string, command: string, sessionId?: string) {
    try {
      const { addCommandHistory } = await import('@/service/database')
      await addCommandHistory({
        host_id: hostId,
        command,
        executed_at: Date.now(),
        session_id: sessionId ?? undefined,
      })
    } catch (err) {
      console.warn('[SSH] Failed to save command history:', err)
    }
  }
}

export const sshService = new SSHServiceLegacy()

// Re-export SSHService for backward compatibility
export { SSHServiceLegacy as SSHService }
