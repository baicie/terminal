/**
 * 数据库模块 - 向后兼容导出
 *
 * 所有数据库操作已拆分到 database/ 目录下的模块化文件中。
 * 此文件保留用于向后兼容，新代码应直接从 database/ 模块导入。
 *
 * @deprecated 请使用 @/service/database 模块
 */

// Re-export all database operations from the new modular structure
export * from './database'

// Re-export types
export type { Host as HostRecord } from '@/types'
