// The import security boundary, exercised through the real serialisation the
// backend receives — not through the sanitiser helpers.
//
// The defect being locked: `sync-import.ts` spread the file's rows straight into
// the payload, and `db_import/writer.rs` bound `password`, `private_key` and
// `passphrase` to real columns. The whitelist on the *export* side did nothing
// about a file imported from an older build, or a hand-written one.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExportData } from './sync-types'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  select: vi.fn(),
  selectStrict: vi.fn(),
  vaultWrite: vi.fn(),
  vaultRead: vi.fn(),
  vaultAvailability: vi.fn(async () => ({ ok: true as const })),
  vaultRemove: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('./database/connection', () => ({
  select: mocks.select,
  // The import path reads the row's current reference through `selectStrict`, so a
  // failed query is distinguishable from "no reference". Callers of this mock keep
  // `select` for the paths that legitimately treat a read failure as empty.
  selectStrict: mocks.selectStrict,
}))
vi.mock('./vault-secret-provider', () => ({
  vaultSecretProvider: {
    write: mocks.vaultWrite,
    read: mocks.vaultRead,
    remove: mocks.vaultRemove,
    removeVersion: vi.fn(async () => []),
    isAvailable: vi.fn(async () => true),
    availability: mocks.vaultAvailability,
  },
}))

const {
  createImportStats,
  diagnoseImport,
  importResources,
  importWithSecretPolicy,
  describeImportSecrets,
} = await import('./sync-import')

const HOST_PASSWORD = 'legacy-host-password'
const HOST_PRIVATE_KEY =
  '-----BEGIN OPENSSH PRIVATE KEY-----\nhost\n-----END OPENSSH PRIVATE KEY-----'
const KEY_PRIVATE_KEY =
  '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----'
const KEY_PASSPHRASE = 'legacy-key-passphrase'

function legacyExport(overrides: Partial<ExportData> = {}): ExportData {
  return {
    version: '1.0.0',
    exportedAt: 1,
    type: 'full',
    hosts: [
      {
        id: 'h1',
        name: 'legacy host',
        hostname: 'legacy.example.test',
        port: 22,
        username: 'root',
        auth_type: 'password',
        password: HOST_PASSWORD,
        private_key: HOST_PRIVATE_KEY,
        certificate: null,
        credential_ref: null,
      },
    ],
    groups: [],
    snippets: [],
    snippetPackages: [],
    workspaces: [],
    workspaceLayouts: [],
    sshKeys: [
      {
        id: 'k1',
        name: 'legacy key',
        key_type: 'ed25519',
        private_key: KEY_PRIVATE_KEY,
        public_key: 'ssh-ed25519 AAAA',
        certificate: null,
        passphrase: KEY_PASSPHRASE,
        is_encrypted: 1,
      },
    ],
    knownHosts: [],
    settings: {},
    ...overrides,
  }
}

function sentPayload(): Record<string, unknown> {
  const call = mocks.invoke.mock.calls.find(([name]) => name === 'import_backup_data')
  expect(call).toBeDefined()
  return (call?.[1] as { payload: Record<string, unknown> }).payload
}

function payloadText(): string {
  return JSON.stringify(sentPayload())
}

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue({
    hosts: 1,
    sshKeys: 1,
    groups: 0,
    snippets: 0,
    snippetPackages: 0,
    knownHosts: 0,
    workspaces: 0,
    credentialsNeedingRebind: [],
    secrets: {
      hostSecrets: {
        hostPasswords: 0,
        hostPrivateKeys: 0,
        sshKeyPrivateKeys: 0,
        sshKeyPassphrases: 0,
      },
      hosts: [],
      keys: [],
    },
  })
  mocks.select.mockReset().mockResolvedValue([])
  mocks.selectStrict.mockReset().mockResolvedValue([])
  mocks.vaultWrite.mockReset().mockResolvedValue(undefined)
  mocks.vaultRemove.mockReset().mockResolvedValue(undefined)
  mocks.vaultAvailability.mockReset().mockResolvedValue({ ok: true })
  // Every write reads back what it was given, keyed by resource+kind so two
  // rows writing the same kind cannot answer for each other.
  mocks.vaultRead.mockReset().mockImplementation(
    async (resource: { id: string }, _version: number, kind: string) => {
      const call = [...mocks.vaultWrite.mock.calls]
        .reverse()
        .find(
          (args) =>
            (args[0] as { id: string }).id === resource.id && args[2] === kind,
        )
      return call?.[3] as string | undefined
    },
  )
})

