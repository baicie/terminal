import { describe, expect, it } from 'vitest'
import {
  createTerminalInputProbeCommand,
  encodeTerminalInputProbeText,
  TerminalInputProbeParser,
} from './probe-protocol'

describe('terminal input probe protocol', () => {
  it('encodes the exact UTF-8 bytes expected from the PTY', () => {
    expect(encodeTerminalInputProbeText('asd')).toBe('617364')
    expect(encodeTerminalInputProbeText('中文')).toBe('e4b8ade69687')
    expect(encodeTerminalInputProbeText('🙂')).toBe('f09f9982')
  })

  it('builds a command whose echo cannot contain a complete marker', () => {
    const command = createTerminalInputProbeCommand('round_7')

    expect(command).toContain("__tip_n='round_7'")
    expect(command).not.toContain(
      '__TERMINAL_INPUT_PROBE_round_7_READY__',
    )
    expect(command).not.toContain(
      '__TERMINAL_INPUT_PROBE_round_7_RESULT__',
    )
    expect(command).toContain('stty -echo')
    expect(command).toContain('IFS= read -r __tip_v')
  })

  it('rejects a nonce that could inject shell syntax', () => {
    expect(() => createTerminalInputProbeCommand("bad'; exit")).toThrow(
      'Invalid terminal input probe nonce',
    )
  })

  it('parses ready and result markers split across arbitrary chunks', () => {
    const parser = new TerminalInputProbeParser('round_7')

    expect(parser.push('shell prompt\r\n__TERMINAL_INPUT_')).toEqual([])
    expect(parser.push('PROBE_round_7_READY__\r\n')).toEqual([
      { kind: 'ready' },
    ])
    expect(parser.push('__TERMINAL_INPUT_PROBE_round_7_RES')).toEqual([])
    expect(parser.push('ULT__6173')).toEqual([])
    expect(parser.push('64__END__\r\nprompt')).toEqual([
      { kind: 'result', hex: '617364' },
    ])
  })

  it('ignores other sessions and parses repeated rounds', () => {
    const parser = new TerminalInputProbeParser('current')

    expect(
      parser.push(
        '__TERMINAL_INPUT_PROBE_old_READY__' +
          '__TERMINAL_INPUT_PROBE_old_RESULT__61__END__',
      ),
    ).toEqual([])
    expect(
      parser.push('__TERMINAL_INPUT_PROBE_current_READY__'),
    ).toEqual([{ kind: 'ready' }])
    expect(
      parser.push('__TERMINAL_INPUT_PROBE_current_RESULT__61__END__'),
    ).toEqual([{ kind: 'result', hex: '61' }])
    expect(
      parser.push(
        '__TERMINAL_INPUT_PROBE_current_READY__' +
          '__TERMINAL_INPUT_PROBE_current_RESULT__62__END__',
      ),
    ).toEqual([{ kind: 'ready' }, { kind: 'result', hex: '62' }])
  })

  it('fails closed when a result is not hexadecimal', () => {
    const parser = new TerminalInputProbeParser('current')

    parser.push('__TERMINAL_INPUT_PROBE_current_READY__')
    expect(() =>
      parser.push(
        '__TERMINAL_INPUT_PROBE_current_RESULT__not-hex__END__',
      ),
    ).toThrow('Terminal input probe returned invalid hexadecimal data')
  })
})
