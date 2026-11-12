// UX-1b — search, favourites and grouping.
//
// Pure functions, so the rules are stated once and tested without a DOM. Each
// test names the failure it prevents, because "grouping works" is not a property
// anyone can falsify.

import { describe, expect, it } from 'vitest'
import type { Group, Host } from '@/types'
import { favoriteHosts, filterHosts, groupHosts, matchesHostQuery } from './host-sections'

function host(id: string, overrides: Partial<Host> = {}): Host {
  return {
    id,
    name: id,
    hostname: `${id}.example.com`,
    port: 22,
    username: 'deploy',
    authType: 'password',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Host
}

function group(id: string, overrides: Partial<Group> = {}): Group {
  return { id, name: id, parentId: null, order: 0, ...overrides } as Group
}

describe('search', () => {
  it('matches the name', () => {
    const hosts = [host('prod-db', { name: 'Production DB' }), host('staging')]
    expect(filterHosts(hosts, 'production').map(entry => entry.id)).toEqual([
      'prod-db',
    ])
  })

  it('matches the address', () => {
    const hosts = [
      host('a', { hostname: '10.0.0.5' }),
      host('b', { hostname: 'db.internal' }),
    ]
    expect(filterHosts(hosts, '10.0.0').map(entry => entry.id)).toEqual(['a'])
  })

  it('is case-insensitive and trims the query', () => {
    const hosts = [host('a', { name: 'Prod-DB' })]
    expect(filterHosts(hosts, '  prod-db  ')).toHaveLength(1)
    expect(filterHosts(hosts, 'PROD')).toHaveLength(1)
  })

  it('returns everything for an empty query', () => {
    const hosts = [host('a'), host('b')]
    expect(filterHosts(hosts, '   ')).toHaveLength(2)
  })

  it('does not match on username or tags', () => {
    // The placeholder promises name and address. Matching on a hidden field would
    // show a result whose reason the user cannot see.
    const hosts = [host('a', { username: 'root', tags: ['k8s'] })]
    expect(matchesHostQuery(hosts[0], 'root')).toBe(false)
    expect(matchesHostQuery(hosts[0], 'k8s')).toBe(false)
  })

  it('returns an empty list rather than everything when nothing matches', () => {
    expect(filterHosts([host('a')], 'zzz')).toEqual([])
  })
})

describe('favourites', () => {
  it('returns only favourites, sorted by name', () => {
    const hosts = [
      host('c', { name: 'Zulu', isFavorite: true }),
      host('a', { name: 'Alpha', isFavorite: true }),
      host('b', { name: 'Bravo', isFavorite: false }),
    ]

    expect(favoriteHosts(hosts).map(entry => entry.name)).toEqual(['Alpha', 'Zulu'])
  })

  it('treats a missing flag as not favourite', () => {
    expect(favoriteHosts([host('a')])).toEqual([])
  })
})

describe('grouping', () => {
  it('places hosts under their group, in the stored order', () => {
    const groups = [group('second', { order: 2 }), group('first', { order: 1 })]
    const hosts = [host('a', { groupId: 'second' }), host('b', { groupId: 'first' })]

    const sections = groupHosts(hosts, groups)

    expect(sections.map(section => section.group?.id)).toEqual(['first', 'second'])
  })

  it('puts ungrouped hosts in a final section with no group', () => {
    const sections = groupHosts([host('a')], [group('g1', { order: 1 })])

    expect(sections).toHaveLength(1)
    expect(sections[0].group).toBeNull()
    expect(sections[0].hosts.map(entry => entry.id)).toEqual(['a'])
  })

  it('omits a group with no hosts', () => {
    // An empty header during a search reads as a bug, not as information.
    const sections = groupHosts([host('a', { groupId: 'g1' })], [
      group('g1', { order: 1 }),
      group('empty', { order: 2 }),
    ])

    expect(sections.map(section => section.group?.id)).toEqual(['g1'])
  })

  it('keeps a host whose group was deleted instead of losing it', () => {
    // The failure this prevents: deleting a group silently removes its hosts from
    // the panel, and the user cannot find a server they still have.
    const sections = groupHosts([host('a', { groupId: 'deleted' })], [])

    expect(sections).toHaveLength(1)
    expect(sections[0].group).toBeNull()
    expect(sections[0].hosts.map(entry => entry.id)).toEqual(['a'])
  })

  it('sorts hosts inside a group by name', () => {
    const sections = groupHosts(
      [
        host('c', { name: 'Zulu', groupId: 'g1' }),
        host('a', { name: 'Alpha', groupId: 'g1' }),
      ],
      [group('g1')],
    )

    expect(sections[0].hosts.map(entry => entry.name)).toEqual(['Alpha', 'Zulu'])
  })

  it('breaks an order tie by name so the panel does not reshuffle', () => {
    const sections = groupHosts(
      [host('a', { groupId: 'zeta' }), host('b', { groupId: 'alpha' })],
      [group('zeta', { order: 0 }), group('alpha', { order: 0 })],
    )

    expect(sections.map(section => section.group?.id)).toEqual(['alpha', 'zeta'])
  })

  it('returns nothing for no hosts', () => {
    expect(groupHosts([], [group('g1')])).toEqual([])
  })
})
