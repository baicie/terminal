// AI profile storage: the public half in SQLite, the key in the provider.
//
// The rule this pins: a profile row has a `secret_ref` and no column a key could be
// written into, and the `model:` namespace is separate from `host:` and `ssh-key:`.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  select: vi.fn(),
  vaultWrite: vi.fn(),
  vaultRead: vi.fn(),
  vaultRemoveVersion: vi.fn(),
}))

vi.mock('./connection', () => ({
  executeQuery: mocks.executeQuery,
  select: mocks.select,
}))

vi.mock('@/service/vault-secret-provider', () => ({
  vaultSecretProvider: {
    write: mocks.vaultWrite,
    read: mocks.vaultRead,
    removeVersion: mocks.vaultRemoveVersion,
    isAvailable: vi.fn(async () => true),
    availabilityState: vi.fn(async () => ({ ok: true })),
  },
}))

const {
  listModelProfiles,
  getModelProfile,
  upsertModelProfile,
  setProfileSecret,
  deleteModelProfile,
  hasProfileSecret,
} = await import('./ai-profiles')

const { vaultKey } = await import('@/service/credential-boundary')

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    name: 'Local',
    provider: 'local',
    endpoint: 'http://127.0.0.1:11434/v1',
    model_id: 'llama3',
    temperature: null,
    max_output_tokens: 1024,
    timeout_ms: 30_000,
    streaming: 0,
    secret_ref: null,
    enabled: 1,
    created_at: 100,
    updated_at: 100,
    ...overrides,
  }
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    name: 'Local',
    provider: 'local' as const,
    endpoint: 'http://127.0.0.1:11434/v1',
    modelId: 'llama3',
    temperature: null,
    maxOutputTokens: 1024,
    timeoutMs: 30_000,
    streaming: false,
    secretRef: null,
    enabled: true,
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.executeQuery.mockResolvedValue(undefined)
  mocks.select.mockResolvedValue([])
  // The provider echoes what was written, as a real one does. A fixed return value
  // would make the read-back check pass trivially and hide a real mismatch.
  const stored = new Map<string, string>()
  mocks.vaultWrite.mockImplementation(
    async (resource: { type: string, id: string }, version: number, kind: string, value: string) => {
      stored.set(`${resource.type}:${resource.id}:${version}:${kind}`, value)
    },
  )
  mocks.vaultRead.mockImplementation(
    async (resource: { type: string, id: string }, version: number, kind: string) =>
      stored.get(`${resource.type}:${resource.id}:${version}:${kind}`),
  )
  stored.clear()
  mocks.vaultRemoveVersion.mockResolvedValue([])
})

describe('reading profiles', () => {
  it('maps a row without touching the provider', async () => {
    mocks.select.mockResolvedValue([row()])
    const profiles = await listModelProfiles()
    expect(profiles[0]).toMatchObject({ id: 'p-1', modelId: 'llama3', streaming: false })
    expect(mocks.vaultRead).not.toHaveBeenCalled()
  })

  it('returns null for a missing profile', async () => {
    expect(await getModelProfile('nope')).toBeNull()
  })

  it('keeps a profile usable when its stored reference is damaged', async () => {
    // One bad row must not break the whole settings page. The profile still works for
    // a local endpoint that needs no key; only its reference is unusable.
    mocks.select.mockResolvedValue([row({ secret_ref: 'not json' })])
    const profiles = await listModelProfiles()
    expect(profiles[0].id).toBe('p-1')
  })
})

describe('writing profiles', () => {
  it('inserts a new profile with its public fields', async () => {
    mocks.select.mockResolvedValue([])
    await upsertModelProfile(profile())
    const insert = mocks.executeQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO ai_model_profiles'),
    )
    expect(insert).toBeDefined()
    const params = JSON.stringify(insert?.[1])
    expect(params).toContain('llama3')
    // The insert has no parameter that is a key.
    expect(params).not.toContain('sk-')
  })

  it('updates an existing profile', async () => {
    mocks.select.mockResolvedValue([row()])
    await upsertModelProfile(profile({ name: 'Renamed' }))
    const update = mocks.executeQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE ai_model_profiles'),
    )
    expect(update?.[1]).toContain('Renamed')
  })

  it('keeps the existing reference when asked, even if the caller passed null', async () => {
    // A form edit must not clear a stored key just because it did not re-read one.
    const ref = JSON.stringify({ kinds: ['password'], provider: 'vault', version: 2 })
    mocks.select.mockResolvedValue([row({ secret_ref: ref })])
    await upsertModelProfile(profile({ secretRef: null }), { preserveSecretRef: true })
    const update = mocks.executeQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE ai_model_profiles'),
    )
    expect(update?.[1]).toContain(ref)
  })
})

