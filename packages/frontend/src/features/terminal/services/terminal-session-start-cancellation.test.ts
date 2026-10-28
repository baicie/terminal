import { describe, expect, it } from 'vitest'
import type { TerminalRecord } from './terminal-session-manager-types'
import { TerminalSessionStartCancellation } from './terminal-session-start-cancellation'

describe('TerminalSessionStartCancellation', () => {
  it('does not let an old cleanup remove a newer controller set', () => {
    const cancellation = new TerminalSessionStartCancellation()
    const record = {} as TerminalRecord
    const first = cancellation.create(record)

    cancellation.abort(record)
    const second = cancellation.create(record)

    first.cleanup()
    cancellation.abort(record)

    expect(second.signal.aborted).toBe(true)
    expect(first.signal.aborted).toBe(true)
    second.cleanup()
  })
})
