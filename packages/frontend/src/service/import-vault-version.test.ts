// Phase 10.1.1 WP3 — the version a migrated secret is written under must not be
// guessable, and must never be chosen when the row cannot be read.
//
// The defect this locks:
//
// `localNextVersion` reads the row's current reference and returns the next
// generation. When that read fails it used to fall back to a *fixed* 10000 — a
// number that is inside MAX_SUPPORTED_VERSION, so a reference pointing at 10000 is
// readable, and `vaultService.set` overwrites unconditionally. A host whose live
// generation happened to be 10000 would have its password replaced by an imported
// one, silently, while the import reported success. The row keeps pointing at the
// same version, so nothing looks wrong until the next connect.
//
// The catch was also close to unreachable as written: `select()` converts a failed
// query into `[]`, so the fallback rarely ran — and `[]` parses as "no reference",
// which is version 1, the version most likely to be live. Both paths guess; neither
// is safe.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  selectStrict: vi.fn(),
  vaultWrite: vi.fn(),
  vaultRead: vi.fn(),
  vaultRemove: vi.fn(),
  vaultRemoveVersion: vi.fn(),
  availability: vi.fn(),
}))

vi.mock('./database/connection', () => ({
  select: mocks.select,
  selectStrict: mocks.selectStrict,
}))

vi.mock('./vault-secret-provider', () => ({
  vaultSecretProvider: {
    write: mocks.vaultWrite,
    read: mocks.vaultRead,
    remove: mocks.vaultRemove,
    removeVersion: mocks.vaultRemoveVersion,
    availability: mocks.availability,
  },
}))

const { migrateSecretToVault } = await import('./import-vault-migration')

function refAt(version: number, kinds = ['password']) {
  return JSON.stringify({ kinds, provider: 'vault', version })
}

/** A vault that actually stores what it is given, so read-back works. */
class FakeVault {
  readonly entries = new Map<string, string>()

  private key(resource: { type: string; id: string }, version: number, kind: string) {
    return `${resource.type}:${resource.id}:${version}:${kind}`
  }

  install() {
    mocks.vaultWrite.mockImplementation(
      async (
        resource: { type: string; id: string },
        version: number,
        kind: string,
        value: string,
      ) => {
        this.entries.set(this.key(resource, version, kind), value)
      },
    )
    mocks.vaultRead.mockImplementation(
      async (
        resource: { type: string; id: string },
        version: number,
        kind: string,
      ) => this.entries.get(this.key(resource, version, kind)),
    )
    mocks.vaultRemove.mockImplementation(
      async (
        resource: { type: string; id: string },
        version: number,
        kind: string,
      ) => {
        this.entries.delete(this.key(resource, version, kind))
      },
    )
  }

  /** Every version this resource has an entry under. */
  versionsFor(id: string, kind = 'password'): number[] {
    const out: number[] = []
    for (const key of this.entries.keys()) {
      const match = new RegExp(`^host:${id}:(\\d+):${kind}$`).exec(key)
      if (match) out.push(Number(match[1]))
    }
    return out.sort((a, b) => a - b)
  }
}

let vault: FakeVault

beforeEach(() => {
  mocks.select.mockReset().mockResolvedValue([])
  mocks.selectStrict.mockReset().mockResolvedValue([])
  mocks.availability.mockReset().mockResolvedValue({ ok: true })
  mocks.vaultWrite.mockReset()
  mocks.vaultRead.mockReset()
  mocks.vaultRemove.mockReset()
  mocks.vaultRemoveVersion.mockReset().mockResolvedValue([])
  vault = new FakeVault()
  vault.install()
})

