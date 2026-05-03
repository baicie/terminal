/**
 * Terminal Feature Types
 * 统一导出所有终端相关的类型
 */

// Session types
export type {
  SessionInfo,
  ShellOutput,
  ConnectionResult,
  LocalSessionOptions,
  SshPasswordOptions,
  SshKeyOptions,
  JumpHostConfig,
  SshJumpOptions,
  SessionStatus,
  TabType,
} from './session'

// SFTP types
export type { SftpFile, SftpListResult, SftpOperationResult, SftpProgressCallback, SftpChecksumResult } from './sftp'

// Serial types
export type {
  SerialPortInfo,
  SerialConfig,
  SerialConnectionResult,
  SerialDataCallback,
  SerialCloseCallback,
} from './serial'

export { COMMON_BAUD_RATES, DATA_BITS_OPTIONS, STOP_BITS_OPTIONS, PARITY_OPTIONS, FLOW_CONTROL_OPTIONS } from './serial'

// Port forward types
export type { PortForwardConfig, PortForwardInfo, PortForwardResult } from './port-forward'

// Terminal settings types
export type { CursorStyle, TerminalSettings } from './terminal-settings'

export { DEFAULT_TERMINAL_SETTINGS } from './terminal-settings'
export { getThemeColors, themeDisplayNames } from '@/utils/terminal-themes'
export type { TerminalThemeColors } from '@/service/database'
