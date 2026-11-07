/**
 * Contract of the snapshot the Rust backup command returns.
 *
 * The transaction id is not decoration: completion names it, and the backend
 * refuses to clear a marker owned by a different transaction.
 */
export interface MigrationSnapshot {
  /** Absolute path of the snapshot file. */
  path: string
  /** Tables the backend verified against the database. */
  tables: number
  /** Rows the snapshot carries. */
  rows: number
  /** The migration transaction this snapshot opened. */
  transactionId: string
}

/** Reject a snapshot response that cannot drive completion safely. */
export function requireMigrationSnapshot(
  snapshot: MigrationSnapshot,
): MigrationSnapshot {
  if (!snapshot || typeof snapshot.path !== 'string' || snapshot.path === '') {
    throw new Error('the backend did not report a snapshot path')
  }
  if (
    typeof snapshot.transactionId !== 'string' ||
    snapshot.transactionId === ''
  ) {
    throw new Error('the backend did not report a migration transaction id')
  }
  return snapshot
}
