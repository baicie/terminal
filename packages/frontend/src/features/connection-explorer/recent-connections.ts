/**
 * "Recently connected" for the Connection Explorer.
 *
 * The source is `connection_logs`, which the session layer already writes on every
 * **successful** connection (`session.ts` → `recordConnectionSuccess`, covering
 * local plus five SSH auth modes). That table is the only record of "this machine
 * was actually opened", so it is the only honest source for this list.
 *
 * Three things it deliberately does **not** do:
 *
 * - it never falls back to `hosts.updated_at`. An edited host is not a used host,
 *   and showing it as "recent" would be a number the user cannot account for.
 * - it never includes a row whose `host_id` is null. Local terminals and quick
 *   connect profiles have no saved host, so they cannot be "recently connected
 *   hosts" — they are not hosts.
 * - it never dedupes by name or address. Two saved hosts pointing at the same
 *   server are two hosts; collapsing them would make one of them unreachable from
 *   this list.
 *
 * A host deleted since it was last used is dropped rather than shown as a ghost:
 * the Explorer's job is to open something, and a row that cannot be opened is not
 * a connection.
 */

import type { ConnectionLogRecord } from '@/service/database'
import { getConnectionLogs } from '@/service/database'
import type { Host } from '@/types'

/** How many recent hosts the Explorer shows. */
export const RECENT_CONNECTION_LIMIT = 5

/** How many log rows to read. Generous: one host can occupy many rows. */
const LOG_SCAN_LIMIT = 200

export interface RecentHost {
  host: Host
  /** When this host was last successfully connected, in epoch milliseconds. */
  lastConnectedAt: number
}

/**
 * Fold a host list and a log list into the most recent distinct hosts.
 *
 * Pure, so the ordering rules can be tested without a database: the SQL is a
 * `LIMIT`, the meaning of "recent" is here.
 */
export function pickRecentHosts(
  hosts: readonly Host[],
  logs: readonly Pick<ConnectionLogRecord, 'host_id' | 'started_at' | 'connection_type'>[],
  limit = RECENT_CONNECTION_LIMIT,
): RecentHost[] {
  const byId = new Map(hosts.map(host => [host.id, host]))
  const seen = new Set<string>()
  const recent: RecentHost[] = []

  for (const log of logs) {
    if (log.host_id === null || log.host_id === '') continue
    if (seen.has(log.host_id)) continue
    const host = byId.get(log.host_id)
    // A log for a host this build does not have (deleted, or another workspace's)
    // cannot be opened from here, so it is not a "recent connection".
    if (!host) continue
    if (!Number.isFinite(log.started_at)) continue
    seen.add(log.host_id)
    recent.push({ host, lastConnectedAt: log.started_at })
    if (recent.length >= limit) break
  }
  return recent
}

/**
 * Read recent hosts from the database.
 *
 * Failures are swallowed into an empty list **by the caller's convention**: the
 * Explorer must still show favourites, groups and search when the recency read
 * fails. That is a degradation of one section, not of the panel — and certainly
 * not of the terminal, which never reads this.
 */
export async function loadRecentHosts(
  hosts: readonly Host[],
  limit = RECENT_CONNECTION_LIMIT,
): Promise<RecentHost[]> {
  const logs = await getConnectionLogs(LOG_SCAN_LIMIT)
  return pickRecentHosts(hosts, logs, limit)
}
