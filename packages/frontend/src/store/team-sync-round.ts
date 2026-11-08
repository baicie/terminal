// One sync round is pinned to the server and identity it started with.
//
// The API singleton is shared by every feature and `configure()` can run while a
// paginated round is between pages. A round therefore carries its own immutable
// client plus a liveness check; once the check fails the round stops instead of
// mixing two identities into one cursor slot.

import { teamApi } from '@/service/team-api'
import type { TeamApiSync } from '@/service/team-api-sync'

/**
 * Thrown when the endpoint, token or identity changed while a round was running.
 *
 * The pages already applied belong to the old scope and stay there; what must not
 * happen is the *rest* of that round landing under the new one. Nothing is
 * pruned, no cursor moves, and the round does not report a completion.
 */
export class SyncRoundStaleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncRoundStaleError'
  }
}

/** The immutable client and the liveness check of one sync round. */
export interface SyncRoundContext {
  api: TeamApiSync
  /** False as soon as the round's endpoint, token or identity is no longer current. */
  isCurrent: () => boolean
}

export const DEFAULT_SYNC_ROUND: SyncRoundContext = {
  api: teamApi,
  isCurrent: () => true,
}

export function assertSyncRoundCurrent(
  round: SyncRoundContext,
  when: string,
): void {
  if (!round.isCurrent()) {
    throw new SyncRoundStaleError(
      `Sync round stopped ${when}: the endpoint, token or identity changed while it was running`,
    )
  }
}
