import { describe, expect, it } from 'vitest'
import { TerminalSessionOutputBuffer } from './terminal-session-output-buffer'

function output(sessionId: string, data = sessionId) {
  return {
    session_id: sessionId,
    data,
    is_stderr: false,
  }
}

describe('TerminalSessionOutputBuffer', () => {
  it('bounds pending output by evicting the oldest unknown session', () => {
    const buffer = new TerminalSessionOutputBuffer()

    for (let index = 0; index < 1024; index += 1) {
      buffer.add(output(`session-${index}`))
    }
    buffer.add(output('session-1024'))

    expect(buffer.take('session-0')).toEqual([])
    expect(buffer.take('session-1')).toEqual([output('session-1')])
    expect(buffer.take('session-1024')).toEqual([output('session-1024')])
  })

  it('delivers output queued before activation and drops output after retirement', () => {
    const buffer = new TerminalSessionOutputBuffer()

    buffer.add(output('session-1', 'before'))
    buffer.activate('session-1')
    expect(buffer.take('session-1')).toEqual([output('session-1', 'before')])

    buffer.retire('session-1')
    buffer.add(output('session-1', 'late'))
    expect(buffer.take('session-1')).toEqual([])
  })
})
