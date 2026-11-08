/**
 * SFTP Types
 * SFTP 文件传输相关类型定义
 */

/** SFTP 文件项 */
export interface SftpFile {
  name: string
  path: string
  is_directory: boolean
  size: number
  /** Epoch seconds, or null when the server did not report an mtime. */
  modified_time: number | null
  permissions: string
}

/** SFTP 列表结果 */
export interface SftpListResult {
  success: boolean
  files?: SftpFile[]
  message?: string
}

/** SFTP 操作结果 */
export interface SftpOperationResult {
  success: boolean
  message?: string
}

/** SFTP 传输进度回调 */
export type SftpProgressCallback = (transferred: number, total: number) => void

/** Checksum 算法 */
export type ChecksumAlgorithm = 'sha256'

/** Checksum 计算结果 */
export interface SftpChecksumResult {
  success: boolean
  algorithm: ChecksumAlgorithm
  hash?: string
  message?: string
}

/** 传输记录的 checksum 状态 */
export interface TransferChecksum {
  algorithm: ChecksumAlgorithm
  localHash?: string
  remoteHash?: string
  /** 'pending' | 'computing' | 'done' | 'error' */
  status: 'pending' | 'computing' | 'done' | 'error'
  error?: string
}
