// A connection failure must not print the credential it was carrying.
//
// ## The risk
//
// `describeInvokeError` falls back to `JSON.stringify(error)` when the rejection has
// no `message` / `error` / `reason` / `detail` field. That fallback exists so a user
// sees *something* instead of `[object Object]` — but a Rust command that serialises
// its whole argument struct into the error would put the password or the private key
// into a toast, a log line, and the GUI E2E evidence file.
//
// `session_create_ssh_key` takes `password` and `privateKey`. Whether it puts them in
// an error today is not the question this test answers; the question is whether the
// formatter would print them if it did.

import { describe, expect, it } from 'vitest'
import { describeInvokeError } from './session'

const SECRET = 'correct-horse-battery-staple'
const KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAB3Nza\n-----END OPENSSH PRIVATE KEY-----'

describe('an error object carrying credentials', () => {
  it('does not print a password that appears in a field it falls back to', () => {
    const message = describeInvokeError({
      kind: 'AuthFailed',
      host: 'prod.example',
      password: SECRET,
      username: 'deploy',
    })
    expect(
      message,
      'the fallback serialised the whole object, credentials included',
    ).not.toContain(SECRET)
  })

  it('does not print a private key', () => {
    const message = describeInvokeError({
      kind: 'KeyRejected',
      privateKey: KEY,
    })
    expect(message).not.toContain('PRIVATE KEY')
  })

  it('does not print a nested secret', () => {
    const message = describeInvokeError({
      kind: 'AuthFailed',
      request: { password: SECRET, port: 22 },
    })
    expect(message).not.toContain(SECRET)
  })

  it('still says why the connection failed', () => {
    // Redaction must not turn a diagnosable failure into silence.
    const message = describeInvokeError({ kind: 'AuthFailed', password: SECRET })
    expect(message.length).toBeGreaterThan(0)
    expect(message).not.toBe('[object Object]')
  })
})
