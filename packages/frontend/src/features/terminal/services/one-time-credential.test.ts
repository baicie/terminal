// Connecting once without storing anything.
//
// The design rule: `Authenticate` is not `Save`, and a failed authentication must
// never persist a credential. Before this module there was no UI path to either —
// a remote tab resolved its secret from `credentialRef`, so a host with no stored
// secret could not be connected at all.

import { beforeEach, describe, expect, it } from 'vitest'
import type { Host } from '@/types'
import {
  needsOneTimeCredential,
  oneTimeCredentialBlocker,
  registerOneTimeProfile,
} from './one-time-credential'
import {
  getTemporaryTerminalProfile,
  clearTemporaryTerminalProfiles,
} from './temporary-terminal-profiles'

const base = {
  id: 'h-1',
  name: 'prod',
  hostname: 'prod.test',
  port: 22,
  username: 'deploy',
  authType: 'password',
  credentialRef: null,
  credentialRefProblem: null,
} as unknown as Host

beforeEach(() => {
  clearTemporaryTerminalProfiles()
})

describe('does this host need a one-time credential', () => {
  it('yes when nothing is stored', () => {
    expect(needsOneTimeCredential(base)).toBe(true)
  })

  it('no when a readable reference exists', () => {
    expect(
      needsOneTimeCredential({
        ...base,
        credentialRef: { kinds: ['password'], provider: 'vault', version: 1 },
      } as unknown as Host),
    ).toBe(false)
  })

  it('no for agent auth, which resolves nothing', () => {
    expect(
      needsOneTimeCredential({ ...base, authType: 'agent' } as unknown as Host),
    ).toBe(false)
  })

  it('no when the host object already carries a secret', () => {
    expect(
      needsOneTimeCredential({ ...base, password: 'typed' } as unknown as Host),
    ).toBe(false)
  })

  it('no for a damaged reference: a typed password cannot fix it', () => {
    // The connection path refuses before it looks at any inline secret, so
    // offering the form would be a form that always fails. Clearing or re-saving
    // in the host dialog is the way out, and the blocker says so.
    const host = {
      ...base,
      credentialRefProblem: { kind: 'malformed', detail: 'not JSON' },
    } as unknown as Host
    expect(needsOneTimeCredential(host)).toBe(false)
    expect(oneTimeCredentialBlocker(host)).toMatch(/cannot read/i)
  })

  it('no for an imported host whose key was never bound', () => {
    const host = { ...base, identityFilePath: '~/.ssh/id_ed25519' } as unknown as Host
    expect(needsOneTimeCredential(host)).toBe(false)
    expect(oneTimeCredentialBlocker(host)).toMatch(/not been bound/i)
  })

  it('has no blocker for the ordinary "type it once" case', () => {
    expect(oneTimeCredentialBlocker(base)).toBeNull()
  })

  it('blocks certificate auth with no certificate configured', () => {
    // Certificate auth needs two things: the certificate (public, part of the host
    // configuration) and the key it was issued for (the secret the dialog asks
    // for). The dialog collects only the key, so a host with no certificate would
    // send `certificate: ''` and fail the handshake with an error naming nothing
    // the user can act on.
    const host = { ...base, authType: 'cert', certificate: null } as unknown as Host
    expect(oneTimeCredentialBlocker(host)).toMatch(/certificate/i)
  })

  it('allows certificate auth once a certificate is configured', () => {
    const host = {
      ...base,
      authType: 'cert',
      certificate: 'ssh-ed25519-cert-v01@openssh.com AAAA',
    } as unknown as Host
    expect(oneTimeCredentialBlocker(host)).toBeNull()
    expect(needsOneTimeCredential(host)).toBe(true)
  })
})

describe('registerOneTimeProfile', () => {
  it('puts a copy carrying the secret in the process-local map', () => {
    const id = registerOneTimeProfile(base, { password: 'hunter2' })
    const stored = getTemporaryTerminalProfile(id)
    expect(stored?.password).toBe('hunter2')
    expect(stored?.id).toBe('h-1')
  })

  it('never mutates the host it was given', () => {
    // The saved row is what other code reads. A mutation here would put the typed
    // password on the object the store holds, which is the "secret outside the
    // provider" state the whole boundary exists to prevent.
    const host = { ...base } as Host
    registerOneTimeProfile(host, { password: 'hunter2' })
    expect(host.password).toBeUndefined()
    expect(host.privateKey).toBeUndefined()
  })

  it('drops the reference so the connection cannot read a stored secret', () => {
    // A one-time profile must not silently fall back to the vault: the user asked
    // for *this* password, and resolving a different one would authenticate as
    // somebody else or fail for reasons the dialog cannot explain.
    const id = registerOneTimeProfile(
      {
        ...base,
        credentialRef: { kinds: ['password'], provider: 'vault', version: 7 },
      } as unknown as Host,
      { password: 'typed' },
    )
    expect(getTemporaryTerminalProfile(id)?.credentialRef).toBeNull()
  })

  it('carries a private key and its passphrase as separate values', () => {
    const id = registerOneTimeProfile(
      { ...base, authType: 'key' } as unknown as Host,
      { privateKey: 'KEY', passphrase: 'phrase' },
    )
    const stored = getTemporaryTerminalProfile(id)
    expect(stored?.privateKey).toBe('KEY')
    // The launcher passes `password` to `session_create_ssh_key` as the key's
    // passphrase, so that is where a passphrase has to land — and an account
    // password must not be invented when only a passphrase was typed.
    expect(stored?.password).toBe('phrase')
  })

  it('does not let a passphrase overwrite a typed account password', () => {
    // Both fields present is the "password plus key" case; the password field is
    // the account password for password auth and the passphrase for key auth, so
    // the explicit `password` wins rather than being silently replaced.
    const id = registerOneTimeProfile(base, { password: 'acct', passphrase: 'phrase' })
    expect(getTemporaryTerminalProfile(id)?.password).toBe('acct')
  })

  it('gives every connection its own profile', () => {
    const first = registerOneTimeProfile(base, { password: 'a' })
    const second = registerOneTimeProfile(base, { password: 'b' })
    expect(first).not.toBe(second)
    expect(getTemporaryTerminalProfile(first)?.password).toBe('a')
    expect(getTemporaryTerminalProfile(second)?.password).toBe('b')
  })
})
