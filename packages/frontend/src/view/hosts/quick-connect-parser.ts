const DEFAULT_SSH_PORT = 22
const MAX_PORT = 65_535
const SAFE_HOSTNAME = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i
const SAFE_USERNAME = /^[a-z0-9_](?:[a-z0-9._-]*[a-z0-9_$-])?$/i
const SHELL_CONTROL_CHARACTERS = /[;&|`$<>\r\n]/

export interface QuickConnectTarget {
  hostname: string
  username?: string
  port: number
}

export type QuickConnectParseError =
  | 'empty'
  | 'invalid-target'
  | 'invalid-port'
  | 'unsupported-arguments'

export type QuickConnectParseResult =
  | { ok: true; target: QuickConnectTarget }
  | QuickConnectParseFailure

type QuickConnectParseFailure = {
  ok: false
  error: QuickConnectParseError
}

type ParsedTarget = {
  target: QuickConnectTarget
  hasExplicitPort: boolean
}

function failure(error: QuickConnectParseError): QuickConnectParseFailure {
  return { ok: false, error }
}

function parsePort(rawPort: string): number | null {
  if (!/^\d+$/.test(rawPort)) return null

  const port = Number(rawPort)
  return Number.isSafeInteger(port) && port >= 1 && port <= MAX_PORT
    ? port
    : null
}

function splitEndpoint(
  endpoint: string,
): { hostname: string; rawPort?: string } | null {
  if (endpoint.startsWith('[')) {
    const match = endpoint.match(/^\[([0-9a-f:.]+)\](?::(.+))?$/i)
    if (!match) return null
    return { hostname: match[1], rawPort: match[2] }
  }

  const colonIndex = endpoint.lastIndexOf(':')
  if (colonIndex === -1) return { hostname: endpoint }
  if (endpoint.indexOf(':') !== colonIndex) return null

  return {
    hostname: endpoint.slice(0, colonIndex),
    rawPort: endpoint.slice(colonIndex + 1),
  }
}

function isValidHostname(hostname: string): boolean {
  if (hostname.length === 0 || hostname.length > 253) return false
  if (hostname.includes(':')) return /^[0-9a-f:.]+$/i.test(hostname)
  return SAFE_HOSTNAME.test(hostname)
}

function parseTarget(
  rawTarget: string,
): ParsedTarget | QuickConnectParseFailure {
  if (!rawTarget || rawTarget.includes('://')) {
    return failure('invalid-target')
  }

  const targetParts = rawTarget.split('@')
  if (targetParts.length > 2) return failure('invalid-target')

  const username = targetParts.length === 2 ? targetParts[0] : undefined
  const endpoint = targetParts.length === 2 ? targetParts[1] : targetParts[0]
  if (username !== undefined && !SAFE_USERNAME.test(username)) {
    return failure('invalid-target')
  }

  const endpointParts = splitEndpoint(endpoint)
  if (!endpointParts || !isValidHostname(endpointParts.hostname)) {
    return failure('invalid-target')
  }

  const hasExplicitPort = endpointParts.rawPort !== undefined
  const port = hasExplicitPort
    ? parsePort(endpointParts.rawPort ?? '')
    : DEFAULT_SSH_PORT
  if (port === null) return failure('invalid-port')

  return {
    target: {
      hostname: endpointParts.hostname,
      ...(username ? { username } : {}),
      port,
    },
    hasExplicitPort,
  }
}

function isParseFailure(
  value: ParsedTarget | QuickConnectParseFailure,
): value is QuickConnectParseFailure {
  return 'ok' in value
}

export function parseQuickConnectInput(input: string): QuickConnectParseResult {
  const trimmed = input.trim()
  if (!trimmed) return failure('empty')
  if (SHELL_CONTROL_CHARACTERS.test(trimmed)) {
    return failure('unsupported-arguments')
  }

  const tokens = trimmed.split(/\s+/)
  if (tokens[0].toLowerCase() !== 'ssh') {
    return tokens.length === 1
      ? toResult(parseTarget(tokens[0]))
      : failure('invalid-target')
  }

  if (tokens.length === 1) return failure('invalid-target')
  if (tokens.length === 2) return toResult(parseTarget(tokens[1]))
  if (tokens[2] !== '-p') return failure('unsupported-arguments')
  if (tokens.length !== 4) {
    return tokens.length < 4
      ? failure('invalid-port')
      : failure('unsupported-arguments')
  }

  const parsed = parseTarget(tokens[1])
  if (isParseFailure(parsed)) return parsed
  if (parsed.hasExplicitPort) return failure('invalid-target')

  const port = parsePort(tokens[3])
  if (port === null) return failure('invalid-port')
  return { ok: true, target: { ...parsed.target, port } }
}

function toResult(
  parsed: ParsedTarget | QuickConnectParseFailure,
): QuickConnectParseResult {
  return isParseFailure(parsed) ? parsed : { ok: true, target: parsed.target }
}
