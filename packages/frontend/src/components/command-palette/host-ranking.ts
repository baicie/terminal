/**
 * Host ranking for the command palette.
 *
 * The previous implementation truncated the host list *before* searching
 * (`hosts.slice(0, 20)`), so host 21 could never be found no matter how exactly
 * the user typed its name. Ranking is now a pure function over the whole list:
 * filter → score → sort → limit. The limit only decides how many results are
 * *displayed*; it never decides what is searchable.
 */

import type { Host } from '@/types'
import { fuzzyMatch, fuzzyScore } from './command-palette-utils'

/** Which hosts the user touched most recently, most recent first. */
export interface HostRecency {
  /** Host ids ordered by last connection, most recent first. */
  order: string[]
}

export interface RankOptions {
  /** Maximum number of results to return. Defaults to 10. */
  limit?: number
  recency?: HostRecency
  /** Host ids the user marked as favourite (the store already has `isFavorite`). */
  now?: number
}

const DEFAULT_LIMIT = 10

/**
 * How well a host matches `query`.
 *
 * Ordering of the signals, strongest first:
 *   1. exact name, exact hostname, exact `user@host`
 *   2. name prefix, hostname prefix
 *   3. fuzzy match anywhere in name / hostname / username / tags
 *
 * Favourite hosts and recently used hosts get a bounded bonus, small enough that
 * they can reorder equal matches but never outrank a better textual match - a
 * favourite called `web` must not beat an exact search for `db-prod-01`.
 */
export function scoreHost(host: Host, query: string, recency?: HostRecency): number {
  const needle = query.trim().toLowerCase()
  const name = host.name.toLowerCase()
  const hostname = host.hostname.toLowerCase()
  const userHost = `${host.username.toLowerCase()}@${hostname}`
  const tags = (host.tags ?? []).join(' ').toLowerCase()

  let score = 0
  if (needle === '') {
    score = 0
  } else if (needle === name || needle === hostname || needle === userHost) {
    score = 1000
  } else if (name.startsWith(needle) || hostname.startsWith(needle)) {
    score = 700
  } else if (name.includes(needle) || hostname.includes(needle) || userHost.includes(needle)) {
    score = 500
  } else if (tags.includes(needle)) {
    score = 400
  } else {
    const haystack = `${name} ${hostname} ${host.username.toLowerCase()} ${tags}`
    if (!fuzzyMatch(needle, haystack)) return Number.NEGATIVE_INFINITY
    score = 200 + fuzzyScore(needle, `${name} ${hostname} ${host.username}`)
  }

  // Bounded bonuses: they break ties, they never beat a stronger text match.
  if (host.isFavorite) score += 25
  const recentIndex = recency?.order.indexOf(host.id) ?? -1
  if (recentIndex >= 0) score += Math.max(0, 20 - recentIndex)

  return score
}

export interface RankedHost {
  host: Host
  score: number
}

/**
 * Ranks every host against `query`. With an empty query the list is ordered by
 * favourites, then recency, then name - the "what do I usually open" order.
 */
export function rankHosts(
  hosts: Host[],
  query: string,
  options: RankOptions = {},
): RankedHost[] {
  const limit = options.limit ?? DEFAULT_LIMIT
  const trimmed = query.trim()
  const scored: RankedHost[] = []

  for (const host of hosts) {
    const score = scoreHost(host, trimmed, options.recency)
    if (score === Number.NEGATIVE_INFINITY) continue
    scored.push({ host, score })
  }

  if (trimmed === '') {
    scored.sort((left, right) => {
      if (left.host.isFavorite !== right.host.isFavorite) {
        return left.host.isFavorite ? -1 : 1
      }
      const leftRecent = options.recency?.order.indexOf(left.host.id) ?? -1
      const rightRecent = options.recency?.order.indexOf(right.host.id) ?? -1
      if (leftRecent !== rightRecent) {
        if (leftRecent === -1) return 1
        if (rightRecent === -1) return -1
        return leftRecent - rightRecent
      }
      return left.host.name.localeCompare(right.host.name)
    })
  } else {
    scored.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      return left.host.name.localeCompare(right.host.name)
    })
  }

  return scored.slice(0, limit)
}
