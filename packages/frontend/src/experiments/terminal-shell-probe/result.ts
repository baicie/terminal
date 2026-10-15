import { invoke } from '@tauri-apps/api/core'
import { parseTerminalSmokeSshConfig } from '@/features/terminal/smoke/terminal-smoke-ssh-config'
import {
  DIALECT_CASES,
  dialectSupportsCase,
  type ShellProbeCase,
  type ShellProbeDialect,
} from './dialect-cases'
import {
  expectedShellProbeTrace,
  type ShellProbeConfig,
  type ShellProbeInputEvent,
  type ShellProbeResult,
  type ShellProbeSshTarget,
  type ShellProbeTraceEvent,
} from './protocol'

interface ShellProbeIpc {
  isTauri: () => boolean
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>
}

// The POSIX dialect claims every case the protocol defines, so its ordered list
// is the canonical one and is read from the same leaf module the dialect layer
// and the contract test use. A case missing here would be rejected before the
// PTY is ever driven, so the probe would only time out instead of reporting the
// real cause -- which is exactly the drift a third hand-maintained copy invites.
const CASES: ShellProbeCase[] = DIALECT_CASES.posix

/** Exported so tests can assert the parser accepts every case the protocol defines. */
export const SHELL_PROBE_CASES: readonly ShellProbeCase[] = CASES

const HEX_PATTERN = /^[0-9a-f]+$/
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 120_000
/**
 * Validates the SSH target the backend read out of the fixture config file by
 * reusing the smoke matrix's own parser. The backend already applied that
 * gate's Rust rules to the file, so a second hand-written validator here would
 * only be a second thing that can drift from it — and would grow the probe
 * bundle for no added safety.
 */
function parseSshTarget(raw: unknown): ShellProbeSshTarget {
  return parseTerminalSmokeSshConfig(raw)
}

function isDialect(value: unknown): value is ShellProbeDialect {
  return value === 'posix' || value === 'powershell' || value === 'cmd'
}

function isCaseName(value: unknown): value is ShellProbeCase {
  return typeof value === 'string' && CASES.includes(value as ShellProbeCase)
}

function isTrace(value: unknown): value is ShellProbeTraceEvent[] {
  return (
    Array.isArray(value) &&
    value.every(
      item =>
        item === 'ready' || item === 'step' || item === 'pass' || item === 'fail',
    )
  )
}

function isTauriRuntime(
  runtime: Record<string, unknown> = globalThis as Record<string, unknown>,
): boolean {
  const location = runtime.location
  const protocol =
    typeof location === 'object' && location !== null && 'protocol' in location
      ? (location as { protocol?: unknown }).protocol
      : undefined
  return (
    runtime.isTauri === true ||
    '__TAURI_INTERNALS__' in runtime ||
    '__TAURI_INVOKE__' in runtime ||
    protocol === 'tauri:'
  )
}

const defaultIpc: ShellProbeIpc = { isTauri: isTauriRuntime, invoke }

export function parseShellProbeConfig(raw: unknown): ShellProbeConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Invalid shell probe config')
  }
  const value = raw as Record<string, unknown>
  const keys = Object.keys(value).sort()
  if (
    keys.join(',') !== 'caseName,dialect,resultPath,ssh,timeoutMs' ||
    typeof value.resultPath !== 'string' ||
    value.resultPath.length === 0 ||
    !isCaseName(value.caseName) ||
    !isDialect(value.dialect) ||
    !dialectSupportsCase(value.dialect, value.caseName) ||
    !Number.isSafeInteger(value.timeoutMs) ||
    (value.timeoutMs as number) < MIN_TIMEOUT_MS ||
    (value.timeoutMs as number) > MAX_TIMEOUT_MS
  ) {
    throw new Error('Invalid shell probe config')
  }
  if (value.ssh !== null && value.ssh !== undefined) {
    parseSshTarget(value.ssh)
  }
  return {
    resultPath: value.resultPath as string,
    caseName: value.caseName as ShellProbeCase,
    dialect: value.dialect as ShellProbeDialect,
    timeoutMs: value.timeoutMs as number,
    ssh:
      value.ssh === null || value.ssh === undefined
        ? null
        : parseSshTarget(value.ssh),
  }
}

export async function loadShellProbeConfig(
  ipc: ShellProbeIpc = defaultIpc,
): Promise<ShellProbeConfig | null> {
  if (!ipc.isTauri()) return null
  const raw = await ipc.invoke('shell_probe_config')
  return raw === null ? null : parseShellProbeConfig(raw)
}

export async function publishShellProbeResult(
  result: ShellProbeResult,
  ipc: Pick<ShellProbeIpc, 'invoke'> = defaultIpc,
): Promise<void> {
  await ipc.invoke('shell_probe_result', { result })
}

function parseInputEvents(
  value: unknown,
  allowEmpty: boolean,
): ShellProbeInputEvent[] | null {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.length > 512
  ) {
    return null
  }
  const events: ShellProbeInputEvent[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
    const event = raw as Record<string, unknown>
    if (
      Object.keys(event).sort().join(',') !== 'bytes,dataHex,kind' ||
      event.kind !== 'text' ||
      !Number.isSafeInteger(event.bytes) ||
      (event.bytes as number) < 1 ||
      typeof event.dataHex !== 'string' ||
      !HEX_PATTERN.test(event.dataHex) ||
      event.dataHex.length !== (event.bytes as number) * 2
    ) {
      return null
    }
    events.push(event as unknown as ShellProbeInputEvent)
  }
  return events
}

export function parseShellProbeResult(
  raw: unknown,
  config: ShellProbeConfig,
): ShellProbeResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Invalid shell probe result')
  }
  const value = raw as Record<string, unknown>
  const keys = Object.keys(value).sort()
  if (
    keys.join(',') !== 'caseName,durationMs,error,inputEvents,ok,trace' ||
    value.caseName !== config.caseName ||
    !Number.isSafeInteger(value.durationMs) ||
    (value.durationMs as number) < 1 ||
    typeof value.ok !== 'boolean' ||
    (value.error !== null && typeof value.error !== 'string') ||
    !isTrace(value.trace) ||
    JSON.stringify(value.trace) !==
      JSON.stringify(expectedShellProbeTrace(config.caseName)) ||
    parseInputEvents(value.inputEvents, value.ok === false) === null ||
    (value.ok !== true && typeof value.error !== 'string')
  ) {
    throw new Error('Invalid shell probe result')
  }
  return {
    caseName: value.caseName as ShellProbeCase,
    durationMs: value.durationMs as number,
    error: value.error as string | null,
    inputEvents: value.inputEvents as ShellProbeInputEvent[],
    ok: value.ok as boolean,
    trace: value.trace as ShellProbeTraceEvent[],
  }
}
