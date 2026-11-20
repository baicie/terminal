// A reference naming a provider this build does not have.
//
// ## The failure this guards, and why it is not theoretical
//
// `CredentialRef.provider` is a field, so a row can name `system-keychain` or a
// provider a *newer* build invented. `SessionCredentialResolver` takes a default
// provider **and** a registry. The obvious implementation of "look up the provider"
// falls back to the default when the lookup misses — and that is the bug: reading the
// vault for a reference that names another backend returns either a different secret
// or none, and every outcome tells the user something false.
//
// The measured consequence, before the registry existed: a `system-keychain` reference
// was reported as "the vault is locked, unlock it" — an instruction that cannot
// possibly fix it, because the vault is not where that secret lives.
//
// So these tests assert the property at the **entry point the product uses**
// (`resolveSessionCredential`), not on the resolver class alone. A resolver that
// dispatches correctly but is constructed without its registry by the caller is still
// broken; only the entry point can catch that.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isAvailable: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
}))

/*
 * The vault provider is replaced by a double that records every call.
 *
 * That is the assertion: "the vault was never asked" is only checkable if the vault can
 * be observed. `isAvailable` and `get` are the two ways the resolver could touch it, and
 * both are spied.
 */
vi.mock('@/service/vault-secret-provider', () => ({
  vaultSecretProvider: {
    isAvailable: mocks.isAvailable,
    read: mocks.read,
    write: mocks.write,
    remove: mocks.remove,
  },
}))

import { resolveSessionCredential } from '@/features/terminal/services/session-credentials'

/** A host row whose credential lives somewhere this build cannot reach. */
function hostWithProvider(provider: string) {
  return {
    id: 'h-1',
    name: 'prod',
    hostname: 'p.example',
    port: 22,
    username: 'root',
    authType: 'password',
    credentialRef: {
      provider,
      kinds: ['password'],
      version: 1,
    },
  } as Parameters<typeof resolveSessionCredential>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isAvailable.mockResolvedValue(true)
  mocks.read.mockResolvedValue('PK')
})

describe('a provider this build does not implement', () => {
  for (const provider of ['system-keychain', 'windows-credential-manager', 'secret-service']) {
    it(`refuses "${provider}" without reading the vault`, async () => {
      const result = await resolveSessionCredential(hostWithProvider(provider))

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')

      /*
       * The two assertions that make this a real check.
       *
       * `get` is what reads a secret. If it was called, the resolver looked in the
       * vault for a credential that is not there — and whatever it found (or failed to
       * find) would be reported as this host's credential.
       */
      expect(mocks.read).not.toHaveBeenCalled()
      expect(mocks.isAvailable).not.toHaveBeenCalled()

      // The message names the provider and says what to do; it must not send the user
      // to unlock a vault that is not involved.
      expect(result.message).toContain(provider)
      expect(result.message).toMatch(/re-save/i)
      expect(result.message).not.toMatch(/unlock/i)
    })
  }

  it('reports it as a corrupt reference, so the reconnect budget is not consumed', async () => {
    /*
     * The `reason` field is what the session classifier reads. `corrupt-reference` is
     * terminal: retrying cannot help, and a run that spent five reconnect attempts on
     * it would delay the message the user needs by half a minute.
     */
    const result = await resolveSessionCredential(hostWithProvider('system-keychain'))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('corrupt-reference')
  })

  it('a provider id invented by a future build is refused the same way', async () => {
    // Not in `CREDENTIAL_PROVIDER_IDS` at all. It must be treated as unknown-and-
    // unsupported, not as garbage that reads as "nothing stored".
    const result = await resolveSessionCredential(hostWithProvider('quantum-keyring'))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(mocks.read).not.toHaveBeenCalled()
    expect(result.message).toContain('quantum-keyring')
  })
})

describe('the vault provider still works, so the refusals above are not vacuous', () => {
  it('reads the secret for a vault reference', async () => {
    /*
     * Without this case, a resolver that refused *every* reference would pass the three
     * tests above and break the product. This is the control.
     */
    const result = await resolveSessionCredential(hostWithProvider('vault'))

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.password).toBe('PK')
    expect(mocks.read).toHaveBeenCalled()
  })

  it('a reference with no provider field falls back to the default backend', async () => {
    /*
     * `provider` is optional in the reference shape — older rows may omit it. The
     * documented rule is that an absent provider means "the default backend", and that
     * is different from "a provider this build lacks". Conflating them would break
     * every pre-existing host.
     */
    const host = hostWithProvider('vault')
    host.credentialRef = { kinds: ['password'], version: 1 } as typeof host.credentialRef
    const result = await resolveSessionCredential(host)

    expect(result.ok).toBe(true)
    expect(mocks.read).toHaveBeenCalled()
  })
})
