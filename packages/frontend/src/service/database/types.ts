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
  group_id: string | null
  is_favorite: number
  color: string | null
  tags: string | null
  port_forwards: string | null
  startup_command: string | null
  environment: string | null
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
  | 'dracula'
  | 'nord'
  | 'catppuccin'
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

// Team types
export interface TeamRecord {
  id: string
  name: string
  owner_id: string
  mode: string
  endpoint?: string
  api_token?: string
  auto_sync: number
  created_at: number
  updated_at: number
}

export interface TeamMemberRecord {
  id: string
  team_id: string
  user_id: string
  user_name?: string
  user_email?: string
  role: string
  joined_at: number
}

export interface TeamSharedHostRecord {
  id: string
  team_id: string
  host_data: string
  shared_by: string
  permission: string
  created_at: number
}

export interface TeamSharedSnippetRecord {
  id: string
  team_id: string
  snippet_data: string
  shared_by: string
  permission: string
  created_at: number
}

export interface TeamInviteRecord {
  id: string
  team_id: string
  type: string
  code?: string
  link_token?: string
  email?: string
  role: string
  created_by: string
  expires_at: number
  used_at?: number
  created_at: number
}

export interface TeamAuditLogRecord {
  id: string
  team_id: string
  user_id: string
  user_name?: string
  host_name?: string
  action: string
  details?: string
  created_at: number
}

export interface SyncQueueRecord {
  id: string
  user_id: string
  team_id: string
  type: string
  resource: string
  resource_id: string
  data?: string
  status: string
  retry_count: number
  error?: string
  created_at: number
  synced_at?: number
}

// User Profile types
export interface UserProfileRecord {
  id: string
  name: string
  created_at: number
  updated_at: number
}
