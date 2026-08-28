import type { Host } from '@/types'

export function createShareableTeamHostData(
  host: Host,
): Record<string, unknown> {
  return {
    id: host.id,
    name: host.name,
    hostname: host.hostname,
    port: host.port,
    username: host.username,
    auth_type: host.authType,
    group_id: host.groupId,
    color: host.color,
  }
}

export function createImportedTeamHost(
  hostData: Record<string, unknown>,
  id: string = crypto.randomUUID(),
  now = Date.now(),
): Host {
  return {
    id,
    name: hostData.name as string,
    hostname: hostData.hostname as string,
    port: (hostData.port as number) || 22,
    username: hostData.username as string,
    authType: (hostData.auth_type as Host['authType']) || 'password',
    password: hostData.password as string | undefined,
    privateKey: hostData.private_key as string | undefined,
    certificate: hostData.certificate as string | undefined,
    agentForwarding: false,
    groupId: hostData.group_id as string | undefined,
    isFavorite: Boolean(hostData.is_favorite),
    color: hostData.color as string | undefined,
    portForwards: [],
    createdAt: now,
    updatedAt: now,
  }
}
