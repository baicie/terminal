/**
 * Parser for OpenSSH `~/.ssh/config`.
 *
 * Scope, stated up front because guessing is worse than refusing:
 *
 * Parsed: `Host` blocks (including multiple patterns on one line), `HostName`,
 * `User`, `Port`, `IdentityFile`, `ProxyJump`, `HostName` with IPv6 literals.
 *
 * Ignored with a warning: every other keyword (`ForwardAgent`, `LocalForward`,
 * `ServerAliveInterval`, …). They are real settings this app may not model yet;
 * silently dropping them without telling the user would look like a faithful
 * import and then behave differently.
 *
 * Not followed: `Include`, and wildcard patterns (`Host web-*`). A pattern is not
 * a host: expanding it would mean inventing concrete hosts the user never wrote,
 * and following an `Include` would read files outside the one the user picked.
 * Both are reported so the user knows the imported set is smaller than the file.
 *
 * Never executed: nothing here runs a shell, resolves DNS or touches the network.
 */

export interface ParsedSshHost {
  /** `Host` alias(es) from the config; the first one is the display name. */
  aliases: string[]
  hostname: string
  port: number
  username: string | null
  identityFile: string | null
  proxyJump: string | null
  /** 1-based line the block starts on, for the preview. */
  line: number
}

export type SshConfigWarningKind =
  | 'unsupported-keyword'
  | 'include'
  | 'wildcard'
  | 'unknown-keyword'

export interface SshConfigWarning {
  kind: SshConfigWarningKind
  line: number
  message: string
}

export interface ParsedSshConfig {
  hosts: ParsedSshHost[]
  warnings: SshConfigWarning[]
}

const DEFAULT_PORT = 22

/** Keys this importer understands; everything else becomes a warning. */
const KNOWN_KEYS = new Set([
  'host',
  'hostname',
  'user',
  'port',
  'identityfile',
  'proxyjump',
])

/**
 * Keywords that are common enough to name in the warning rather than lumping into
 * "unknown", so the user knows their port forwarding was not imported.
 */
const RECOGNISED_BUT_UNSUPPORTED = new Set([
  'forwardagent',
  'localforward',
  'remoteforward',
  'dynamicforward',
  'serveraliveinterval',
  'serveralivecountmax',
  'identitiesonly',
  'preferredauthentications',
  'proxycommand',
  'canonicalizehostname',
  'compression',
  'tcpkeepalive',
  'stricthostkeychecking',
])

interface RawBlock {
  aliases: string[]
  options: Map<string, string>
  line: number
  /** Options that appeared more than once keep their first value (OpenSSH rule). */
  seenKeys: Set<string>
}

/**
 * Splits a config line into keyword and value, honouring `Key value` and
 * `Key=value`. `key` is lower-cased for matching; `display` keeps the spelling the
 * user wrote so warnings quote their config rather than our normalisation.
 */
function splitDirective(
  line: string,
): { key: string; display: string; value: string } | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  const equals = trimmed.indexOf('=')
  const space = trimmed.search(/\s/)
  let splitAt = -1
  if (equals !== -1 && (space === -1 || equals < space)) splitAt = equals
  else if (space !== -1) splitAt = space
  if (splitAt === -1) {
    return { key: trimmed.toLowerCase(), display: trimmed, value: '' }
  }
  const display = trimmed.slice(0, splitAt)
  return {
    key: display.toLowerCase(),
    display,
    value: trimmed.slice(splitAt + 1).trim().replace(/^"|"$/g, ''),
  }
}

function isWildcard(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?') || pattern.startsWith('!')
}

function isIpv6Literal(value: string): boolean {
  return /^\[[0-9a-fA-F:.]+\]$/.test(value) || /^[0-9a-fA-F:]+:[0-9a-fA-F:]*$/.test(value)
}

/** Strips the brackets OpenSSH requires around an IPv6 HostName. */
function normaliseHostname(value: string): string {
  if (/^\[.+\]$/.test(value)) return value.slice(1, -1)
  return value
}

export function parseSshConfig(content: string): ParsedSshConfig {
  const warnings: SshConfigWarning[] = []
  const blocks: RawBlock[] = []
  let current: RawBlock | null = null

  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1
    const raw = lines[index]
    // `#` starts a comment anywhere a directive could start.
    const withoutComment = raw.replace(/(^|\s)#.*$/, '')
    const directive = splitDirective(withoutComment)
    if (directive === null) continue
    const { key, display, value } = directive

    if (key === 'host') {
      const aliases = value.split(/\s+/).filter(Boolean)
      current = {
        aliases,
        options: new Map(),
        line: lineNumber,
        seenKeys: new Set(),
      }
      blocks.push(current)
      for (const alias of aliases) {
        if (isWildcard(alias)) {
          warnings.push({
            kind: 'wildcard',
            line: lineNumber,
            message: `Host pattern "${alias}" was not imported: a pattern is not a host.`,
          })
        }
      }
      continue
    }

    if (key === 'include') {
      warnings.push({
        kind: 'include',
        line: lineNumber,
        message: `Include "${value}" was not followed: only the file you selected is read.`,
      })
      continue
    }

    if (!KNOWN_KEYS.has(key)) {
      const known = RECOGNISED_BUT_UNSUPPORTED.has(key)
      warnings.push({
        kind: known ? 'unsupported-keyword' : 'unknown-keyword',
        line: lineNumber,
        message: known
          ? `"${display}" is not imported yet; check this host after importing.`
          : `Unrecognised keyword "${display}" was ignored.`,
      })
      continue
    }

    if (current === null) {
      warnings.push({
        kind: 'unknown-keyword',
        line: lineNumber,
        message: `"${display}" appears before any Host block and was ignored.`,
      })
      continue
    }
    // OpenSSH keeps the first value it sees for a keyword within a block.
    if (current.seenKeys.has(key)) continue
    current.seenKeys.add(key)
    current.options.set(key, value)
  }

  const hosts: ParsedSshHost[] = []
  for (const block of blocks) {
    const concrete = block.aliases.filter(alias => !isWildcard(alias))
    if (concrete.length === 0) continue

    const hostnameRaw = block.options.get('hostname')
    const portRaw = block.options.get('port')
    let port = DEFAULT_PORT
    if (portRaw !== undefined) {
      const parsed = Number(portRaw)
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535) {
        port = parsed
      } else {
        warnings.push({
          kind: 'unknown-keyword',
          line: block.line,
          message: `Port "${portRaw}" is not a valid port; 22 is used instead.`,
        })
      }
    }

    const hostname = hostnameRaw === undefined
      ? concrete[0]
      : normaliseHostname(hostnameRaw)

    hosts.push({
      aliases: concrete,
      hostname,
      port,
      username: block.options.get('user') ?? null,
      identityFile: block.options.get('identityfile') ?? null,
      proxyJump: block.options.get('proxyjump') ?? null,
      line: block.line,
    })
  }

  return { hosts, warnings }
}

/** True when the value looks like an address this app can try to connect to. */
export function isUsableHostname(hostname: string): boolean {
  if (hostname === '') return false
  if (isIpv6Literal(hostname)) return true
  // Hostname, IPv4 or FQDN. No spaces, no shell metacharacters.
  return /^[A-Za-z0-9._:-]+$/.test(hostname)
}