describe('the key lives in the provider, under its own namespace', () => {
  it('writes under the model namespace, not host or ssh-key', () => {
    // `vaultKey` used to derive the namespace with `type === 'host' ? 'host' :
    // 'ssh-key'`, which put every other type in the ssh-key namespace. A model key
    // and an SSH key sharing an id would then have read each other's secret.
    expect(vaultKey({ type: 'model', id: 'p-1' }, 1, 'password')).toBe('model:p-1:1:password')
    expect(vaultKey({ type: 'host', id: 'p-1' }, 1, 'password')).toBe('host:p-1:1:password')
    expect(vaultKey({ type: 'ssh-key', id: 'p-1' }, 1, 'password')).toBe('ssh-key:p-1:1:password')
  })

  it('writes, reads back, then points the row at the new version', async () => {
    mocks.select.mockResolvedValue([row()])
    await setProfileSecret('p-1', 'sk-secret')

    expect(mocks.vaultWrite).toHaveBeenCalledWith(
      { type: 'model', id: 'p-1' },
      1,
      'password',
      'sk-secret',
    )
    expect(mocks.vaultRead).toHaveBeenCalledWith({ type: 'model', id: 'p-1' }, 1, 'password')
    const update = mocks.executeQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE ai_model_profiles SET secret_ref'),
    )
    // The row stores the *reference* (provider + version + kinds), not the key and not
    // the namespace name — the namespace lives in the vault key, asserted above.
    const serialized = (update?.[1] as unknown[])[0] as string
    const ref = JSON.parse(serialized) as { provider: string, version: number, kinds: string[] }
    expect(ref).toEqual({ kinds: ['password'], provider: 'vault', version: 1 })
    expect(JSON.stringify(update?.[1])).not.toContain('sk-secret')
  })

  it('refuses to point the row at a key it could not read back', async () => {
    // A write that silently failed would otherwise produce a profile that looks
    // configured and cannot authenticate.
    mocks.select.mockResolvedValue([row()])
    mocks.vaultRead.mockResolvedValue('something else')
    await expect(setProfileSecret('p-1', 'sk-secret')).rejects.toThrow(/read back/i)
    const update = mocks.executeQuery.mock.calls.find(([sql]) =>
      String(sql).includes('SET secret_ref'),
    )
    expect(update).toBeUndefined()
  })

  it('increments the version and retires the previous one', async () => {
    const ref = JSON.stringify({ kinds: ['password'], provider: 'vault', version: 3 })
    mocks.select.mockResolvedValue([row({ secret_ref: ref })])
    await setProfileSecret('p-1', 'sk-new')
    expect(mocks.vaultWrite).toHaveBeenCalledWith(
      { type: 'model', id: 'p-1' },
      4,
      'password',
      'sk-new',
    )
    expect(mocks.vaultRemoveVersion).toHaveBeenCalledWith(
      { type: 'model', id: 'p-1' },
      3,
      ['password'],
    )
  })

  it('refuses to write a key for a profile that does not exist', async () => {
    mocks.select.mockResolvedValue([])
    await expect(setProfileSecret('missing', 'sk')).rejects.toThrow(/does not exist/i)
    expect(mocks.vaultWrite).not.toHaveBeenCalled()
  })
})

describe('reading a key', () => {
  // Reading a stored key into the renderer is gone with the request: the key is read
  // on the backend now (`src-tauri/src/ai/`), so there is no function here that could
  // return one. `hasProfileSecret` answers the only question the UI needs.

  it('reports whether a key exists without reading it', () => {
    const ref = JSON.stringify({ kinds: ['password'], provider: 'vault', version: 1 })
    expect(hasProfileSecret(profile({ secretRef: ref }))).toBe(true)
    expect(hasProfileSecret(profile({ secretRef: null }))).toBe(false)
    expect(hasProfileSecret(profile({ secretRef: 'broken' }))).toBe(false)
    // No vault read happens for the existence question.
    expect(mocks.vaultRead).not.toHaveBeenCalled()
  })

  it('exports no function that returns a key', async () => {
    // The absence is the guarantee. A future edit that reintroduced a reader would
    // have to change this assertion too, which is the point of asserting it.
    const module = await import('./ai-profiles')
    expect('getProfileSecret' in module).toBe(false)
  })
})

describe('deleting', () => {
  it('removes the row before the secret', async () => {
    const ref = JSON.stringify({ kinds: ['password'], provider: 'vault', version: 1 })
    mocks.select.mockResolvedValue([row({ secret_ref: ref })])
    await deleteModelProfile('p-1')
    const del = mocks.executeQuery.mock.calls.find(([sql]) =>
      String(sql).includes('DELETE FROM ai_model_profiles'),
    )
    expect(del).toBeDefined()
    expect(mocks.vaultRemoveVersion).toHaveBeenCalled()
  })

  it('is a no-op for a missing profile', async () => {
    mocks.select.mockResolvedValue([])
    await deleteModelProfile('missing')
    expect(mocks.executeQuery).not.toHaveBeenCalled()
  })
})
