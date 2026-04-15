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
  modified_time: number
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
