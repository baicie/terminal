import { describe, expect, it } from 'vitest'
import {
  createTerminalConnectionDeadline,
  remainingTerminalConnectionMs,
  TERMINAL_CONNECTION_DEADLINE_MS,
  TERMINAL_CONNECTION_SAFETY_MARGIN_MS,
} from './terminal-connection-deadline'

describe('terminal connection deadline', () => {
  it('subtracts elapsed time and a small IPC margin from one absolute deadline', () => {
    const deadline = createTerminalConnectionDeadline(500)

    expect(remainingTerminalConnectionMs(deadline, 1_000)).toBe(
      TERMINAL_CONNECTION_DEADLINE_MS -
        500 -
        TERMINAL_CONNECTION_SAFETY_MARGIN_MS,
    )
    expect(remainingTerminalConnectionMs(deadline, deadline)).toBe(0)
  })

  it('leaves an undefined deadline unconstrained for later reconnect attempts', () => {
    expect(remainingTerminalConnectionMs(undefined, 5_000)).toBeUndefined()
  })

  it('returns an integer duration that the Rust u64 IPC contract accepts', () => {
    const remainingMs = remainingTerminalConnectionMs(10_500.25, 1_000.1)

    expect(remainingMs).toBe(9_400)
    expect(Number.isInteger(remainingMs)).toBe(true)
  })
})
