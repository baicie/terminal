/**
 * Resolves the secrets one connection needs, at the moment it connects.
 *
 * Lives beside the session service so `session.ts` stays within its size limit and
 * so the rule has one home: inline secrets from a form are used as-is; otherwise
 * the host's `credentialRef` decides, and a reference the vault cannot satisfy
 * fails the connection with an explanation instead of attempting an empty login.
 *
 * A *damaged* reference is its own failure. Before this, an unparseable or
 * foreign-provider pointer was flattened to "no reference", which made a host whose
 * vault entry existed connect with an empty password — a login failure that names
 * nothing about the real cause. See `docs/phase10/10-credential-boundary-adr.md` §4.
 */

import { SessionCredentialResolver } from '@/service/credential-boundary'
import type {
  CredentialRef,
  CredentialRefProblem,
  HostMetadata,
} from '@/service/credential-boundary'
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
  credentialRefProblem?: CredentialRefProblem | null
}

export type SessionCredentialOutcome =
  | { ok: true; password?: string; privateKey?: string }
  | { ok: false; message: string }

/** The sentence a user can act on, per failure mode. Never contains a secret. */
export function describeRefProblem(problem: CredentialRefProblem): string {
  switch (problem.kind) {
    case 'unknown-provider':
      return `This host's credentials are stored with "${problem.provider}", which this build cannot read. Re-save the host's credentials to store them in the vault.`
    case 'unsupported-version':
      return `This host's credentials were saved by a newer version (format ${problem.version}). Update Terminal, or re-save the host's credentials.`
    case 'empty-kinds':
      return "This host records a stored credential but names none. Re-save the host's credentials."
    case 'malformed':
      return `This host's stored credential reference cannot be read (${problem.detail}). Re-save the host's credentials.`
  }
}

export async function resolveSessionCredential(
  host: SessionCredentialInput,
): Promise<SessionCredentialOutcome> {
  // Agent authentication resolves nothing, on every path. `withResolvedCredential`
  // already short-circuits it; repeating the rule here keeps the two entry points
  // from disagreeing about which guards apply — the shape that let a damaged
  // reference slip through on the terminal path.
  if (host.authType === 'agent') return { ok: true }
  const inlinePassword = host.password
  const inlineKey = host.privateKey
  if (inlinePassword || inlineKey) {
    return { ok: true, password: inlinePassword, privateKey: inlineKey }
  }
  // Refuse before touching the vault: the row says a credential exists and this
  // build cannot name it. Connecting with nothing would look like a wrong password.
  if (host.credentialRefProblem) {
    return { ok: false, message: describeRefProblem(host.credentialRefProblem) }
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
