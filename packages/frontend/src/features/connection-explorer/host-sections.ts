/**
 * Grouping and filtering for the Connection Explorer.
 *
 * Both are pure functions over the store's own shapes. The Explorer renders the
 * result; it does not own a copy of the host list, a second cache, or a second
 * notion of "favourite".
 */

import type { Group, Host } from '@/types'

export interface HostGroupSection {
  /** `null` is the "ungrouped" section. */
  group: Group | null
  hosts: Host[]
}

/**
 * Match a host against a search query.
 *
 * Only name and address, matching what the Explorer's placeholder promises. A
 * host that matches by tag but not by name would appear under a search the user
 * cannot see the reason for; the Hosts page keeps its own broader matching.
 */
export function matchesHostQuery(host: Host, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return (
    host.name.toLowerCase().includes(needle) ||
    host.hostname.toLowerCase().includes(needle)
  )
}

export function filterHosts(hosts: readonly Host[], query: string): Host[] {
  const needle = query.trim()
  if (needle === '') return [...hosts]
  return hosts.filter(host => matchesHostQuery(host, needle))
}

/**
 * Split hosts into group sections, with the ungrouped section last.
 *
 * Ordering rules, each of which the tests pin:
 * - groups appear in their stored `order`, then by name, so the panel does not
 *   reshuffle between launches;
 * - a group with no matching host is omitted entirely rather than shown empty —
 *   during a search, an empty header is noise that looks like a bug;
 * - a host whose `groupId` names a group that no longer exists lands in the
 *   ungrouped section instead of disappearing. Losing a host because its group
 *   was deleted is the failure mode this rule prevents.
 */
export function groupHosts(
  hosts: readonly Host[],
  groups: readonly Group[],
): HostGroupSection[] {
  const sortedGroups = [...groups].sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order
    return left.name.localeCompare(right.name)
  })
  const byGroup = new Map<string, Host[]>()
  const ungrouped: Host[] = []
  const knownGroupIds = new Set(sortedGroups.map(group => group.id))

  for (const host of hosts) {
    const groupId = host.groupId
    if (groupId && knownGroupIds.has(groupId)) {
      const bucket = byGroup.get(groupId)
      if (bucket) bucket.push(host)
      else byGroup.set(groupId, [host])
    } else {
      ungrouped.push(host)
    }
  }

  const sections: HostGroupSection[] = []
  for (const group of sortedGroups) {
    const members = byGroup.get(group.id)
    if (!members || members.length === 0) continue
    sections.push({ group, hosts: sortByName(members) })
  }
  if (ungrouped.length > 0) {
    sections.push({ group: null, hosts: sortByName(ungrouped) })
  }
  return sections
}

/** Favourites, most useful first: by name, so the order is stable and findable. */
export function favoriteHosts(hosts: readonly Host[]): Host[] {
  return sortByName(hosts.filter(host => host.isFavorite))
}

function sortByName(hosts: Host[]): Host[] {
  return [...hosts].sort((left, right) => left.name.localeCompare(right.name))
}
