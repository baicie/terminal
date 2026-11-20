/**
 * What makes an SFTP session still valid for the host it was opened for.
 *
 * ## Why the record id is not the answer
 *
 * The session used to be bound by `id:authType`. Editing a saved host — a new hostname,
 * a different port, another login, a rotated key, a different bastion — leaves that key
 * untouched, so the hook kept the connection it had opened against the old address.
 * Every later operation (list, upload, delete, rename) then ran on the machine the user
 * had just stopped pointing at.
 *
 * `id:authType` answers "is this the same record?". The question is "does this session
 * connect to the host as it is configured now?" — so the identity is built from the
 * fields that decide where and as whom the connection lands.
 *
 * ## What is deliberately excluded
 *
 * The display name and colour. A rename must not drop a live session: that would
 * truncate an in-flight transfer for a cosmetic edit. `credentialRef.version` *is*
 * included, because a new key version means different bytes are presented to the server.
 */
import type { Host } from '@/types'

/**
 * The subset of a host this module reads.
 *
 * `Pick` rather than a hand-written interface: the identity has to stay in lockstep
 * with the real fields, and a structurally-similar declaration drifts the moment one of
 * them changes type — measured while writing this, `credentialRef.provider` is the
 * literal `'vault'`, not `string`.
 */
export type ConnectionFields = Pick<
  Host,
  | 'id'
  | 'authType'
  | 'hostname'
  | 'port'
  | 'username'
  | 'jumpHostId'
  | 'agentForwarding'
  | 'credentialRef'
>

/** Fields that decide which machine the session reaches, and as whom. */
export function connectionIdentity(host: ConnectionFields): string {
  const credential = host.credentialRef
    ? `${host.credentialRef.provider}:${host.credentialRef.kinds.join(',')}:${host.credentialRef.version}`
    : 'inline'
  return [
    host.id,
    host.authType,
    host.hostname,
    String(host.port),
    host.username,
    host.jumpHostId ?? '',
    host.agentForwarding ? 'agent-fwd' : '',
    credential,
  ].join('|')
}