describe('a version already in use is never overwritten', () => {
  it('does not write at version 10000 when the row could not be read', async () => {
    // The read fails the way a blocked startup gate or a broken connection fails.
    mocks.selectStrict.mockRejectedValue(new Error('database is not ready'))
    mocks.select.mockResolvedValue([])

    const file = { hosts: [{ id: 'h1', name: 'one', password: 'imported' }] }

    // Refusing the write is the only safe answer: the row might be pointing at
    // any version, and writing a fixed one would replace whatever is there.
    await expect(migrateSecretToVault(file)).rejects.toThrow()
    expect(mocks.vaultWrite).not.toHaveBeenCalled()
  })

  it('does not treat an unreadable row as "nothing stored"', async () => {
    // `select()` turns a failed query into [], which parses as "no reference" and
    // therefore version 1 — the generation most likely to be live.
    mocks.selectStrict.mockRejectedValue(new Error('disk I/O error'))

    const file = { hosts: [{ id: 'h1', name: 'one', password: 'imported' }] }

    await expect(migrateSecretToVault(file)).rejects.toThrow()
    // Nothing was written at version 1.
    expect(mocks.vaultWrite).not.toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.anything(),
      expect.anything(),
    )
  })

  it('refuses rather than guessing when the reference is corrupt', async () => {
    // A corrupt pointer means "something is stored and this build cannot name it".
    // Treating it as "never stored" and writing version 1 is how an import would
    // overwrite the user's live credential.
    mocks.selectStrict.mockResolvedValue([
      { credential_ref: '{"provider":"vault","kinds":["password"],"version":' },
    ])

    const file = { hosts: [{ id: 'h1', name: 'one', password: 'imported' }] }

    await expect(migrateSecretToVault(file)).rejects.toThrow()
    expect(mocks.vaultWrite).not.toHaveBeenCalled()
  })

  it('refuses a reference written by a newer build', async () => {
    mocks.selectStrict.mockResolvedValue([
      { credential_ref: refAt(2_000_000_000) },
    ])

    const file = { hosts: [{ id: 'h1', name: 'one', password: 'imported' }] }

    await expect(migrateSecretToVault(file)).rejects.toThrow()
    expect(mocks.vaultWrite).not.toHaveBeenCalled()
  })
})

describe('the version chosen is one above what the row points at', () => {
  it('writes version 2 when the row points at version 1', async () => {
    mocks.selectStrict.mockResolvedValue([{ credential_ref: refAt(1) }])

    const bound = await migrateSecretToVault({
      hosts: [{ id: 'h1', name: 'one', password: 'imported' }],
    })

    expect(mocks.vaultWrite).toHaveBeenCalledWith(expect.anything(), 2, 'password', 'imported')
    expect(JSON.parse(bound[0].boundRef).version).toBe(2)
  })

  it('writes version 1 when the row has no reference at all', async () => {
    mocks.selectStrict.mockResolvedValue([])

    const bound = await migrateSecretToVault({
      hosts: [{ id: 'h1', name: 'one', password: 'imported' }],
    })

    expect(mocks.vaultWrite).toHaveBeenCalledWith(expect.anything(), 1, 'password', 'imported')
    expect(JSON.parse(bound[0].boundRef).version).toBe(1)
  })

  it('writes a legacy reference forward rather than over it', async () => {
    // A pre-10.1 reference has no version and resolves to LEGACY_VERSION (0). The
    // import must land on 1, not on 0.
    mocks.selectStrict.mockResolvedValue([
      { credential_ref: JSON.stringify({ kinds: ['password'], provider: 'vault' }) },
    ])

    const bound = await migrateSecretToVault({
      hosts: [{ id: 'h1', name: 'one', password: 'imported' }],
    })

    expect(JSON.parse(bound[0].boundRef).version).toBe(1)
  })
})

describe('two writers on the same row cannot pick the same version', () => {
  it('the second import writes above the first, not over it', async () => {
    // Concurrency is serialized by the caller on this device (one import at a
    // time), but a retry after a partial failure must still advance rather than
    // reuse. Simulate: first import lands version 1, the row is updated to point
    // at it, a second import then runs.
    mocks.selectStrict.mockResolvedValue([])
    const first = await migrateSecretToVault({
      hosts: [{ id: 'h1', name: 'one', password: 'first' }],
    })
    const firstVersion = JSON.parse(first[0].boundRef).version

    mocks.selectStrict.mockResolvedValue([{ credential_ref: first[0].boundRef }])
    const second = await migrateSecretToVault({
      hosts: [{ id: 'h1', name: 'one', password: 'second' }],
    })
    const secondVersion = JSON.parse(second[0].boundRef).version

    expect(secondVersion).toBe(firstVersion + 1)
  })
})
