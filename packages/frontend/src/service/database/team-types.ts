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
  /** Server-issued monotonic share version; NULL means the server never saw it. */
  version?: number | null
  /** Server-side change time, kept for display and conflict reporting. */
  updated_at?: number | null
  /** 1 while a local edit has not been accepted by the server yet. */
  dirty?: number | null
  /**
   * Server security state of a shared row. Losing it is what let a conflict
   * resolution submit `isSensitive: false` for a sensitive share and turn its
   * ciphertext into plaintext on the server (P9.2-2).
   */
  is_sensitive?: number | null
  /** AES-256-GCM payload for a sensitive share; the server never stores it as data. */
  encrypted_data?: string | null
}

export interface TeamSharedSnippetRecord {
  id: string
  team_id: string
  snippet_data: string
  shared_by: string
  permission: string
  created_at: number
  /** Server-issued monotonic share version; NULL means the server never saw it. */
  version?: number | null
  /** Server-side change time, kept for display and conflict reporting. */
  updated_at?: number | null
  /** 1 while a local edit has not been accepted by the server yet. */
  dirty?: number | null
  /** Server security state of a shared row; see TeamSharedHostRecord. */
  is_sensitive?: number | null
  /** AES-256-GCM payload for a sensitive share; see TeamSharedHostRecord. */
  encrypted_data?: string | null
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
