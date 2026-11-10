// Phase 10.3 WP0 — an imported host must keep the id the plan derived.
//
// `materialiseImport` builds rows whose `jumpHostId` points at
// `import-<host>-<port>-<user>` — the id it also gives the bastion row. But
// `addHost` discarded the incoming id and minted a uuid, so the stored bastion
// never had the id its dependants referenced. Every imported ProxyJump pointed at
// a row that could not exist.
//
// The id is part of the import's contract, not an implementation detail: it is
// what makes a second import idempotent and what makes the jump relation survive.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'

const mocks = vi.hoisted(() => ({
  createHost: vi.fn(),
  getHostById: vi.fn(),
  loadHosts: vi.fn(),
}))

vi.mock('@/service/database/hosts', () => ({
  createHost: mocks.createHost,
  getHostById: mocks.getHostById,
  updateHost: vi.fn(),
  deleteHost: vi.fn(),
  getHosts: vi.fn(async () => []),
  getGroups: vi.fn(async () => []),
}))

const { useHostStore } = await import('./host')

function plannedRow(): Omit<Host, 'createdAt' | 'updatedAt'> {
  return {
    id: 'import-db-internal-22-deploy',
    name: 'db',
    hostname: 'db.internal',
    port: 22,
    username: 'deploy',
    authType: 'key',
    jumpHostId: 'import-bastion-example-test-22-admin',
    isFavorite: false,
    portForwards: [],
    tags: ['imported'],
  } as unknown as Omit<Host, 'createdAt' | 'updatedAt'>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createHost.mockResolvedValue(undefined)
  mocks.getHostById.mockImplementation(async (id: string) => ({
    ...plannedRow(),
    id,
    createdAt: 0,
    updatedAt: 0,
  }))
})

describe('addHost keeps the id it was given', () => {
  it('writes the planned id instead of minting a new one', async () => {
    const store = useHostStore.getState()
    await store.addHost(plannedRow() as Host)

    expect(mocks.createHost).toHaveBeenCalledTimes(1)
    const written = mocks.createHost.mock.calls[0][0] as Host
    expect(written.id).toBe('import-db-internal-22-deploy')
  })

  it('so a dependent jumpHostId still names a row that exists', async () => {
    const store = useHostStore.getState()
    await store.addHost(plannedRow() as Host)

    const written = mocks.createHost.mock.calls[0][0] as Host
    // The plan derives both ids from the same function; if addHost rewrote one,
    // the reference below would dangle.
    expect(written.jumpHostId).toBe('import-bastion-example-test-22-admin')
    expect(written.id).not.toBe(written.jumpHostId)
  })

  it('still mints an id for a host created without one', async () => {
    const store = useHostStore.getState()
    const { id: _ignored, ...withoutId } = plannedRow()
    mocks.getHostById.mockImplementation(async (id: string) => ({
      ...withoutId,
      id,
      createdAt: 0,
      updatedAt: 0,
    }))

    await store.addHost(withoutId as Host)
    const written = mocks.createHost.mock.calls[0][0] as Host
    // A manual "new host" has no planned id; it must still get one.
    expect(typeof written.id).toBe('string')
    expect(written.id.length).toBeGreaterThan(0)
  })
})
