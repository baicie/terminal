import { describe, expect, it } from 'vitest'
import {
  createRawInputProbeCommand,
  expectedRawInputHex,
  parseRawInputProbeResult,
  RawInputProbeParser,
  rawInputProbeMarkers,
} from './protocol'

describe('raw input probe protocol', () => {
  it('keeps the three case payloads stable', () => {
    expect(expectedRawInputHex('sgr-mouse')).toBe('1b5b3c303b333b344d')
    expect(expectedRawInputHex('bracketed-paste')).toBe(
      '1b5b3230307e66697273740d7365636f6e641b5b3230317e',
    )
    expect(expectedRawInputHex('raw-x10')).toBe('1b5b4d20813f')
  })

  it('parses markers split across output chunks and ignores shell noise', () => {
    const parser = new RawInputProbeParser('nonce_1')
    const markers = rawInputProbeMarkers('nonce_1')
    expect(parser.push(`noise\r\n${markers.ready.slice(0, 8)}`)).toEqual([])
    expect(parser.push(`${markers.ready.slice(8)}\r\n`)).toEqual([
      { kind: 'ready' },
    ])
    expect(parser.push(`${markers.result}1b5b`)).toEqual([])
    expect(parser.push(`3c${markers.end}\r\n`)).toEqual([
      { kind: 'result', hex: '1b5b3c' },
    ])
  })

  it('builds an ASCII-only PTY helper with the exact byte count', () => {
    const command = createRawInputProbeCommand(
      'nonce_1',
      expectedRawInputHex('raw-x10'),
    )
    expect(command).toContain(
      'stty -echo -icanon -istrip -icrnl -inlcr -igncr -ixon -ixoff min 1 time 0',
    )
    expect(command).toContain('dd bs=1 count=6')
    expect(command).toContain("od -An -tx1 | tr -d '[:space:]'")
    expect(command).toContain('received_hex=$(dd bs=1 count=6')
    const captureAt = command.indexOf('received_hex=$(dd')
    const publishAt = command.indexOf("printf '\\r\\n%s%s%s%s%s\\r\\n'")
    expect(captureAt).toBeGreaterThanOrEqual(0)
    expect(publishAt).toBeGreaterThan(captureAt)
    const markers = rawInputProbeMarkers('nonce_1')
    expect(command).not.toContain(markers.ready)
    expect(command).not.toContain(markers.result)
    expect(command).not.toContain(markers.end)
    expect(command).toContain('stty sane')
  })

  it('rejects an empty received payload and inconsistent success', () => {
    const config = {
      resultPath: '/tmp/result.json',
      caseName: 'raw-x10' as const,
      expectedHex: expectedRawInputHex('raw-x10'),
    }
    expect(() =>
      parseRawInputProbeResult(
        JSON.stringify({
          caseName: config.caseName,
          durationMs: 1,
          error: 'empty',
          expectedHex: config.expectedHex,
          ok: false,
          receivedHex: '',
        }),
        config,
      ),
    ).toThrow('Invalid raw input probe result')
  })

  it('ignores PTY line endings around the hexadecimal result', () => {
    const parser = new RawInputProbeParser('nonce_1')
    const markers = rawInputProbeMarkers('nonce_1')
    expect(parser.push(markers.ready)).toEqual([{ kind: 'ready' }])
    expect(parser.push(`${markers.result}\r\n1b5b\r\n${markers.end}`)).toEqual([
      { kind: 'result', hex: '1b5b' },
    ])
  })
})
