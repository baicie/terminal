// A fresh install has no vault. The save failed with "the vault is locked", which
// told the user to unlock something that did not exist. The two states need two
// different instructions, and both must leave the host unsaved rather than
// storing a secret in memory only.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  select: vi.fn(),
  vaultWrite: vi.fn(),
  unlocked: vi.fn(async () => false),
  exists: vi.fn(async () => false),
}))

vi.mock('./connection', () => ({
  executeQuery: mocks.executeQuery,
  select: mocks.select,
}))

vi.mock('@/service/vault-secret-provider', () => ({
  vaultSecretProvider: {
    write: mocks.vaultWrite,
    read: vi.fn(),
    remove: vi.fn(),
    isAvailable: vi.fn(async () => Boolean(await mocks.unlocked())),
    availability: vi.fn(async () => {
      if (await mocks.unlocked()) return { ok: true }
      return (await mocks.exists())
        ? { ok: false, state: 'locked' }
        : { ok: false, state: 'uninitialized' }
    }),
  },
}))

vi.mock('@/store/host-mappers', () => ({
  hostRowToHost: (row: unknown) => row,
}))

const { createHost } = await import('./hosts')
const { vaultUnavailableMessage } = await import('@/service/vault-unavailable-message')

function form(overrides: Record<string, unknown> = {}) {
  return {
    id: 'host-1',
    name: 'prod',
    hostname: 'prod.example.test',
    port: 22,
    username: 'alice',
    authType: 'password',
    password: 'secret-password',
    isFavorite: false,
    portForwards: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.unlocked.mockResolvedValue(false)
  mocks.exists.mockResolvedValue(false)
})

describe('a fresh install is told to create, not to unlock', () => {
  it('names creating a vault when none exists', async () => {
    await expect(createHost(form() as never)).rejects.toThrow(/no vault has been set up/i)
  })

  it('does not tell the user to unlock a vault that is not there', async () => {
    await expect(createHost(form() as never)).rejects.not.toThrow(/is locked/i)
  })

  it('writes nothing to SQLite when the save cannot store the secret', async () => {
    await expect(createHost(form() as never)).rejects.toThrow()
    expect(mocks.executeQuery).not.toHaveBeenCalled()
  })
})

describe('an existing but locked vault still says unlock', () => {
  it('names unlocking', async () => {
    mocks.exists.mockResolvedValue(true)
    await expect(createHost(form() as never)).rejects.toThrow(/vault is locked/i)
  })

  it('does not claim no vault exists', async () => {
    mocks.exists.mockResolvedValue(true)
    await expect(createHost(form() as never)).rejects.not.toThrow(
      /no vault has been set up/i,
    )
  })
})

describe('the message never leaks the secret', () => {
  it('mentions neither the password nor the key', async () => {
    const secret = 'super-secret-value'
    await expect(
      createHost(form({ password: secret }) as never),
    ).rejects.not.toThrow(new RegExp(secret))
  })

  it('every state has its own sentence', () => {
    const states = ['uninitialized', 'locked', 'unusable'] as const
    const messages = states.map(state => vaultUnavailableMessage(state))
    expect(new Set(messages).size).toBe(3)
    for (const message of messages) {
      // Each one tells the user what to do, not merely that something broke.
      expect(message).toMatch(/vault/i)
    }
  })
})

describe('an unlocked vault saves normally', () => {
  it('writes the secret to the vault and the row to SQLite', async () => {
    mocks.unlocked.mockResolvedValue(true)
    mocks.vaultWrite.mockResolvedValue(undefined)

    await createHost(form() as never)

    expect(mocks.vaultWrite).toHaveBeenCalledWith('host-1', 'password', 'secret-password')
    expect(mocks.executeQuery).toHaveBeenCalled()
  })
})
