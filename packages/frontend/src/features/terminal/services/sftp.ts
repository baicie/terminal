/**
 * SFTP Service
 * SFTP 文件传输服务
 */

import type { SftpFile, SftpListResult, SftpOperationResult, SftpChecksumResult } from '../types'
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
   * 上传文件（legacy 一次性接口；不带进度）
   *
   * 推荐使用 `service/sftp-transfer.ts` 的 `uploadFile()`，可获得分块进度 + 队列管理。
   */
  async upload(sessionId: string, localPath: string, remotePath: string): Promise<SftpOperationResult> {
    try {
      const transferId = `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      await invoke('sftp_upload', { transferId, sessionId, localPath, remotePath })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * 下载文件（legacy 一次性接口；不带进度）
   */
  async download(sessionId: string, remotePath: string, localPath: string): Promise<SftpOperationResult> {
    try {
      const transferId = `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      await invoke('sftp_download', { transferId, sessionId, remotePath, localPath })
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

  // ========================================================================
  // Checksum
  // ========================================================================

  /**
   * 计算本地文件的 SHA-256 checksum。
   * 通过 Rust 端流式读取本地文件计算，避免加载整个文件到内存。
   */
  async checksumLocal(transferId: string, localPath: string): Promise<SftpChecksumResult> {
    try {
      const hash = await invoke<string>('sftp_local_checksum', { transferId, localPath })
      return { success: true, algorithm: 'sha256', hash }
    } catch (error) {
      return {
        success: false,
        algorithm: 'sha256',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * 计算远程文件的 SHA-256 checksum（SFTP 协议流式读取）。
   * 用于传输完成后与本地文件比对，验证完整性。
   */
  async checksumRemote(transferId: string, sessionId: string, remotePath: string): Promise<SftpChecksumResult> {
    try {
      const hash = await invoke<string>('sftp_remote_checksum', { transferId, sessionId, remotePath })
      return { success: true, algorithm: 'sha256', hash }
    } catch (error) {
      return {
        success: false,
        algorithm: 'sha256',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

/** SFTP 服务单例 */
export const sftpService = new SftpService()
