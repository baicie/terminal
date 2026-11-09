// Ranking must never lose a host. The bug this replaces truncated the list to 20
// *before* searching, so hosts 21+ were unreachable from the palette.

import { describe, expect, it } from 'vitest'
import { rankHosts, scoreHost } from './host-ranking'
import type { Host } from '@/types'

function host(overrides: Partial<Host> & { id: string; name: string }): Host {
  return {
    hostname: `${overrides.name}.example.test`,
    port: 22,
    username: 'alice',
    authType: 'password',
    isFavorite: false,
    portForwards: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Host
}

function many(count: number, prefix: string): Host[] {
  return Array.from({ length: count }, (_, index) =>
    host({ id: `${prefix}-${index}`, name: `${prefix}-${index}` }),
  )
}

describe('rankHosts never truncates before searching', () => {
  for (const total of [1, 20, 21, 100, 1000]) {
    it(`finds the last host among ${total}`, () => {
      const hosts = many(total, 'srv')
      const target = hosts[hosts.length - 1]
      const ranked = rankHosts(hosts, target.name)
      expect(ranked[0]?.host.id).toBe(target.id)
    })
  }

  it('finds host 1000 by an exact name match', () => {
    const hosts = many(1000, 'node')
    const ranked = rankHosts(hosts, 'node-999', { limit: 5 })
    expect(ranked[0]?.host.id).toBe('node-999')
  })
})

describe('rankHosts query fields', () => {
  const hosts = [
    host({ id: 'a', name: 'web-prod', hostname: '10.0.0.5', username: 'deploy', tags: ['nginx'] }),
    host({ id: 'b', name: 'db-prod', hostname: 'db.internal', username: 'postgres' }),
    host({ id: 'c', name: 'cache', hostname: 'redis.internal', username: 'ops', tags: ['redis'] }),
  ]

  it('matches by name', () => {
    expect(rankHosts(hosts, 'web')[0]?.host.id).toBe('a')
  })

  it('matches by IP', () => {
    expect(rankHosts(hosts, '10.0.0.5')[0]?.host.id).toBe('a')
  })

  it('matches by username', () => {
    expect(rankHosts(hosts, 'postgres')[0]?.host.id).toBe('b')
  })

  it('matches by tag', () => {
    expect(rankHosts(hosts, 'redis')[0]?.host.id).toBe('c')
  })

  it('returns nothing when nothing matches', () => {
    expect(rankHosts(hosts, 'zzz-nope')).toEqual([])
  })

  it('is case insensitive', () => {
    expect(rankHosts(hosts, 'WEB-PROD')[0]?.host.id).toBe('a')
  })

  it('matches unicode names', () => {
    const unicode = [host({ id: 'u', name: '服务器-生产' })]
    expect(rankHosts(unicode, '服务器')[0]?.host.id).toBe('u')
  })
})

describe('rankHosts prioritisation', () => {
  it('ranks an exact name above a prefix above a substring', () => {
    const hosts = [
      host({ id: 'sub', name: 'my-web-server' }),
      host({ id: 'prefix', name: 'web-server' }),
      host({ id: 'exact', name: 'web' }),
    ]
    const ranked = rankHosts(hosts, 'web')
    expect(ranked.map(entry => entry.host.id)).toEqual(['exact', 'prefix', 'sub'])
  })

  it('lets a favourite break a tie but not outrank a better match', () => {
    const tied = [
      host({ id: 'plain', name: 'app-one' }),
      host({ id: 'fav', name: 'app-two', isFavorite: true }),
    ]
    expect(rankHosts(tied, 'app')[0]?.host.id).toBe('fav')

    const better = [
      host({ id: 'fav', name: 'totally-different', isFavorite: true }),
      host({ id: 'exact', name: 'target' }),
    ]
    expect(rankHosts(better, 'target')[0]?.host.id).toBe('exact')
  })

  it('orders recent hosts first for an empty query', () => {
    const hosts = [
      host({ id: 'a', name: 'alpha' }),
      host({ id: 'b', name: 'bravo' }),
      host({ id: 'c', name: 'charlie' }),
    ]
    const ranked = rankHosts(hosts, '', { recency: { order: ['c', 'a'] } })
    expect(ranked.map(entry => entry.host.id)).toEqual(['c', 'a', 'b'])
  })

  it('puts favourites first for an empty query', () => {
    const hosts = [
      host({ id: 'a', name: 'alpha' }),
      host({ id: 'b', name: 'bravo', isFavorite: true }),
    ]
    expect(rankHosts(hosts, '')[0]?.host.id).toBe('b')
  })

  it('honours the display limit without affecting what is found', () => {
    const hosts = many(50, 'srv')
    // Limited output...
    expect(rankHosts(hosts, 'srv', { limit: 3 })).toHaveLength(3)
    // ...but the host at the end is still ranked first for its exact name.
    const target = hosts[49]
    expect(rankHosts(hosts, target.name, { limit: 3 })[0]?.host.id).toBe(target.id)
  })
})

describe('scoreHost signals', () => {
  it('gives an exact match the highest score', () => {
    const exact = scoreHost(host({ id: 'x', name: 'web' }), 'web')
    const prefix = scoreHost(host({ id: 'y', name: 'web-1' }), 'web')
    const sub = scoreHost(host({ id: 'z', name: 'my-web' }), 'web')
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(sub)
  })

  it('returns negative infinity for a non-match', () => {
    expect(scoreHost(host({ id: 'x', name: 'web' }), 'zzz')).toBe(
      Number.NEGATIVE_INFINITY,
    )
  })
})
