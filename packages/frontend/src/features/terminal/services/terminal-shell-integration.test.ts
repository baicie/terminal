import { describe, expect, it } from 'vitest'
import {
  parseShellIntegrationOsc,
  ShellIntegrationState,
  type ShellIntegrationEvent,
} from './terminal-shell-integration'

describe('shell integration OSC parser', () => {
  it('parses OSC 133 command lifecycle markers', () => {
    const events = ['A', 'B', 'C', 'D;0', 'D;127']
      .map(data => parseShellIntegrationOsc(133, data))
      .filter((event): event is ShellIntegrationEvent => event !== undefined)

    expect(events).toEqual([
      { kind: 'prompt-start' },
      { kind: 'command-start' },
      { kind: 'command-output' },
      { kind: 'command-finished', exitCode: 0 },
      { kind: 'command-finished', exitCode: 127 },
    ])
  })

  it('parses and normalizes a file URI from OSC 7', () => {
    expect(
      parseShellIntegrationOsc(7, 'file:///Users/demo/My%20Project'),
    ).toEqual({ kind: 'cwd', cwd: '/Users/demo/My Project' })
    expect(parseShellIntegrationOsc(7, 'file://localhost/tmp')).toEqual({
      kind: 'cwd',
      cwd: '/tmp',
    })
    expect(parseShellIntegrationOsc(7, 'file:///C:/Users/demo')).toEqual({
      kind: 'cwd',
      cwd: 'C:/Users/demo',
    })
  })

  it('tracks the latest cwd and command exit code without guessing input', () => {
    const state = new ShellIntegrationState()

    state.consume(7, 'file:///srv/app')
    state.consume(133, 'B')
    state.consume(133, 'C')
    state.consume(133, 'D;2')

    expect(state.snapshot()).toEqual({
      phase: 'prompt',
      cwd: '/srv/app',
      lastExitCode: 2,
    })
  })

  it('rejects malformed or unsafe OSC payloads', () => {
    expect(parseShellIntegrationOsc(133, 'D;not-a-code')).toBeUndefined()
    expect(parseShellIntegrationOsc(133, 'A\n')).toBeUndefined()
    expect(parseShellIntegrationOsc(7, 'https://example.com/tmp')).toBeUndefined()
    expect(parseShellIntegrationOsc(7, `file:///${'x'.repeat(4097)}`)).toBeUndefined()
    expect(parseShellIntegrationOsc(999, 'A')).toBeUndefined()
  })
})
