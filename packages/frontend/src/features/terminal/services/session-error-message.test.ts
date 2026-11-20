// A failed connection must say why — and must not say the password.
//
// ## The defect this pins
//
// `sshFailure` used `String(error)`. Tauri serialises a Rust command error across IPC,
// and for any error type that is not a string what arrives is a plain object — so the
// user saw `"[object Object]"` where the reason should have been.
//
// Measured: the SFTP dock reported `connect failed: "[object Object]"` against an sshd
// that answered the same key over the `sftp` client. The reason existed; formatting
// threw it away.
//
// ## The second defect, in the fix for the first
//
// The JSON fallback was given field-name redaction (`redactSecrets`), which covers
// `{ password: … }` and nothing else. Every other branch returned raw text:
//
//   describeInvokeError('bad password: hunter2')          → 'bad password: hunter2'
//   describeInvokeError(new Error('…hunter2'))            → '…hunter2'
//   describeInvokeError({ message: '…hunter2' })          → '…hunter2'
//
// Measured before the value scrubber: 6 of 7 cases carrying a password, passphrase,
// API token or private key printed it in full. So these tests are split in two —
// readability and secrecy — because a fix that satisfies one by breaking the other is
// not a fix. `Jump host password required` becoming `Jump host password [redacted]`
// would be exactly that.

import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

import { describeInvokeError } from './session'
import { redactSecrets, scrubSecrets } from './redact-secrets'

const PASSWORD = 'hunter2-SUPER-SECRET'
const PRIVATE_KEY = [
  '-----BEGIN OPENSSH PRIVATE KEY-----',
  'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB',
  '-----END OPENSSH PRIVATE KEY-----',
].join('\n')

describe('describing an invoke rejection', () => {
  it('keeps a string rejection as-is', () => {
    expect(describeInvokeError('ssh handshake failed')).toBe('ssh handshake failed')
  })

  it('uses an Error message', () => {
    expect(describeInvokeError(new Error('connection refused'))).toBe('connection refused')
  })

  it('finds the message inside a serialised Rust error', () => {
    expect(describeInvokeError({ kind: 'AuthFailed', message: 'Permission denied' })).toBe(
      'Permission denied',
    )
  })

  it('accepts the other field names a command may use', () => {
    expect(describeInvokeError({ error: 'timed out' })).toBe('timed out')
    expect(describeInvokeError({ reason: 'no route' })).toBe('no route')
    expect(describeInvokeError({ detail: 'bad key' })).toBe('bad key')
  })

  it('falls back to JSON rather than "[object Object]"', () => {
    // The exact failure this function exists for.
    expect(describeInvokeError({ kind: 'AuthFailed', attempts: 3 })).toBe(
      '{"kind":"AuthFailed","attempts":3}',
    )
  })
})

