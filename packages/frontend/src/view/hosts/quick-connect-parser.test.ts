import { describe, expect, it } from 'vitest'
import { parseQuickConnectInput } from './quick-connect-parser'

describe('parseQuickConnectInput', () => {
  it.each([
    ['server.example.com', { hostname: 'server.example.com', port: 22 }],
    [
      'deploy@server.example.com',
      { hostname: 'server.example.com', username: 'deploy', port: 22 },
    ],
    [
      'deploy@server.example.com:2202',
      { hostname: 'server.example.com', username: 'deploy', port: 2202 },
    ],
    [
      'ssh deploy@server.example.com -p 2202',
      { hostname: 'server.example.com', username: 'deploy', port: 2202 },
    ],
  ])('parses %s into a non-sensitive SSH target', (input, target) => {
    expect(parseQuickConnectInput(input)).toEqual({ ok: true, target })
  })

  it('trims surrounding whitespace and supports ssh without an explicit port', () => {
    expect(parseQuickConnectInput('  ssh deploy@server.example.com  ')).toEqual(
      {
        ok: true,
        target: {
          hostname: 'server.example.com',
          username: 'deploy',
          port: 22,
        },
      },
    )
  })

  it.each(['', ' ', '\t\n'])('rejects empty input', input => {
    expect(parseQuickConnectInput(input)).toEqual({
      ok: false,
      error: 'empty',
    })
  })

  it.each([
    'server.example.com:0',
    'server.example.com:65536',
    'server.example.com:not-a-port',
    'server.example.com:22.5',
    'ssh deploy@server.example.com -p 0',
    'ssh deploy@server.example.com -p 65536',
    'ssh deploy@server.example.com -p nope',
  ])('rejects an invalid port in %s', input => {
    expect(parseQuickConnectInput(input)).toEqual({
      ok: false,
      error: 'invalid-port',
    })
  })

  it.each([
    'ssh deploy@server.example.com -i ~/.ssh/id_ed25519',
    'ssh -o ProxyCommand=evil deploy@server.example.com',
    'ssh deploy@server.example.com -p 22 && whoami',
    'ssh deploy@server.example.com; whoami',
    'server.example.com | whoami',
    'server.example.com$(whoami)',
  ])('rejects unsupported or dangerous arguments in %s', input => {
    expect(parseQuickConnectInput(input)).toEqual({
      ok: false,
      error: 'unsupported-arguments',
    })
  })

  it.each([
    'ssh',
    '@server.example.com',
    'deploy@',
    'deploy@@server.example.com',
    'https://server.example.com',
    'server example.com',
  ])('rejects malformed target %s', input => {
    expect(parseQuickConnectInput(input)).toEqual({
      ok: false,
      error: 'invalid-target',
    })
  })
})
