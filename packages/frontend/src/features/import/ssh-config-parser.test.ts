// OpenSSH config parsing: what is imported, what is refused, and why refusing is
// better than guessing.

import { describe, expect, it } from 'vitest'
import { isUsableHostname, parseSshConfig } from './ssh-config-parser'

const SIMPLE = `
Host web
  HostName web.example.test
  User deploy
  Port 2222
  IdentityFile ~/.ssh/id_ed25519
`

describe('SSH config — basic parsing', () => {
  it('parses a single host with every supported field', () => {
    const { hosts } = parseSshConfig(SIMPLE)
    expect(hosts).toEqual([
      {
        aliases: ['web'],
        hostname: 'web.example.test',
        port: 2222,
        username: 'deploy',
        identityFile: '~/.ssh/id_ed25519',
        proxyJump: null,
        line: 2,
      },
    ])
  })

  it('defaults the port to 22 and the hostname to the alias', () => {
    const { hosts } = parseSshConfig('Host db\n  User admin\n')
    expect(hosts[0]).toMatchObject({ hostname: 'db', port: 22, username: 'admin' })
  })

  it('accepts Key=Value form', () => {
    const { hosts } = parseSshConfig('Host a\n  HostName=a.example.test\n  Port=2200\n')
    expect(hosts[0]).toMatchObject({ hostname: 'a.example.test', port: 2200 })
  })

  it('parses ProxyJump', () => {
    const { hosts } = parseSshConfig(
      'Host inner\n  HostName 10.0.0.9\n  ProxyJump bastion\n',
    )
    expect(hosts[0].proxyJump).toBe('bastion')
  })

  it('keeps IPv6 literals usable', () => {
    const { hosts } = parseSshConfig('Host v6\n  HostName [2001:db8::1]\n')
    expect(hosts[0].hostname).toBe('2001:db8::1')
    expect(isUsableHostname(hosts[0].hostname)).toBe(true)
  })

  it('ignores comments and blank lines', () => {
    const { hosts } = parseSshConfig(
      '# leading comment\n\nHost a # trailing\n  HostName a.example.test\n',
    )
    expect(hosts).toHaveLength(1)
    expect(hosts[0].aliases).toEqual(['a'])
  })

  it('honours the first value of a repeated keyword (OpenSSH rule)', () => {
    const { hosts } = parseSshConfig(
      'Host a\n  User first\n  User second\n',
    )
    expect(hosts[0].username).toBe('first')
  })
})

describe('SSH config — aliases and multiple hosts', () => {
  it('takes several aliases on one Host line', () => {
    const { hosts } = parseSshConfig('Host one two three\n  HostName shared.test\n')
    expect(hosts[0].aliases).toEqual(['one', 'two', 'three'])
    expect(hosts[0].hostname).toBe('shared.test')
  })

  it('parses an empty config into nothing, without error', () => {
    expect(parseSshConfig('')).toEqual({ hosts: [], warnings: [] })
    expect(parseSshConfig('\n\n# only comments\n')).toEqual({ hosts: [], warnings: [] })
  })

  it('parses a large config', () => {
    const blocks = Array.from(
      { length: 200 },
      (_, index) => `Host h${index}\n  HostName h${index}.example.test`,
    )
    const { hosts } = parseSshConfig(blocks.join('\n'))
    expect(hosts).toHaveLength(200)
  })

  it('keeps duplicate host names as separate entries (dedupe is the caller\'s job)', () => {
    const { hosts } = parseSshConfig(
      'Host dup\n  HostName one.test\nHost dup\n  HostName two.test\n',
    )
    expect(hosts).toHaveLength(2)
  })
})

describe('SSH config — refused constructs', () => {
  it('warns about Include instead of following it', () => {
    const { warnings, hosts } = parseSshConfig(
      'Include ~/.ssh/config.d/*\nHost a\n  HostName a.test\n',
    )
    expect(warnings.some(w => w.kind === 'include')).toBe(true)
    expect(hosts).toHaveLength(1)
  })

  it('warns about wildcard patterns and does not invent hosts from them', () => {
    const { hosts, warnings } = parseSshConfig(
      'Host web-*\n  User deploy\nHost real\n  HostName real.test\n',
    )
    expect(warnings.some(w => w.kind === 'wildcard')).toBe(true)
    expect(hosts.map(host => host.aliases[0])).toEqual(['real'])
  })

  it('warns about forwardings it does not model', () => {
    const { warnings } = parseSshConfig(
      'Host a\n  HostName a.test\n  LocalForward 8080 localhost:80\n',
    )
    expect(warnings[0].kind).toBe('unsupported-keyword')
    expect(warnings[0].message).toContain('LocalForward')
  })

  it('warns about an unrecognised keyword', () => {
    const { warnings } = parseSshConfig('Host a\n  Frobnicate yes\n')
    expect(warnings[0].kind).toBe('unknown-keyword')
  })

  it('warns about an invalid port and falls back to 22', () => {
    const { hosts, warnings } = parseSshConfig('Host a\n  Port not-a-port\n')
    expect(hosts[0].port).toBe(22)
    expect(warnings[0].message).toMatch(/not a valid port/i)
  })
})

describe('SSH config — malformed input does not throw', () => {
  const cases: Array<[string, string]> = [
    ['binary-ish bytes', '\u0000\u0001\u0002 Host ?\u0007'],
    ['unterminated quote', 'Host "a\n  HostName a.test\n'],
    ['directive before any Host', 'HostName orphan\nHost a\n  HostName a.test\n'],
    ['only whitespace', '   \n\t\n'],
    ['a very long line', `Host a\n  HostName ${'x'.repeat(5000)}\n`],
  ]

  for (const [name, content] of cases) {
    it(`survives ${name}`, () => {
      expect(() => parseSshConfig(content)).not.toThrow()
    })
  }

  it('ignores a keyword with no value', () => {
    const { hosts } = parseSshConfig('Host a\n  User\n  HostName a.test\n')
    expect(hosts[0].username).toBe('')
  })
})

describe('isUsableHostname', () => {
  it('accepts hostnames, IPv4 and IPv6', () => {
    expect(isUsableHostname('example.test')).toBe(true)
    expect(isUsableHostname('10.0.0.1')).toBe(true)
    expect(isUsableHostname('[2001:db8::1]')).toBe(true)
  })

  it('rejects empty values and shell metacharacters', () => {
    expect(isUsableHostname('')).toBe(false)
    expect(isUsableHostname('a b')).toBe(false)
    expect(isUsableHostname('a;rm -rf /')).toBe(false)
    expect(isUsableHostname('$(whoami)')).toBe(false)
  })
})
