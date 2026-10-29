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
