// UX-1b — "recently connected" must come from real connections.
//
// The rule from the task: a host's edit time is not a connection, and using it
// would put a number in the UI the user cannot account for. The only honest
// source is `connection_logs`, which `session.ts` writes on every successful
// connection (`recordConnectionSuccess`, covering local plus five SSH auth modes).
//
// These tests are pure: they pin the meaning of "recent", which is not expressible
// in the SQL `LIMIT`.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'
import { loadRecentHosts, pickRecentHosts } from './recent-connections'

const getConnectionLogs = vi.hoisted(() =>
  vi.fn<() => Promise<Array<{ host_id: string | null; started_at: number; connection_type: 'ssh' | 'local' | 'serial' }>>>(
    async () => [],
  ),
)

vi.mock('@/service/database', () => ({
  getConnectionLogs,
}))

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

function log(hostId: string | null, startedAt: number) {
  return { host_id: hostId, started_at: startedAt, connection_type: 'ssh' as const }
}

describe('recent connections', () => {
  it('orders by the connection time the log recorded', () => {
    const hosts = [host('a'), host('b'), host('c')]
    const logs = [log('b', 300), log('c', 200), log('a', 100)]

    expect(pickRecentHosts(hosts, logs).map(entry => entry.host.id)).toEqual([
      'b',
      'c',
      'a',
    ])
  })

  it('uses the newest connection per host, not every row', () => {
    const hosts = [host('a'), host('b')]
    const logs = [log('a', 900), log('a', 800), log('b', 700), log('a', 100)]

    const recent = pickRecentHosts(hosts, logs)

    expect(recent.map(entry => entry.host.id)).toEqual(['a', 'b'])
    expect(recent[0].lastConnectedAt).toBe(900)
  })

  it('never substitutes the host edit time for a connection time', () => {
    // The defect this forbids: a host edited yesterday appearing as "recent" with
    // no connection behind it.
    const hosts = [host('edited-only', { updatedAt: 999_999 })]
    expect(pickRecentHosts(hosts, [])).toEqual([])
  })

  it('skips log rows that belong to no saved host', () => {
    // Local terminals and quick-connect profiles log with `host_id: null`. They
    // are not hosts, so they cannot be "recently connected hosts".
    const hosts = [host('a')]
    const logs = [log(null, 900), log('a', 800), log('gone', 700)]

    expect(pickRecentHosts(hosts, logs).map(entry => entry.host.id)).toEqual(['a'])
  })

  it('drops a host that was deleted since it was used', () => {
    // A recent row exists to be opened. A row pointing at a host that no longer
    // exists cannot be opened, so listing it would be a dead link.
    const logs = [log('deleted', 900)]
    expect(pickRecentHosts([], logs)).toEqual([])
  })

  it('keeps two saved hosts that point at the same server', () => {
    // Deduplicating by address would make one of them unreachable from this list;
    // they are separate rows with separate credentials.
    const hosts = [
      host('prod-a', { hostname: 'prod.example.com' }),
      host('prod-b', { hostname: 'prod.example.com' }),
    ]
    const logs = [log('prod-a', 900), log('prod-b', 800)]

    expect(pickRecentHosts(hosts, logs).map(entry => entry.host.id)).toEqual([
      'prod-a',
      'prod-b',
    ])
  })

  it('honours the limit', () => {
    const hosts = Array.from({ length: 12 }, (_, index) => host(`h${index}`))
    const logs = hosts.map((entry, index) => log(entry.id, 1000 - index))

    expect(pickRecentHosts(hosts, logs, 5)).toHaveLength(5)
  })

  it('ignores a row with a timestamp that is not a number', () => {
    const hosts = [host('a'), host('b')]
    const logs = [
      { host_id: 'a', started_at: Number.NaN, connection_type: 'ssh' as const },
      log('b', 500),
    ]

    expect(pickRecentHosts(hosts, logs).map(entry => entry.host.id)).toEqual(['b'])
  })

  it('returns nothing rather than throwing on empty input', () => {
    expect(pickRecentHosts([], [])).toEqual([])
  })
})

describe('loadRecentHosts uses the connection log, never the host row', () => {
  beforeEach(() => {
    getConnectionLogs.mockReset()
    getConnectionLogs.mockResolvedValue([])
  })

  it('returns nothing when there are no connection logs', async () => {
    // The failure this pins: falling back to `hosts.updated_at` so a freshly
    // edited host appears as "recently connected". The task forbids exactly that,
    // and a test of the pure function alone does not catch it, because the fallback
    // lives in the I/O wrapper.
    const hosts = [host('edited-only', { updatedAt: 9_999_999 })]
    await expect(loadRecentHosts(hosts)).resolves.toEqual([])
  })

  it('reads the log table', async () => {
    getConnectionLogs.mockResolvedValue([log('a', 500)])
    const hosts = [host('a')]

    await loadRecentHosts(hosts)

    expect(getConnectionLogs).toHaveBeenCalledOnce()
  })

  it('orders by the logged time when logs exist', async () => {
    getConnectionLogs.mockResolvedValue([log('b', 900), log('a', 100)])
    const hosts = [host('a', { updatedAt: 9_999_999 }), host('b', { updatedAt: 1 })]

    const recent = await loadRecentHosts(hosts)

    // `a` was edited most recently but connected least recently: only the log
    // decides the order.
    expect(recent.map(entry => entry.host.id)).toEqual(['b', 'a'])
    expect(recent[0].lastConnectedAt).toBe(900)
  })
})
