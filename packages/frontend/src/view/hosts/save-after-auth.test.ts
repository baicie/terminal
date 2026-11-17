// Saving after a successful authentication — and never before one.
//
// The design rule the whole feature turns on (`05-ux2-credentials.md` §2):
// `Authenticate` is not `Save`. Two things have to be true, and each has its own way
// of going wrong:
//
// 1. **Nothing is offered before the credential has been proven.** A save prompt that
//    appears when the tab opens would be asking the user to trust a password that may
//    have just been rejected. The existing dialog deliberately has no "remember me"
//    checkbox for exactly that reason; the same reasoning applies to a prompt that
//    simply moves to a different moment.
// 2. **A failed authentication writes nothing.** Not a "pending" row, not a reference,
//    not a Vault entry. This is the one that fails silently and dangerously, so it is
//    tested through the real write path rather than a spy on an abstraction.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  canOfferSaveAfterAuth,
  describeSaveFailure,
  saveOneTimeSecretForHost,
} from './save-after-auth'
import type { Host } from '@/types'

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: 'h-1',
    name: 'Prod',
    hostname: 'prod.example.com',
    port: 22,
    username: 'deploy',
    authType: 'password',
    isFavorite: false,
    group: '',
    tags: [],
    credentialRef: null,
    credentialRefProblem: null,
    ...overrides,
  } as Host
}

describe('a save can only be offered after a real authentication', () => {
  it('refuses to offer when the connection failed', () => {
    // The credential was not proven, so there is nothing the user could meaningfully
    // consent to storing. A prompt here would store a password that just got rejected,
    // which is worse than not storing one at all.
    expect(canOfferSaveAfterAuth({ connected: false, secret: { password: 'p' }, host: host() })).toBe(
      false,
    )
  })

  it('refuses to offer when the user typed nothing', () => {
    expect(canOfferSaveAfterAuth({ connected: true, secret: null, host: host() })).toBe(false)
    expect(canOfferSaveAfterAuth({ connected: true, secret: {}, host: host() })).toBe(false)
  })

  it('refuses to offer for agent authentication, where there is no secret to store', () => {
    // An agent login has no secret in this process at all; offering to "save" it would
    // imply the app holds something it does not.
    expect(
      canOfferSaveAfterAuth({
        connected: true,
        secret: { password: 'x' },
        host: host({ authType: 'agent' }),
      }),
    ).toBe(false)
  })

  it('offers after a successful authentication with a typed secret', () => {
    expect(
      canOfferSaveAfterAuth({ connected: true, secret: { password: 'p' }, host: host() }),
    ).toBe(true)
  })
})

describe('saving goes through the one existing write path', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('writes through updateHost so the damaged-reference guard applies', async () => {
    // A second write path is how a damaged reference gets silently overwritten (the
    // Phase 10.1.1 defect). Saving a one-time secret is an ordinary host update, so it
    // must be one.
    const updateHost = vi.fn(async () => undefined)
    const result = await saveOneTimeSecretForHost(
      { host: host(), secret: { password: 'p' } },
      { updateHost },
    )
    expect(result.ok).toBe(true)
    expect(updateHost).toHaveBeenCalledTimes(1)
    const [id, updates] = updateHost.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(id).toBe('h-1')
    expect(updates.password).toBe('p')
    // Nothing else about the host changes: a save must not rewrite the name, the
    // group, or an unrelated field.
    expect(Object.keys(updates).sort()).toEqual(['password'])
  })

  it('sends the key and its passphrase together for key auth', async () => {
    const updateHost = vi.fn(async () => undefined)
    await saveOneTimeSecretForHost(
      {
        host: host({ authType: 'key' }),
        secret: { privateKey: 'KEY', passphrase: 'pp' },
      },
      { updateHost },
    )
    const [, updates] = updateHost.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(updates.privateKey).toBe('KEY')
    expect(updates.password).toBe('pp')
  })

  it('reports a vault that cannot accept the secret without pretending it saved', async () => {
    const updateHost = vi.fn(async () => {
      throw new Error('Vault is locked')
    })
    const result = await saveOneTimeSecretForHost(
      { host: host(), secret: { password: 'p' } },
      { updateHost },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toMatch(/locked/i)
  })

  it('never reports success when the write threw', async () => {
    // The dangerous version of this feature is one where a failed save still closes
    // the prompt as though it worked: the user believes the password is stored, the
    // next connection asks again, and nothing explains why.
    const updateHost = vi.fn(async () => {
      throw new Error('database is locked')
    })
    const result = await saveOneTimeSecretForHost(
      { host: host(), secret: { password: 'p' } },
      { updateHost },
    )
    expect(result.ok).toBe(false)
  })
})

describe('failure messages name the action', () => {
  it('turns a vault state into what the user should do', () => {
    expect(describeSaveFailure('Vault is locked')).toMatch(/unlock/i)
    expect(describeSaveFailure('Vault is not initialized')).toMatch(/create|set up/i)
  })

  it('passes an unrecognised reason through rather than inventing one', () => {
    expect(describeSaveFailure('disk is full')).toBe('disk is full')
  })
})
