/**
 * Port Forward Types
 * 端口转发相关类型定义
 */

import type { PortForwardType } from '@/types'

/** 端口转发配置 (传递给后端) */
export interface PortForwardConfig {
  id: string
  name: string
  forward_type: PortForwardType
  local_host: string
  local_port: number
  remote_host: string
  remote_port: number
}

/** 端口转发信息 */
export interface PortForwardInfo {
  id: string
  name: string
  type: PortForwardType
  localHost: string
  localPort: number
  remoteHost: string
  remotePort: number
  active: boolean
}

/** 端口转发结果 */
export interface PortForwardResult {
  success: boolean
  message?: string
}
