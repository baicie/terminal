/**
 * Serial Port Types
 * 串口通信相关类型定义
 */

import type { ShellOutput } from './session'

/** 串口信息 */
export interface SerialPortInfo {
  name: string
  port_type: string
}

/** 串口配置 */
export interface SerialConfig {
  name: string
  baudRate: number
  dataBits: number
  stopBits: number
  parity: string
  flowControl: string
}

/** 串口连接结果 */
export interface SerialConnectionResult {
  success: boolean
  message: string
  sessionId?: string
}

/** 常用波特率列表 */
export const COMMON_BAUD_RATES = [
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600,
] as const

/** 串口数据位选项 */
export const DATA_BITS_OPTIONS = [5, 6, 7, 8] as const

/** 串口停止位选项 */
export const STOP_BITS_OPTIONS = [1, 2] as const

/** 串口校验位选项 */
export const PARITY_OPTIONS = ['none', 'even', 'odd'] as const

/** 串口流控选项 */
export const FLOW_CONTROL_OPTIONS = ['none', 'hardware', 'software'] as const

/** 串口数据回调类型 */
export type SerialDataCallback = (output: ShellOutput) => void

/** 串口关闭回调类型 */
export type SerialCloseCallback = (sessionId: string) => void
