// A failed connection must say why.
//
// ## The defect this pins
//
// `sshFailure` used `String(error)`. Tauri serialises a Rust command error across IPC,
// and for any error type that is not a string what arrives is a plain object — so the
// user saw `"[object Object]"` where the reason should be.
//
// Measured: the SFTP dock reported `connect failed: "[object Object]"` against an sshd
// that answered the same key over the `sftp` client. The reason existed; formatting
// threw it away.

import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

import { describeInvokeError } from './session'

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

  it('does not produce "[object Object]" for an empty object', () => {
    expect(describeInvokeError({})).not.toBe('[object Object]')
  })

  it('handles null and undefined', () => {
    expect(describeInvokeError(null)).toBe('null')
    expect(describeInvokeError(undefined)).toBe('undefined')
  })
})

describe('the failure that reaches the user', () => {
  it('is the described message, not "[object Object]"', async () => {
    // Drives `SessionService`'s own failure path, because a unit test of the formatter
    // cannot see whether the service calls it — measured: reverting the call site to
    // `String(error)` left the formatter tests green.
    const { sessionService } = await import('./session')
    const host = {
      id: 'h', name: 'n', hostname: '127.0.0.1', port: 1, username: 'u', authType: 'key',
    } as never
    mocks.invoke.mockRejectedValue({ kind: 'AuthFailed', message: 'Permission denied (publickey)' })

    const result = await sessionService.createSshKey({ host })

    expect(result.success).toBe(false)
    expect(result.message).toBe('Permission denied (publickey)')
  })
})
