import { describe, expect, it } from 'vitest'
import { createTerminalSmokeProtocol } from './terminal-smoke-protocol'
import { terminalSmokeTestConfig } from './terminal-smoke-test-fixtures'

const config = terminalSmokeTestConfig

describe('createTerminalSmokeProtocol', () => {
  it('builds an exact 8 MiB shell-builtin load command', () => {
    const protocol = createTerminalSmokeProtocol(config, 'a1b2c3d4e5f60718')

    expect(protocol.loadCommand).toContain('-lt 8192')
    expect(protocol.loadCommand).toContain("printf '%01024d' 0")
  })

  it('keeps complete markers out of echoed command text', () => {
    const protocol = createTerminalSmokeProtocol(config, 'a1b2c3d4e5f60718')

    expect(protocol.readyCommand).not.toContain(protocol.readyMarker)
    expect(protocol.loadCommand).not.toContain(protocol.loadEndMarker)
    expect(protocol.afterLoadCommand).not.toContain(protocol.afterLoadMarker)
    expect(protocol.resizeProbeCommand).not.toContain(protocol.resizeMarker)
  })

  it('builds a unique Unicode round-trip marker without echoing it verbatim', () => {
    const protocol = createTerminalSmokeProtocol(
      config,
      'a1b2c3d4e5f60718',
    ) as ReturnType<typeof createTerminalSmokeProtocol> & {
      unicodeCommand: string
      unicodeMarker: string
    }

    expect(protocol).toMatchObject({
      unicodeCommand: expect.any(String),
      unicodeMarker: expect.any(String),
    })
    expect(protocol.unicodeMarker).toContain('a1b2c3d4e5f60718')
    expect(protocol.unicodeMarker).toContain('中文🙂')
    expect(protocol.unicodeCommand).toContain('中文🙂')
    expect(protocol.unicodeCommand).not.toContain(protocol.unicodeMarker)
    expect(protocol.unicodeCommand.endsWith('\r')).toBe(true)
  })

  it('sends every command through xterm input as a carriage-return line', () => {
    const protocol = createTerminalSmokeProtocol(config, 'a1b2c3d4e5f60718')

    expect(
      [
        protocol.readyCommand,
        protocol.loadCommand,
        protocol.afterLoadCommand,
        protocol.resizeProbeCommand,
      ].every(command => command.endsWith('\r')),
    ).toBe(true)
  })

  it('rejects a nonce that cannot be safely embedded as a shell literal', () => {
    expect(() => createTerminalSmokeProtocol(config, "bad'nonce")).toThrow(
      'Invalid terminal smoke nonce',
    )
  })
})
