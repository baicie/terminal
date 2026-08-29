const MAX_CWD_LENGTH = 4_096
function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

export type ShellIntegrationEvent =
  | { kind: 'prompt-start' }
  | { kind: 'command-start' }
  | { kind: 'command-output' }
  | { kind: 'command-finished'; exitCode?: number }
  | { kind: 'cwd'; cwd: string }

export interface ShellIntegrationSnapshot {
  phase: 'prompt' | 'command' | 'output'
  cwd?: string
  lastExitCode?: number
}

function parseExitCode(value: string): number | undefined {
  if (!/^(?:0|[1-9]\d{0,8})$/.test(value)) return undefined
  const exitCode = Number(value)
  return Number.isSafeInteger(exitCode) ? exitCode : undefined
}

function parseCwd(value: string): string | undefined {
  if (!value || value.length > MAX_CWD_LENGTH || hasControlCharacters(value)) {
    return undefined
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost')) {
    return undefined
  }
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return undefined
  }
  if (!pathname || pathname.length > MAX_CWD_LENGTH || hasControlCharacters(pathname)) {
    return undefined
  }
  return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname
}

/** Parses payloads registered by shells using the OSC 133/7 conventions. */
export function parseShellIntegrationOsc(
  identifier: number,
  data: string,
): ShellIntegrationEvent | undefined {
  if (typeof data !== 'string' || hasControlCharacters(data)) return undefined
  if (identifier === 133) {
    if (data === 'A') return { kind: 'prompt-start' }
    if (data === 'B') return { kind: 'command-start' }
    if (data === 'C') return { kind: 'command-output' }
    if (!data.startsWith('D')) return undefined
    const separator = data.indexOf(';')
    if (separator < 0 || separator !== 1) return undefined
    const rawExitCode = data.slice(2)
    const exitCode = parseExitCode(rawExitCode)
    if (exitCode === undefined) return undefined
    return { kind: 'command-finished', exitCode }
  }
  if (identifier === 7) {
    const cwd = parseCwd(data)
    return cwd ? { kind: 'cwd', cwd } : undefined
  }
  return undefined
}

export class ShellIntegrationState {
  private phase: ShellIntegrationSnapshot['phase'] = 'prompt'
  private cwd: string | undefined
  private lastExitCode: number | undefined

  consume(identifier: number, data: string): ShellIntegrationEvent | undefined {
    const event = parseShellIntegrationOsc(identifier, data)
    if (!event) return undefined
    if (event.kind === 'prompt-start') this.phase = 'prompt'
    if (event.kind === 'command-start') this.phase = 'command'
    if (event.kind === 'command-output') this.phase = 'output'
    if (event.kind === 'command-finished') {
      this.phase = 'prompt'
      this.lastExitCode = event.exitCode
    }
    if (event.kind === 'cwd') this.cwd = event.cwd
    return event
  }

  snapshot(): ShellIntegrationSnapshot {
    return {
      phase: this.phase,
      ...(this.cwd === undefined ? {} : { cwd: this.cwd }),
      ...(this.lastExitCode === undefined ? {} : { lastExitCode: this.lastExitCode }),
    }
  }
}
