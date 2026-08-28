/**
 * Serial Service
 * 串口通信服务
 */

import type { UnlistenFn } from '@tauri-apps/api/event'
import type { ShellOutput ,
  SerialPortInfo,
  SerialConfig,
  SerialConnectionResult,
} from '@/features/terminal/types'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export type {
  SerialPortInfo,
  SerialConfig,
  SerialConnectionResult,
}

export class SerialService {
  /**
   * 列出可用串口
   */
  async listPorts() {
    try {
      return await invoke<SerialPortInfo[]>('serial_list')
    } catch (error) {
      console.error('Failed to list serial ports:', error)
      return []
    }
  }

  /**
   * 获取常用波特率
   */
  async getBaudRates() {
    try {
      return await invoke<number[]>('serial_baud_rates')
    } catch (error) {
      console.error('Failed to get baud rates:', error)
      return [9600, 115200, 57600, 38400, 19200, 4800, 2400, 1200, 300]
    }
  }

  /**
   * 连接到串口
   */
  async connect(config: SerialConfig): Promise<SerialConnectionResult> {
    try {
      const sessionId = await invoke<string>('serial_connect', {
        name: config.name,
        baudRate: config.baudRate,
        dataBits: config.dataBits,
        stopBits: config.stopBits,
        parity: config.parity,
        flowControl: config.flowControl,
      })
      return { success: true, message: 'Connected successfully', sessionId }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * 写入数据 (添加 CR)
   */
  async write(sessionId: string, data: string): Promise<void> {
    await invoke('serial_write', { sessionId, data })
  }

  /**
   * 写入原始数据 (不添加 CR)
   */
  async writeRaw(sessionId: string, data: Uint8Array): Promise<void> {
    await invoke('serial_write_raw', { sessionId, data })
  }

  /**
   * 检查串口是否已连接
   */
  async isConnected(sessionId: string): Promise<boolean> {
    try {
      return await invoke<boolean>('serial_is_connected', { sessionId })
    } catch {
      return false
    }
  }

  /**
   * 断开连接
   */
  async disconnect(sessionId: string): Promise<void> {
    await invoke('serial_disconnect', { sessionId })
  }

  /**
   * 监听串口数据事件
   */
  async onData(callback: (output: ShellOutput) => void): Promise<UnlistenFn> {
    return listen<ShellOutput>('serial-data', event => {
      callback(event.payload)
    })
  }

  /**
   * 监听串口关闭事件
   */
  async onClose(callback: (sessionId: string) => void): Promise<UnlistenFn> {
    return listen<string>('serial-close', event => {
      callback(event.payload)
    })
  }
}

export const serialService = new SerialService()