describe('a secret never survives, on any branch', () => {
  /*
   * One case per branch, because the branches are what made the first fix insufficient:
   * `redactSecrets` only ever saw the object-fallback path, so a secret in a string
   * travelled untouched through the other four.
   */
  it('in a bare string', () => {
    expect(describeInvokeError(`auth failed for password ${PASSWORD}`)).not.toContain(PASSWORD)
  })

  it('in an Error message', () => {
    expect(describeInvokeError(new Error(`bad password: ${PASSWORD}`))).not.toContain(PASSWORD)
  })

  it('in the `message` field Rust sends', () => {
    expect(describeInvokeError({ message: `bad password: ${PASSWORD}` })).not.toContain(PASSWORD)
  })

  it('in the `error`, `reason` and `detail` fields', () => {
    // Each of the three names `describeInvokeError` accepts, so a fix applied to only
    // the first one fails here rather than passing on a technicality.
    expect(describeInvokeError({ error: `token sk-live-ABCDEF1234567890 rejected` })).not.toContain(
      'sk-live-ABCDEF1234567890',
    )
    expect(describeInvokeError({ reason: `passphrase ${PASSWORD} is wrong` })).not.toContain(PASSWORD)
    expect(describeInvokeError({ detail: `password=${PASSWORD}` })).not.toContain(PASSWORD)
  })

  it('when it is a whole private key', () => {
    const described = describeInvokeError({ error: `key rejected: ${PRIVATE_KEY}` })
    expect(described).not.toContain('BEGIN OPENSSH PRIVATE KEY')
    // The body must be gone too — matching only the header would leave the key material.
    expect(described).not.toContain('b3BlbnNzaC1rZXktdjE')
  })

  it('inside a non-secret field of the JSON fallback, when a keyword marks it', () => {
    /*
     * The gap field-name redaction structurally cannot close: the field is `note`, so
     * nothing about its *name* says secret. A value rule catches it only because the
     * text itself says `password`.
     */
    const described = describeInvokeError({ kind: 'AuthFailed', note: `tried password ${PASSWORD}` })
    expect(described).not.toContain(PASSWORD)
  })

  it('KNOWN LIMIT: an unmarked secret in an unremarkable field survives', () => {
    /*
     * ## Why this is a test rather than a bug
     *
     * `{ note: 'tried hunter2-SUPER-SECRET' }` is not caught, and cannot be: `note` is
     * not a secret-shaped name, and `hunter2-SUPER-SECRET` has no prefix, delimiter or
     * keyword that distinguishes it from an ordinary word. Any rule broad enough to
     * redact it would also redact hostnames, usernames and file paths, which is how a
     * scrubber turns every message into `[redacted]`.
     *
     * Recording it as a failing expectation would leave CI red forever; deleting it
     * would hide the gap. So it is asserted as the *current, documented* behaviour,
     * which means a future change that closes it shows up as this test failing — and
     * the person who closes it will read this comment.
     *
     * The real mitigation is upstream: Rust sends a stable `type` alongside `message`
     * (`SessionErrorDto`), so a message can be rendered from the type without ever
     * carrying the value. This formatter is the last line, and a last line has holes.
     */
    const described = describeInvokeError({ kind: 'AuthFailed', note: 'tried hunter2-SUPER-SECRET' })
    expect(described).toContain('hunter2-SUPER-SECRET')
  })
})

describe('the message stays useful', () => {
  /*
   * ## Why these matter as much as the secrecy cases
   *
   * A scrubber that redacts too eagerly produces `[redacted]` where a reason should be,
   * which sends the user to the logs — or to a support thread — with nothing. The
   * strings below are real ones from `src-tauri/src/session/ssh.rs`.
   */
  const realMessages = [
    'Jump host password required',
    'No authentication method provided for jump host',
    'authentication failed: all methods rejected',
    'failed to parse private key: invalid format',
    'connection refused',
    'session not found',
    'SSH agent has no available identities',
    'The passphrase is incorrect',
    'Password authentication is disabled',
  ]

  for (const message of realMessages) {
    it(`leaves "${message}" readable`, () => {
      expect(describeInvokeError(new Error(message))).toBe(message)
    })
  }

  it('keeps the field name when it redacts a value', () => {
    /*
     * `password=[redacted]` tells the reader *what* was redacted; a bare `[redacted]`
     * leaves them guessing whether the password, the host or the key was the problem.
     */
    expect(describeInvokeError({ detail: `password=${PASSWORD}` })).toContain('password')
  })
})

describe('the two layers, separately', () => {
  it('redactSecrets works on field names at any depth', () => {
    expect(redactSecrets({ a: { b: { password: 'x' } } })).toEqual({
      a: { b: { password: '[redacted]' } },
    })
    expect(redactSecrets({ apiKey: 'x', token: 'y' })).toEqual({
      apiKey: '[redacted]',
      token: '[redacted]',
    })
  })

  it('scrubSecrets works on values with no fields at all', () => {
    expect(scrubSecrets(`using key ${PRIVATE_KEY} for auth`)).not.toContain('BEGIN OPENSSH')
    expect(scrubSecrets('token=abc123 done')).not.toContain('abc123')
  })

  it('scrubSecrets leaves ordinary text untouched', () => {
    // The guard against over-redaction, asserted directly rather than only through
    // the formatter.
    for (const text of ['connection refused', 'exec timed out', 'no route to host']) {
      expect(scrubSecrets(text)).toBe(text)
    }
  })
})
