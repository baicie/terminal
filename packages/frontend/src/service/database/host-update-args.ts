/**
 * Argument lists for the two host UPDATE statements.
 *
 * Split out of `hosts.ts` so the credential lifecycle there stays readable, and so
 * that file stays inside its size limit. This module knows nothing about secrets:
 * the clear statement has no placeholder for a secret column, and the other one
 * takes the reference the write path already decided on.
 */

import type { Host } from '@/types'
import type { CredentialRef } from '@/service/credential-boundary'

/** Shared argument list for the host UPDATE statements. */
export function hostUpdateArgs(
  merged: Host,
  now: number,
  id: string,
  options?: { rewriteSecrets?: boolean, newRef?: CredentialRef | null },
): unknown[] {
  const rewriteSecrets = options?.rewriteSecrets ? 1 : 0
  const base: unknown[] = [
    merged.name,
    merged.hostname,
    merged.port,
    merged.username,
    merged.authType,
  ]
  if (!options) {
    // The clear statement has no placeholders for the secret columns.
    return [
      ...base,
      merged.certificate ?? null,
      merged.groupId ?? null,
      merged.isFavorite ? 1 : 0,
      merged.color ?? null,
      merged.tags ? JSON.stringify(merged.tags) : null,
      JSON.stringify(merged.portForwards ?? []),
      merged.startupCommand ?? null,
      merged.environment ? JSON.stringify(merged.environment) : null,
      merged.jumpHostId ?? null,
      merged.jumpHostAuthType ?? null,
      merged.agentForwarding ? 1 : 0,
      merged.shellIntegration ?? 'off',
      now,
      id,
    ]
  }
  return [
    ...base,
    rewriteSecrets,
    rewriteSecrets,
    merged.certificate ?? null,
    options.newRef === undefined || options.newRef === null
      ? null
      : JSON.stringify(options.newRef),
    merged.groupId ?? null,
    merged.isFavorite ? 1 : 0,
    merged.color ?? null,
    merged.tags ? JSON.stringify(merged.tags) : null,
    JSON.stringify(merged.portForwards ?? []),
    merged.startupCommand ?? null,
    merged.environment ? JSON.stringify(merged.environment) : null,
    merged.jumpHostId ?? null,
    merged.jumpHostAuthType ?? null,
    merged.agentForwarding ? 1 : 0,
    merged.shellIntegration ?? 'off',
    now,
    id,
  ]
}
