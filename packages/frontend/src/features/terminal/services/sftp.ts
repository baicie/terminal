/**
 * SFTP Service
 * SFTP 文件传输服务
 */

import type { SftpFile, SftpListResult, SftpOperationResult } from '../types'
import { invoke } from '@tauri-apps/api/core'

/** SFTP 服务 */
export class SftpService {
  // ========================================================================
  // Connection
  // ========================================================================

  /**
   * 连接到 SFTP 服务
   */
  async connect(sessionId: string): Promise<SftpOperationResult> {
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

  // ========================================================================
  // File Operations
  // ========================================================================

  /**
   * 列出目录内容
   */
  async list(sessionId: string, path: string): Promise<SftpListResult> {
    try {
      const files = await invoke<SftpFile[]>('sftp_list', { sessionId, path })
      return { success: true, files }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * 上传文件
   */
  async upload(sessionId: string, localPath: string, remotePath: string): Promise<SftpOperationResult> {
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

  /**
   * 下载文件
   */
  async download(sessionId: string, remotePath: string, localPath: string): Promise<SftpOperationResult> {
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

  /**
   * 创建目录
   */
  async mkdir(sessionId: string, path: string): Promise<SftpOperationResult> {
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

  /**
   * 删除文件或目录
   */
  async delete(sessionId: string, path: string, isDirectory: boolean): Promise<SftpOperationResult> {
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

  /**
   * 重命名文件或目录
   */
  async rename(sessionId: string, oldPath: string, newPath: string): Promise<SftpOperationResult> {
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
}

/** SFTP 服务单例 */
export const sftpService = new SftpService()
