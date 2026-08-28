import { describe, expect, it } from 'vitest'
import { TerminalSessionLifecycleBuffer } from './terminal-session-lifecycle-buffer'

describe('TerminalSessionLifecycleBuffer', () => {
  it('keeps an error when a normal termination arrives later', () => {
    const buffer = new TerminalSessionLifecycleBuffer()

    buffer.add('session-1', { kind: 'close', message: 'closed' })
    buffer.add('session-1', { kind: 'error', message: 'reader failed' })
    buffer.add('session-1', { kind: 'close', message: 'late close' })

    expect(buffer.take('session-1')).toEqual({
      kind: 'error',
      message: 'reader failed',
    })
  })

  it('reports overflow instead of silently evicting a lifecycle', () => {
    const buffer = new TerminalSessionLifecycleBuffer()

    for (let index = 0; index < 1024; index++) {
      expect(
        buffer.add(`session-${index}`, {
          kind: 'close',
          message: `closed-${index}`,
        }),
      ).toBe(true)
    }

    expect(
      buffer.add('session-overflow', {
        kind: 'close',
        message: 'overflow',
      }),
    ).toBe(false)

    expect(buffer.take('session-0')).toEqual({
      kind: 'error',
      message: 'Terminal lifecycle buffer exceeded 1024 pending sessions',
    })
    expect(buffer.take('session-overflow')).toEqual({
      kind: 'error',
      message: 'Terminal lifecycle buffer exceeded 1024 pending sessions',
    })
  })

  it('ignores late lifecycle events until the session id is activated again', () => {
    const buffer = new TerminalSessionLifecycleBuffer()

    buffer.retire('session-1')
    buffer.add('session-1', { kind: 'error', message: 'late error' })
    expect(buffer.take('session-1')).toBeUndefined()

    buffer.activate('session-1')
    buffer.add('session-1', { kind: 'close', message: 'new close' })
    expect(buffer.take('session-1')).toEqual({
      kind: 'close',
      message: 'new close',
    })
  })
})
