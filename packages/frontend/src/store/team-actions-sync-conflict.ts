import { addSharedHost, addSharedSnippet } from '@/service/database'
import { teamApi } from '@/service/team-api'
import type { SharedHost, SharedSnippet } from './team-types'
import type { TeamStoreGet } from './team-store-context'
import { hasData } from './team-sync-engine'

/**
 * Adopts a server snapshot the pull had to skip because the row carried a local
 * edit: the user chose the server's copy and the cursor already moved past it, so
 * the snapshot recorded with the conflict is the only way back to convergence.
 */
export async function adoptRemoteShare(
  get: TeamStoreGet,
  shareId: string,
  remote: {
    version: number
    updatedAt: number
    data: unknown
    isSensitive: boolean
    encryptedData: string | null
  },
): Promise<boolean> {
  // A sensitive share's authoritative payload is its ciphertext, not `data`
  // (which the server leaves empty). Refusing an empty plaintext object for a
  // plaintext share is what keeps a placeholder from being written as content.
  if (!remote.isSensitive && !hasData(remote.data)) return false
  const host = get().sharedHosts.find(item => item.id === shareId)
  if (host !== undefined) {
    await addSharedHost(
      {
        id: host.id,
        team_id: host.teamId,
        host_data: JSON.stringify(remote.isSensitive ? {} : remote.data),
        shared_by: host.sharedBy,
        permission: host.permission,
        created_at: host.createdAt,
        version: remote.version,
        updated_at: remote.updatedAt,
        is_sensitive: remote.isSensitive ? 1 : 0,
        encrypted_data: remote.encryptedData,
      },
      'override',
    )
    await get().loadSharedHosts(host.teamId)
    return true
  }
  const snippet = get().sharedSnippets.find(item => item.id === shareId)
  if (snippet === undefined) return false
  await addSharedSnippet(
    {
      id: snippet.id,
      team_id: snippet.teamId,
      snippet_data: JSON.stringify(remote.isSensitive ? {} : remote.data),
      shared_by: snippet.sharedBy,
      permission: snippet.permission,
      created_at: snippet.createdAt,
      version: remote.version,
      updated_at: remote.updatedAt,
      is_sensitive: remote.isSensitive ? 1 : 0,
      encrypted_data: remote.encryptedData,
    },
    'override',
  )
  await get().loadSharedSnippets(snippet.teamId)
  return true
}

/** The local row a conflict is about, if this device still holds it. */
export function findLocalShare(
  get: TeamStoreGet,
  shareId: string,
): { host?: SharedHost, snippet?: SharedSnippet, teamId: string } {
  const host = get().sharedHosts.find(item => item.id === shareId)
  if (host !== undefined) return { host, teamId: host.teamId }
  const snippet = get().sharedSnippets.find(item => item.id === shareId)
  return { snippet, teamId: snippet?.teamId ?? '' }
}

/**
 * Builds the LOCAL payload from state this device actually has.
 *
 * `baseVersion` is the version of the snapshot the *user was shown* when they
 * chose, i.e. the conflict's remote side — never the local row's version and
 * never a version re-read just before sending. Both alternatives are wrong in the
 * same way: the local row is older than the write that caused the conflict, so
 * the server would refuse with `CONFLICT_STALE_VERSION` forever, and a freshly
 * re-read version would be the version the user decided *against*, which turns the
 * conditional write back into an unconditional one (P9.2-1).
 *
 * It never invents a security state either: `isSensitive` comes from the stored
 * row, and ciphertext is sent only for a sensitive row (P9.2-2).
 */
export function buildLocalResolution(
  local: { host?: SharedHost, snippet?: SharedSnippet },
  localData: unknown,
  seenRemoteVersion: number | null,
): {
    data: unknown
    isSensitive: boolean
    encryptedData?: string
    permission: string
    baseVersion?: number
  } | null {
  const row = local.host ?? local.snippet
  if (row === undefined) return null
  const isSensitive = row.isSensitive === true
  const data = isSensitive
    ? {}
    : (localData ?? ('hostData' in row ? row.hostData : row.snippetData))
  const payload: {
    data: unknown
    isSensitive: boolean
    encryptedData?: string
    permission: string
    baseVersion?: number
  } = {
    data,
    isSensitive,
    permission: row.permission.toUpperCase(),
    // Without a remote snapshot there is no version the user could have consented
    // to, so none is sent: the server then refuses with BASE_VERSION_REQUIRED
    // instead of accepting a write whose basis nobody can name.
    ...(seenRemoteVersion === null ? {} : { baseVersion: seenRemoteVersion }),
  }
  if (isSensitive && typeof row.encryptedData === 'string') {
    payload.encryptedData = row.encryptedData
  }
  return payload
}

/**
 * Why a REMOTE resolution could not adopt the server's copy.
 *
 * Collapsing these into one "failed" is how the old code lost data: it treated an
 * unreadable snapshot the same as a read one, deleted the conflict, and left the
 * local row holding an edit the user had already decided to discard (P9.2-4).
 */
export type RemoteSnapshotFailure
  = | 'deleted'
    | 'forbidden'
    | 'incomplete'
    | 'unavailable'

export type RemoteSnapshot
  = | { ok: true, snapshot: RemoteSnapshotValue }
    | { ok: false, reason: RemoteSnapshotFailure, message: string }

export interface RemoteSnapshotValue {
  version: number
  updatedAt: number
  data: unknown
  isSensitive: boolean
  encryptedData: string | null
}

/**
 * Fetches the authoritative remote snapshot a REMOTE resolution adopts. A
 * push-only conflict has no remote data, so the version has to come from the
 * server; adopting nothing and then deleting the conflict is the failure this
 * exists to prevent (P9.2-4).
 */
export async function fetchRemoteSnapshot(
  teamId: string,
  shareId: string,
): Promise<RemoteSnapshot> {
  if (teamId === '') {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'Cannot read the server copy: this record names no team',
    }
  }
  const response = await teamApi.getShare(teamId, shareId)
  if (!response.ok) {
    if (response.reason === 'http' && response.status === 404) {
      return {
        ok: false,
        reason: 'deleted',
        message: 'The share no longer exists on the server',
      }
    }
    if (response.reason === 'http' && (response.status === 403 || response.status === 401)) {
      return {
        ok: false,
        reason: 'forbidden',
        message: 'You may no longer read this share',
      }
    }
    return { ok: false, reason: 'unavailable', message: response.message }
  }
  const share = response.data
  if (share === null || typeof share !== 'object') {
    return {
      ok: false,
      reason: 'incomplete',
      message: 'The server returned no share',
    }
  }
  const version = Number(share.version)
  if (!Number.isSafeInteger(version) || version < 0) {
    return {
      ok: false,
      reason: 'incomplete',
      message: 'The server returned a share without a usable version',
    }
  }
  const isSensitive = share.isSensitive === true
  // A plaintext share with no content is not a snapshot: adopting it would
  // replace the user's row with an empty one and call that convergence.
  if (!isSensitive && !hasData(share.data)) {
    return {
      ok: false,
      reason: 'incomplete',
      message: 'The server returned a share without content',
    }
  }
  return {
    ok: true,
    snapshot: {
      version,
      updatedAt: new Date(share.updatedAt).getTime() || Date.now(),
      data: share.data,
      isSensitive,
      encryptedData: share.encryptedData ?? null,
    },
  }
}