describe('diagnoseImport', () => {
  it('counts each kind and names no value', () => {
    const diagnosis = diagnoseImport(legacyExport())
    expect(diagnosis.counts).toEqual({
      hostPasswords: 1,
      hostPrivateKeys: 1,
      sshKeyPrivateKeys: 1,
      sshKeyPassphrases: 1,
    })
    expect(diagnosis.needsDecision).toBe(true)
    const text = JSON.stringify(diagnosis)
    expect(text).not.toContain(HOST_PASSWORD)
    expect(text).not.toContain(KEY_PASSPHRASE)
    expect(text).not.toContain('BEGIN OPENSSH')
    // The prompt still names the rows, so the user knows what they are deciding.
    expect(diagnosis.rows.map(row => row.id).sort()).toEqual(['h1', 'k1'])
  })

  it('reports a file with no plaintext as needing no decision', () => {
    const diagnosis = diagnoseImport({ hosts: [{ id: 'h', name: 'n' }], sshKeys: [] })
    expect(diagnosis.needsDecision).toBe(false)
    expect(describeImportSecrets(diagnosis)).toMatch(/no plaintext/i)
  })

  it('reports a source-device reference even when the file has no plaintext', () => {
    const diagnosis = diagnoseImport({
      hosts: [
        {
          id: 'h1',
          name: 'migrated',
          credential_ref: JSON.stringify({
            kinds: ['password'],
            provider: 'vault',
          }),
        },
      ],
      sshKeys: [],
    })
    expect(diagnosis.needsDecision).toBe(false)
    expect(diagnosis.sourceCredentialRefs).toHaveLength(1)
    expect(diagnosis.sourceCredentialRefs[0].kinds).toEqual(['password'])
  })

  it('treats a damaged reference as "had a credential", not as "none"', () => {
    const diagnosis = diagnoseImport({
      hosts: [{ id: 'h1', name: 'broken', credential_ref: 'not-json' }],
      sshKeys: [],
    })
    expect(diagnosis.sourceCredentialRefs).toHaveLength(1)
  })

  it('treats an empty or whitespace secret as absent', () => {
    const diagnosis = diagnoseImport({
      hosts: [{ id: 'h1', name: 'n', password: '', private_key: '   ' }],
      sshKeys: [],
    })
    expect(diagnosis.needsDecision).toBe(false)
  })
})

describe('the payload never carries a plaintext secret', () => {
  it('drops the secret fields even when the file has them', async () => {
    await importResources(legacyExport(), 'merge', createImportStats(), {
      policy: 'discard',
    })

    const text = payloadText()
    expect(text).not.toContain(HOST_PASSWORD)
    expect(text).not.toContain(HOST_PRIVATE_KEY)
    expect(text).not.toContain(KEY_PRIVATE_KEY)
    expect(text).not.toContain(KEY_PASSPHRASE)
    // The rows themselves still travel, minus what must not.
    const payload = sentPayload() as { hosts: Record<string, unknown>[] }
    expect(payload.hosts[0].name).toBe('legacy host')
    expect(payload.hosts[0]).not.toHaveProperty('password')
    expect(payload.hosts[0]).not.toHaveProperty('private_key')
  })

  it('carries the policy so the backend can refuse an undecided file', async () => {
    await importResources(legacyExport(), 'merge', createImportStats(), {
      policy: 'discard',
    })
    expect(sentPayload().secrets).toBe('discard')
  })

  it('defaults to reject when the caller says nothing', async () => {
    await importResources(legacyExport(), 'merge', createImportStats())
    expect(sentPayload().secrets).toBe('reject')
  })

  it('never forwards the file\'s own credential_ref as a binding', async () => {
    await importResources(
      legacyExport({
        hosts: [
          {
            id: 'h1',
            name: 'from another device',
            credential_ref: JSON.stringify({
              kinds: ['password'],
              provider: 'vault',
            }),
          },
        ],
        sshKeys: [],
      }),
      'merge',
      createImportStats(),
      { policy: 'discard' },
    )
    const payload = sentPayload() as { hosts: Record<string, unknown>[] }
    expect(payload.hosts[0]).not.toHaveProperty('bound_credential_ref')
  })
})

