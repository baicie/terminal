/**
 * Port Forward Service
 * 端口转发服务
 */

import type { PortForwardConfig, PortForwardResult } from '../types'
import { invoke } from '@tauri-apps/api/core'

/** 端口转发服务 */
export class PortForwardService {
  /**
   * 启动端口转发
   */
  async start(sessionId: string, config: PortForwardConfig): Promise<PortForwardResult> {
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

  /**
   * 停止端口转发
   */
  async stop(forwardId: string): Promise<PortForwardResult> {
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

  /**
   * 列出所有端口转发
   */
  async list(): Promise<string[]> {
    try {
      return await invoke<string[]>('port_forward_list')
    } catch (error) {
      console.error('Failed to list port forwards:', error)
      return []
    }
  }
}

/** 端口转发服务单例 */
export const portForwardService = new PortForwardService()
