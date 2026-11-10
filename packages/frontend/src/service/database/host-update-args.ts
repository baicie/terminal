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
  options?: {
    rewriteSecrets?: boolean
    newRef?: CredentialRef | null
    /**
     * Set when this update bound a credential or cleared one.
     *
     * An imported host carries `identityFilePath` — a path the user keeps, not a
     * secret we hold. `resolveSessionCredential` refuses to connect while it is
     * set, because reading arbitrary files during a connect attempt is not
     * something the app should do implicitly. That guard is right, but it made
     * the host permanently unconnectable: saving a real key stored a vault
     * reference the guard never reached.
     *
     * So a write that supplies a credential retires the path in the same
     * statement. A rename does not: the path is still how that host expects to
     * authenticate.
     */
    clearIdentityFilePath?: boolean
    /**
     * True for the clear statement, which now writes `identity_file_path = NULL`
     * in its SQL text — so it binds no value for that column and the argument
     * list has to be one shorter.
     */
    dropIdentityFilePathArgument?: boolean
  },
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
    // A write that supplies a credential retires the imported path in the same
    // statement — see `clearIdentityFilePath` above for why it must not survive.
    options?.clearIdentityFilePath ? null : merged.identityFilePath ?? null,
    now,
    id,
  ]
}
