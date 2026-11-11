// WP1/WP2 — what an export says about a credential, and what it must never say.
//
// `sanitizeHostRow` used to write `credential_ref: null` whenever the stored
// reference did not parse. The comment defended it: "the honest description of
// 'unreadable' is 'not something the target can rebind from'". That is true about
// *rebinding* and false about *what happened*: after export → import the target
// cannot tell "this host never stored a credential" from "this host stored one the
// exporting build could not read". The first is a fact; the second is a defect the
// user needs to know about before they trust the backup.
//
// There was no test file for this module at all, which is why the behaviour stood.

import { describe, expect, it } from 'vitest'
import {
  ExportIntegrityError,
  sanitizeHostRow,
  sanitizeSshKeyRow,
} from './export-sanitize'

function hostRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'h1',
    name: 'prod',
    hostname: 'prod.test',
    port: 22,
    username: 'root',
    auth_type: 'password',
    certificate: null,
    group_id: null,
    is_favorite: 0,
    color: null,
    tags: null,
    port_forwards: '[]',
    startup_command: null,
    environment: null,
    jump_host_id: null,
    jump_host_auth_type: null,
    agent_forwarding: 0,
    shell_integration: 'off',
    created_at: 1,
    updated_at: 2,
    // Secret columns that must never appear in the output.
    password: 'hunter2',
    private_key: '-----BEGIN OPENSSH PRIVATE KEY-----',
    passphrase: 'x',
    ...overrides,
  }
}

describe('a host with no credential', () => {
  it('exports credential_ref as null', () => {
    // The one case where null is the truth: there is nothing to describe.
    for (const empty of [null, undefined, '']) {
      const out = sanitizeHostRow(hostRow({ credential_ref: empty }))
      expect(out.credential_ref).toBeNull()
    }
  })
})

describe('a host with a usable reference', () => {
  it('exports the reference verbatim, version included', () => {
    const ref = '{"kinds":["password"],"provider":"vault","version":4}'
    const out = sanitizeHostRow(hostRow({ credential_ref: ref }))
    expect(out.credential_ref).toEqual({
      kinds: ['password'],
      provider: 'vault',
      version: 4,
    })
  })

  it('keeps a legacy reference that carries no version', () => {
    const out = sanitizeHostRow(
      hostRow({ credential_ref: '{"kinds":["password"],"provider":"vault"}' }),
    )
    expect(out.credential_ref).toEqual({
      kinds: ['password'],
      provider: 'vault',
    })
  })
})

describe('a reference this build cannot read must stop the export', () => {
  // Fail-closed. A backup that silently under-describes its source is worse than
  // no backup: the user restores it believing the file is complete.
  const unreadable: Array<[string, unknown]> = [
    ['malformed JSON', '{"kinds":'],
    ['not an object', '"plain string"'],
    ['unknown provider', '{"kinds":["password"],"provider":"keychain","version":1}'],
    ['unsupported version', '{"kinds":["password"],"provider":"vault","version":1000000001}'],
    ['empty kinds', '{"kinds":[],"provider":"vault","version":1}'],
    ['unknown kind', '{"kinds":["totp"],"provider":"vault","version":1}'],
    ['missing provider', '{"kinds":["password"],"version":1}'],
  ]

  it.each(unreadable)('refuses to export a host whose reference is %s', (_name, raw) => {
    expect(() => sanitizeHostRow(hostRow({ credential_ref: raw }))).toThrow(
      ExportIntegrityError,
    )
  })

  it('names the host and the reason, so the user can act on it', () => {
    try {
      sanitizeHostRow(
        hostRow({
          id: 'host-42',
          name: 'production',
          credential_ref: '{"kinds":["password"],"provider":"keychain"}',
        }),
      )
      throw new Error('expected the export to refuse')
    } catch (error) {
      expect(error).toBeInstanceOf(ExportIntegrityError)
      const integrity = error as ExportIntegrityError
      expect(integrity.hostId).toBe('host-42')
      // The message must describe the problem without echoing the reference:
      // the column is metadata today, but "export the raw JSON into an error
      // message" is how a future field becomes a leak.
      expect(integrity.message).toMatch(/keychain/i)
    }
  })

  it('never puts the stored value into the error', () => {
    const secretish = '{"kinds":["password"],"provider":"vault","version":1,"note":"hunter2"}'
    try {
      // The extra field is ignored by the parser, so this one succeeds — the
      // assertion is about the failure path below.
      sanitizeHostRow(hostRow({ credential_ref: secretish }))
    } catch {
      // unreachable
    }
    try {
      sanitizeHostRow(hostRow({ credential_ref: 'hunter2-is-not-json' }))
    } catch (error) {
      expect((error as Error).message).not.toContain('hunter2')
    }
  })
})

describe('secret columns never reach the export', () => {
  it('drops password, private key and passphrase from a host', () => {
    const out = sanitizeHostRow(
      hostRow({ credential_ref: '{"kinds":["password"],"provider":"vault","version":1}' }),
    ) as unknown as Record<string, unknown>
    expect(out.password).toBeUndefined()
    expect(out.private_key).toBeUndefined()
    expect(out.passphrase).toBeUndefined()
    expect(JSON.stringify(out)).not.toContain('hunter2')
    expect(JSON.stringify(out)).not.toContain('BEGIN OPENSSH')
  })

  it('drops the private half of an ssh key', () => {
    const out = sanitizeSshKeyRow({
      id: 'k1',
      name: 'key',
      key_type: 'ed25519',
      public_key: 'pub',
      certificate: null,
      is_encrypted: 0,
      created_at: 1,
      updated_at: 2,
      private_key: '-----BEGIN OPENSSH PRIVATE KEY-----',
      passphrase: 'secret',
    }) as unknown as Record<string, unknown>
    expect(out.private_key).toBeUndefined()
    expect(out.passphrase).toBeUndefined()
    expect(JSON.stringify(out)).not.toContain('BEGIN OPENSSH')
  })
})

describe('an ssh key whose reference cannot be read', () => {
  it('refuses the export instead of dropping the pointer', () => {
    // The key table has a credential_ref column too. Exporting the key without it
    // would silently tell the target "this key had no stored private material".
    expect(() =>
      sanitizeSshKeyRow({
        id: 'k1',
        name: 'key',
        key_type: 'ed25519',
        public_key: 'pub',
        certificate: null,
        is_encrypted: 0,
        created_at: 1,
        updated_at: 2,
        credential_ref: '{"kinds":["privateKey"],"provider":"keychain","version":1}',
      }),
    ).toThrow(ExportIntegrityError)
  })

  it('carries a readable reference through', () => {
    const out = sanitizeSshKeyRow({
      id: 'k1',
      name: 'key',
      key_type: 'ed25519',
      public_key: 'pub',
      certificate: null,
      is_encrypted: 0,
      created_at: 1,
      updated_at: 2,
      credential_ref: '{"kinds":["privateKey"],"provider":"vault","version":2}',
    })
    expect(out.credential_ref).toEqual({
      kinds: ['privateKey'],
      provider: 'vault',
      version: 2,
    })
  })
})
