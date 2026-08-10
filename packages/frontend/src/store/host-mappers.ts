import type { AuthType, Group, Host } from '@/types'

export interface HostRow {
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
  created_at: number
  updated_at: number
}

export interface GroupRow {
  id: string
  name: string
  parent_id: string | null
  color: string | null
  inherit_settings: number
  settings: string | null
  order: number
}

export function hostRowToHost(row: HostRow): Host {
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    port: row.port,
    username: row.username,
    authType: row.auth_type as AuthType,
    password: row.password ?? undefined,
    privateKey: row.private_key ?? undefined,
    certificate: row.certificate ?? undefined,
    groupId: row.group_id ?? undefined,
    isFavorite: row.is_favorite === 1,
    color: row.color ?? undefined,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    portForwards: row.port_forwards ? JSON.parse(row.port_forwards) : [],
    startupCommand: row.startup_command ?? undefined,
    environment: row.environment ? JSON.parse(row.environment) : undefined,
    jumpHostId: row.jump_host_id ?? undefined,
    jumpHostAuthType: row.jump_host_auth_type
      ? (row.jump_host_auth_type as AuthType)
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function groupRowToGroup(row: GroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id ?? undefined,
    color: row.color ?? undefined,
    inheritSettings: row.inherit_settings === 1,
    settings: row.settings ? JSON.parse(row.settings) : undefined,
    order: row.order,
  }
}
