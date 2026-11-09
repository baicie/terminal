import type { CredentialRef } from '@/service/credential-boundary'
import type { AuthType, Group, Host, ShellIntegrationMode } from '@/types'

/**
 * Parses the `credential_ref` column.
 *
 * A malformed value is treated as "no reference" rather than throwing: a broken
 * pointer must not make the host list unreadable. It also must not be silently
 * turned into a *valid* reference, which would claim secrets exist that do not.
 */
function parseCredentialRef(
  raw: string | null | undefined,
): CredentialRef | null {
  if (raw === null || raw === undefined || raw === '') return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object') return null
    const kindList = (parsed as { kinds?: unknown }).kinds
    const provider = (parsed as { provider?: unknown }).provider
    if (!Array.isArray(kindList) || provider !== 'vault') return null
    const kinds = kindList.filter(
      (kind): kind is 'password' | 'privateKey' | 'passphrase' =>
        kind === 'password' || kind === 'privateKey' || kind === 'passphrase',
    )
    if (kinds.length === 0) return null
    return { kinds, provider: 'vault' }
  } catch {
    return null
  }
}

export interface HostRow {
  id: string
  name: string
  hostname: string
  port: number
  username: string
  auth_type: string
  password: string | null
  private_key: string | null
  credential_ref?: string | null
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
  agent_forwarding?: number | null
  shell_integration?: string | null
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
    // The reference says which secrets the vault holds.
    credentialRef: parseCredentialRef(row.credential_ref),
    // Legacy plaintext is still read, and must be until the migration has run:
    // ignoring it would leave every host saved by an older build unable to
    // connect, which is a worse outcome than the plaintext it replaces. New
    // writes never produce these values (see hosts.ts), so the only rows that
    // have them are pre-migration ones - and the migration clears them.
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
    agentForwarding: row.agent_forwarding === 1,
    shellIntegration: normalizeShellIntegration(row.shell_integration),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeShellIntegration(value: unknown): ShellIntegrationMode {
  return value === 'bash' || value === 'zsh' ? value : 'off'
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
