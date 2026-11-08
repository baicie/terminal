/**
 * Resolves the secrets one connection needs, at the moment it connects.
 *
 * Lives beside the session service so `session.ts` stays within its size limit and
 * so the rule has one home: inline secrets from a form are used as-is; otherwise
 * the host's `credentialRef` decides, and a reference the vault cannot satisfy
 * fails the connection with an explanation instead of attempting an empty login.
 */

import { SessionCredentialResolver } from '@/service/credential-boundary'
import type { CredentialRef, HostMetadata } from '@/service/credential-boundary'
import { vaultSecretProvider } from '@/service/vault-secret-provider'

export interface SessionCredentialInput {
  id: string
  name: string
  hostname: string
  port: number
  username: string
  authType: string
  password?: string
  privateKey?: string
  credentialRef?: CredentialRef | null
}

export type SessionCredentialOutcome =
  | { ok: true; password?: string; privateKey?: string }
  | { ok: false; message: string }

export async function resolveSessionCredential(
  host: SessionCredentialInput,
): Promise<SessionCredentialOutcome> {
  const inlinePassword = host.password
  const inlineKey = host.privateKey
  if (inlinePassword || inlineKey) {
    return { ok: true, password: inlinePassword, privateKey: inlineKey }
  }
  const metadata: HostMetadata = {
    id: host.id,
    name: host.name,
    hostname: host.hostname,
    port: host.port,
    username: host.username,
    authType: host.authType,
    credentialRef: host.credentialRef ?? null,
  }
  const resolved = await new SessionCredentialResolver(
    vaultSecretProvider,
  ).resolve(metadata)
  if (!resolved.ok) return { ok: false, message: resolved.message }
  return {
    ok: true,
    password: resolved.credential.password,
    privateKey: resolved.credential.privateKey,
  }
}