describe('migrate policy', () => {
  it('writes each value to the vault, reads it back, then binds a reference', async () => {
    await importWithSecretPolicy(legacyExport(), 'merge', createImportStats(), {
      policy: 'migrate',
    })

    // Both secrets of both rows reached the vault.
    expect(mocks.vaultWrite).toHaveBeenCalledWith(
      { type: 'host', id: 'h1' },
      1,
      'password',
      HOST_PASSWORD,
    )
    expect(mocks.vaultWrite).toHaveBeenCalledWith(
      { type: 'ssh-key', id: 'k1' },
      1,
      'passphrase',
      KEY_PASSPHRASE,
    )

    const payload = sentPayload() as {
      hosts: Record<string, unknown>[]
      sshKeys: Record<string, unknown>[]
      secrets: string
    }
    expect(payload.secrets).toBe('migrate')
    // The plaintext never reaches the command, and each row names its binding.
    expect(JSON.stringify(payload)).not.toContain(HOST_PASSWORD)
    expect(payload.hosts[0].bound_credential_ref).toBe(
      JSON.stringify({
        kinds: ['password', 'privateKey'],
        provider: 'vault',
        version: 1,
      }),
    )
    expect(payload.sshKeys[0].bound_credential_ref).toBe(
      JSON.stringify({
        kinds: ['privateKey', 'passphrase'],
        provider: 'vault',
        version: 1,
      }),
    )
  })

  it('refuses to import when the vault is locked', async () => {
    mocks.vaultAvailability.mockResolvedValue({
      ok: false as never,
      state: 'locked',
    } as never)

    await expect(
      importWithSecretPolicy(legacyExport(), 'merge', createImportStats(), {
        policy: 'migrate',
      }),
    ).rejects.toThrow(/vault/i)

    // Nothing was written: the import has not half-happened.
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.vaultWrite).not.toHaveBeenCalled()
  })

  it('removes the vault entries it wrote when the import fails', async () => {
    mocks.invoke.mockRejectedValue('import rejected: something')

    await expect(
      importWithSecretPolicy(legacyExport(), 'merge', createImportStats(), {
        policy: 'migrate',
      }),
    ).rejects.toBeDefined()

    // Every secret written for the failed import is removed again, so a retry
    // does not accumulate unreachable ciphertext. Both rows moved both kinds.
    expect(mocks.vaultRemove).toHaveBeenCalledTimes(4)
  })

  it('does not write anything to the vault for a clean file', async () => {
    await importWithSecretPolicy(
      { ...legacyExport(), hosts: [], sshKeys: [] },
      'merge',
      createImportStats(),
      { policy: 'migrate' },
    )
    expect(mocks.vaultWrite).not.toHaveBeenCalled()
  })

  it('fails the whole import when the vault does not return the value it stored', async () => {
    mocks.vaultRead.mockResolvedValue('something else')

    await expect(
      importWithSecretPolicy(legacyExport(), 'merge', createImportStats(), {
        policy: 'migrate',
      }),
    ).rejects.toThrow(/vault did not return/i)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

describe('settings travel through the same boundary', () => {
  it('drops a token the file names directly in its settings map', async () => {
    await importResources(
      legacyExport({
        hosts: [],
        sshKeys: [],
        settings: {
          syncServiceToken: 'leaked-token',
          app_settings: JSON.stringify({
            theme: 'dark',
            syncServiceToken: 'leaked-token',
          }),
        },
      }),
      'merge',
      createImportStats(),
      { policy: 'reject' },
    )

    const text = payloadText()
    expect(text).not.toContain('leaked-token')
    const settings = sentPayload().settings as Record<string, string>
    // The preference still restores.
    expect(JSON.parse(settings.app_settings)).toEqual({ theme: 'dark' })
  })
})

describe('an import cannot overwrite a live credential generation', () => {
  // `vaultService.set` overwrites unconditionally, so writing a migrated secret at
  // version 1 replaces whatever this device already has at version 1 — and any host
  // whose row points there keeps pointing there in merge mode, so it silently
  // resolves to the imported value. The version must come from the local row.
  it('writes above the version the local row already points at', async () => {
    mocks.selectStrict.mockResolvedValue([
      {
        credential_ref: JSON.stringify({
          kinds: ['password'],
          provider: 'vault',
          version: 3,
        }),
      },
    ])

    await importWithSecretPolicy(legacyExport(), 'merge', createImportStats(), {
      policy: 'migrate',
    })

    const hostWrites = mocks.vaultWrite.mock.calls.filter(
      ([resource]) => (resource as { type: string }).type === 'host',
    )
    expect(hostWrites.length).toBeGreaterThan(0)
    // Version 4, not 1: the live generation at 3 is untouched.
    expect(hostWrites.every(([, version]) => version === 4)).toBe(true)
  })

  it('uses version 1 only when the local row has no credential', async () => {
    mocks.select.mockResolvedValue([])
    await importWithSecretPolicy(legacyExport(), 'merge', createImportStats(), {
      policy: 'migrate',
    })
    const hostWrites = mocks.vaultWrite.mock.calls.filter(
      ([resource]) => (resource as { type: string }).type === 'host',
    )
    expect(hostWrites.every(([, version]) => version === 1)).toBe(true)
  })

  it('never writes the same version it read', async () => {
    mocks.selectStrict.mockResolvedValue([
      {
        credential_ref: JSON.stringify({
          kinds: ['password'],
          provider: 'vault',
          version: 1,
        }),
      },
    ])
    await importWithSecretPolicy(legacyExport(), 'merge', createImportStats(), {
      policy: 'migrate',
    })
    const hostWrites = mocks.vaultWrite.mock.calls.filter(
      ([resource]) => (resource as { type: string }).type === 'host',
    )
    // The previous implementation wrote exactly this collision.
    expect(hostWrites.some(([, version]) => version === 1)).toBe(false)
  })
})
