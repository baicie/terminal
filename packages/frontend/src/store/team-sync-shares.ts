import { addSharedHost, addSharedSnippet } from '@/service/database'
import { teamApi } from '@/service/team-api'
import type { SharedHost, SharedSnippet, SyncConflict } from './team-types'
import type { TeamStoreGet } from './team-store-context'

/**
 * The share shape, the conflict record it produces, and the push that submits it.
 *
 * Split out of `team-sync-engine.ts` when the resnapshot work (Phase 9.0 P9.0-7)
 * took that file past its line limit: the engine keeps the pull side — window
 * application, cursor and resnapshot pruning — and this module keeps what the client
 * sends. Every name here is re-exported from the engine, so callers still have one
 * import.
 */

export type LocalShare =
  | (SharedHost & { _type: 'HOST' })
  | (SharedSnippet & { _type: 'SNIPPET_PACKAGE' })

export function shareData(share: SharedHost | SharedSnippet): unknown {
  return 'hostData' in share ? share.hostData : share.snippetData
}

export function hasData(value: unknown): boolean {
  return typeof value === 'object' && value !== null
    && Object.keys(value).length > 0
}

/**
 * True when this conflict record actually carries the server's snapshot.
 *
 * `data` alone is not the test: a sensitive share's snapshot keeps the
 * ciphertext and leaves `data` an empty placeholder, so judging by `data` would
 * call the only usable snapshot "empty" and let a push-only report replace it.
 * A version is what a snapshot always has and a push report never does.
 */
function hasRemoteSnapshot(conflict: SyncConflict): boolean {
  const { remoteVersion } = conflict
  return typeof remoteVersion.version === 'number'
    && (hasData(remoteVersion.data) || typeof remoteVersion.encryptedData === 'string')
}

/** The richer of two reports of one conflict wins: only a pull knows the remote side. */
export function mergeConflicts(
  existing: SyncConflict[],
  incoming: SyncConflict[],
): SyncConflict[] {
  if (incoming.length === 0) return existing
  const byId = new Map(existing.map(item => [item.shareId, item]))
  for (const conflict of incoming) {
    const previous = byId.get(conflict.shareId)
    const keepRemote = previous !== undefined
      && hasRemoteSnapshot(previous)
      && !hasRemoteSnapshot(conflict)
    byId.set(
      conflict.shareId,
      keepRemote
        ? { ...conflict, remoteVersion: previous.remoteVersion }
        : conflict,
    )
  }
  return [...byId.values()]
}

export function localConflict(
  share: SharedHost | SharedSnippet | undefined,
): SyncConflict {
  return {
    shareId: share?.id ?? '',
    localVersion: {
      updatedAt: share?.updatedAt ?? share?.createdAt ?? 0,
      data: share === undefined ? {} : shareData(share),
    },
    remoteVersion: { updatedAt: 0, data: {}, updatedBy: '' },
  }
}

/**
 * Submits the shares this device holds. No server version means the server has
 * never seen the id: CREATE, which a replay answers with an idempotent ack. A
 * version means UPDATE, and it is sent as the proof, so a concurrent write is
 * reported as a conflict instead of being overwritten.
 */
export async function pushLocalShares(
  get: TeamStoreGet,
  currentTeamId: string,
): Promise<SyncConflict[]> {
  const local: LocalShare[] = [
    ...get().sharedHosts.map(item => ({ ...item, _type: 'HOST' as const })),
    ...get().sharedSnippets.map(item => ({
      ...item,
      _type: 'SNIPPET_PACKAGE' as const,
    })),
  ]
  if (local.length === 0) return []
  const pushed = local.map(item => {
    const baseVersion = typeof item.version === 'number' ? item.version : null
    const isSensitive = item.isSensitive === true
    return {
      id: item.id,
      teamId: item.teamId || currentTeamId,
      type: item._type,
      // A sensitive share's payload *is* its ciphertext: sending the local
      // plaintext alongside `isSensitive` would either be refused or stored as
      // plaintext, and both break the secrecy the flag promises (P9.2-2).
      data: isSensitive ? {} : shareData(item),
      ...(isSensitive && typeof item.encryptedData === 'string'
        ? { encryptedData: item.encryptedData }
        : {}),
      isSensitive,
      permission: item.permission.toUpperCase() as 'READONLY' | 'READWRITE',
      operation: baseVersion === null ? ('CREATE' as const) : ('UPDATE' as const),
      ...(baseVersion === null ? {} : { baseVersion }),
    }
  })
  const response = await teamApi.pushChanges(pushed)
  if (response.error) throw new Error(response.error)
  const accepted = new Set([
    ...(response.data?.created ?? []),
    ...(response.data?.updated ?? []),
  ])
  // The server holds this content now, so the row stops being a local edit. The
  // version stays as it was: the next pull is what advances it, and until then a
  // newer remote write still wins over this copy.
  for (const item of local) {
    if (!accepted.has(item.id)) continue
    const record = {
      id: item.id,
      team_id: item.teamId || currentTeamId,
      shared_by: item.sharedBy,
      permission: item.permission,
      created_at: item.createdAt,
      version: typeof item.version === 'number' ? item.version : null,
      updated_at: item.updatedAt ?? item.createdAt,
      is_sensitive: item.isSensitive === true ? 1 : 0,
      encrypted_data: item.encryptedData ?? null,
    }
    if (item._type === 'HOST') {
      await addSharedHost(
        { ...record, host_data: JSON.stringify(item.hostData) },
        'override',
      )
    } else {
      await addSharedSnippet(
        { ...record, snippet_data: JSON.stringify(item.snippetData) },
        'override',
      )
    }
  }
  return (response.data?.conflicts ?? []).map((shareId) => {
    const item = local.find(entry => entry.id === shareId)
    return {
      ...localConflict(item),
      shareType: item?._type === 'SNIPPET_PACKAGE' ? 'SNIPPET_PACKAGE' : 'HOST',
    }
  })
}
