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
import type { SessionInfo, ShellOutput } from '@/features/terminal/types'

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
    jumpHost: { host: string; port: number; username: string; authType: 'password' | 'key'; password?: string; privateKey?: string },
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
    _keyType: 'ed25519' | 'rsa' | 'rsa4096' | 'ecdsa' | 'ecdsa-nistp256' | 'ecdsa-nistp384' | 'ecdsa-nistp521',
    _comment: string,
    _passphrase?: string,
  ): Promise<{ private_key: string; public_key: string; key_type: string; fingerprint: string }> {
    // This would need Tauri backend implementation for actual key generation
    // For now, return a placeholder that indicates this needs implementation
    throw new Error('SSH key generation not yet implemented - requires Tauri backend')
  }

  // Execute a command on a host (opens a session, runs command, returns output)
  async execute(host: Host, command: string): Promise<SSHOutput> {
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

    // Write the command
    await sessionService.write(sessionId, command + '\n')

    // Wait for output - simplified, real implementation would need proper buffering
    return new Promise<SSHOutput>((resolve) => {
      let stdout = ''
      let stderr = ''
      let unsub: (() => void) | undefined
      let resolved = false

      const doResolve = (out: SSHOutput) => {
        if (!resolved) {
          resolved = true
          resolve(out)
        }
      }

      const timeout = setTimeout(() => {
        cleanup()
        doResolve({ stdout, stderr, exitCode: 0 })
      }, 5000) // 5 second timeout

      const handleOutput = (output: ShellOutput) => {
        if (output.session_id === sessionId) {
          if (output.is_stderr) {
            stderr += output.data
          } else {
            stdout += output.data
          }
          // Simple heuristic: if we get prompt back, command completed
          if (stdout.includes('$') || stdout.includes('#')) {
            cleanup()
            doResolve({ stdout, stderr, exitCode: 0 })
          }
        }
      }

      // Set up listener
      sessionService.onData(handleOutput)
        .then((unlisten) => {
          unsub = unlisten
        })
        .catch(() => {
          clearTimeout(timeout)
          doResolve({ stdout, stderr, exitCode: 0 })
        })

      const cleanup = () => {
        clearTimeout(timeout)
        unsub?.()
        sessionService.close(sessionId).catch(() => {})
      }
    })
  }

  // Command history (placeholder - needs database service)
  async saveCommandHistory(_hostId: string, _command: string, _sessionId?: string) {
    // TODO: Implement with database service
    console.log('[SSH] saveCommandHistory called (not implemented)')
  }
}

export const sshService = new SSHServiceLegacy()

// Re-export SSHService for backward compatibility
export { SSHServiceLegacy as SSHService }
