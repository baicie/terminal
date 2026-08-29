/**
 * 数据库类型定义
 * 集中管理所有数据库表的行类型
 */

// Host types
export interface HostRecord {
  id: string
  name: string
  hostname: string
  port: number
  username: string
  auth_type: string
  password: string | null
  private_key: string | null
  certificate: string | null
  group_id: string | null
  is_favorite: number
  color: string | null
  tags: string | null
  port_forwards: string | null
  startup_command: string | null
  environment: string | null
  jump_host_id: string | null
  jump_host_auth_type: string | null
  agent_forwarding: number | null
  created_at: number
  updated_at: number
}

export interface GroupRecord {
  id: string
  name: string
  parent_id: string | null
  color: string | null
  inherit_settings: number
  settings: string | null
  order: number
}

// Workspace types
export interface WorkspaceRecord {
  id: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  order: number
  is_active: number
  created_at: number
  updated_at: number
}

export interface WorkspaceLayoutRecord {
  workspace_id: string
  layout_data: string
}

// Command History types
export interface CommandHistoryRecord {
  id?: number
  host_id: string
  command: string
  executed_at: number
  session_id?: string
}

// Known Hosts types
export interface KnownHostRecord {
  id: string
  hostname: string
  port: number
  fingerprint: string
  key_type: string | null
  added_at: number
}

// Snippet types
export interface SnippetRecord {
  id: string
  name: string
  description?: string
  script: string
  package_id?: string
  tags?: string
  variables?: string
}

export interface SnippetPackageRecord {
  id: string
  name: string
  description?: string
}

// SSH Keys types
export interface SSHKeyRecord {
  id: string
  name: string
  key_type: string | null
  private_key: string | null
  public_key: string | null
  certificate: string | null
  passphrase: string | null
  is_encrypted: number
  created_at: number
  updated_at: number
}

// Settings types
export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  language: string
  fontSize: number
  fontFamily: string
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
  scrollback: number
  copyOnSelect: boolean
  pasteOnMiddleClick: boolean
  allowProposedApi: boolean
  dataStorageMode: 'local' | 'service'
  syncServiceType: 'webdav' | 's3' | 'custom'
  syncServiceEndpoint: string
  syncServiceUsername: string
  syncServiceToken: string
  syncServiceBucket?: string
  syncServiceRegion?: string
  // Terminal theme settings (per app theme)
  terminalTheme: TerminalThemePreset
  terminalThemeDark: TerminalThemePreset
  terminalThemeLight: TerminalThemePreset
  customPrompt?: string
  // Desktop UX (Tauri)
  /** 关闭窗口时最小化到托盘而非退出 */
  minimizeToTray?: boolean
  /** 启用原生 OS 通知（断连/任务完成时） */
  nativeNotifications?: boolean
  /** 仅在窗口失焦时弹原生通知（默认 true） */
  notifyOnlyWhenUnfocused?: boolean
}

// Terminal theme presets
export type TerminalThemePreset =
  | 'monokai'
  | 'solarized-dark'
  | 'solarized-light'
  | 'one-dark'
  | 'github-dark'
  | 'github-light'
  | 'dracula'
  | 'nord'
  | 'catppuccin'
  | 'gruvbox-dark'
  | 'tokyo-night'
  | 'night-owl'
  | 'monokai-light'
  | 'one-light'
  | 'dracula-pro-light'
  | 'papercolor-light'
  | 'custom'

export interface TerminalThemeColors {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

// Connection Log types
export interface ConnectionLogRecord {
  id: string
  host_id: string | null
  host_name: string
  host_address: string
  username: string | null
  connection_type: 'ssh' | 'local' | 'serial'
  started_at: number
  ended_at: number | null
  duration_seconds: number | null
  is_saved: number
  notes: string | null
  /** 英文可读错误描述（供 UI 翻译） */
  error_message?: string | null
  /** 原始错误完整信息 */
  error_raw?: string | null
}

// Script types
export interface ScriptRecord {
  id: string
  name: string
  description: string | null
  script: string
  host_ids: string
  schedule_type: 'manual' | 'once' | 'interval' | 'cron'
  schedule_value: string | null
  enabled: number
  timeout_seconds: number
  retry_count: number
  created_at: number
  updated_at: number
}

export interface ScriptExecutionRecord {
  id: string
  script_id: string
  script_name: string
  host_id: string | null
  host_name: string | null
  host_address: string | null
  status: 'running' | 'success' | 'failed' | 'timeout'
  output: string | null
  error: string | null
  started_at: number
  ended_at: number | null
  duration_ms: number | null
}

export type {
  SyncQueueRecord,
  TeamAuditLogRecord,
  TeamInviteRecord,
  TeamMemberRecord,
  TeamRecord,
  TeamSharedHostRecord,
  TeamSharedSnippetRecord,
} from './team-types'

// User Profile types
export interface UserProfileRecord {
  id: string
  name: string
  created_at: number
  updated_at: number
}

// Port Forward Rule types
export interface PortForwardRuleRecord {
  id: string
  name: string
  type: 'local' | 'remote' | 'dynamic'
  local_host: string
  local_port: number
  remote_host: string
  remote_port: number
  host_id: string | null
  enabled: number
  created_at: number
  updated_at: number
}
