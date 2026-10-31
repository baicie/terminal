export interface ConflictInfo {
  shareId: string
  localVersion: { updatedAt: number; data: unknown }
  remoteVersion: { updatedAt: number; data: unknown; updatedBy: string }
}

export interface PushResult {
  created: string[]
  updated: string[]
  deleted: string[]
  conflicts: string[]
  errors: Array<{ id: string, error: string }>
}

/** One pushed share as it crosses the wire; `operation` is the declared intent. */
export interface PushedShare {
  id: string
  teamId: string
  type: string
  data: unknown
  encryptedData?: string
  isSensitive?: boolean
  permission: string
  baseVersion?: number
  operation?: 'CREATE' | 'UPDATE' | 'DELETE'
}

/** One page of the bounded change window plus its resume cursor. */
export interface ChangeWindow {
  /** Opaque composite cursor; the client sends it back unchanged. */
  cursor: string
  /** Numeric safe watermark this window was bounded by (never a clock). */
  watermark: number
  /** True when the bounded window still holds undelivered rows. */
  hasMore: boolean
  resync: boolean
  shares: ShareSnapshot[]
  deletedShareIds: string[]
}

export interface ShareSnapshot {
  id: string
  teamId: string
  type: string
  data: unknown
  encryptedData: string | null
  isSensitive: boolean
  sharedBy: string
  permission: string
  createdAt: string
  updatedAt: string
  /** Server-issued monotonic version; the client echoes it back as baseVersion. */
  version: number
}

export interface IncrementalSyncResult {
  /**
   * Opaque composite cursor (`2.<bound>.<txid>.<seq>`): the frozen watermark plus
   * the position of the last delivered row. The client stores and replays it
   * verbatim; see docs/phase8/sync-protocol.md §3.
   */
  cursor: string
  /** Numeric safe watermark of this window. Display/logging only, never a clock. */
  timestamp: number
  /** True when the bounded window still holds undelivered rows. */
  hasMore: boolean
  /** True when the cursor was unusable and this response is a full snapshot. */
  resync: boolean
  shares: ShareSnapshot[]
  deletedShareIds: string[]
}
