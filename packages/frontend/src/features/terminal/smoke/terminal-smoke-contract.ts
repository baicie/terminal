import { invoke } from '@tauri-apps/api/core'
import {
  parseTerminalSmokeSshConfig,
  type TerminalSmokeSshConfig,
} from './terminal-smoke-ssh-config'
export type {
  TerminalSmokeAuthMode,
  TerminalSmokeJumpConfig,
  TerminalSmokeSshConfig,
} from './terminal-smoke-ssh-config'

export interface TerminalSmokeConfig {
  loadBytes: number
  initialCols: number
  initialRows: number
  targetCols: number
  targetRows: number
  timeoutMs: number
  rounds: number
  reconnectRequired: boolean
  ssh: TerminalSmokeSshConfig
}

export type TerminalSmokeStage =
  | 'mounting'
  | 'connecting'
  | 'stale-output'
  | 'ready'
  | 'load'
  | 'after-load'
  | 'resize'
  | 'resources'
  | 'complete'

export interface TerminalSmokeResult {
  ok: boolean
  stage: TerminalSmokeStage
  error: string | null
  loadBytes: number
  roundsCompleted: number
  uniqueSessionCount: number
  resourcesRecovered: boolean
  durationMs: number
  terminalCols: number
  terminalRows: number
  loadEndVisible: boolean
  afterLoadVisible: boolean
  resizedSizeVisible: boolean
  reconnectObserved: boolean
  staleOutputRejected: boolean
  /** Milliseconds from application start to the first connected session. */
  firstConnectionMs: number
}

export interface TerminalSmokeStaleOutputProbe {
  staleMarker: string
  barrierMarker: string
}

interface TerminalSmokeIpc {
  isTauri: () => boolean
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>
}

const FIXED_CONFIG = {
  loadBytes: 8_388_608,
  initialCols: 80,
  initialRows: 24,
  targetCols: 97,
  targetRows: 31,
  timeoutMs: 180_000,
  rounds: 10,
}

const CONFIG_KEYS = [...Object.keys(FIXED_CONFIG), 'reconnectRequired', 'ssh'].sort()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseTerminalSmokeConfig(raw: unknown): TerminalSmokeConfig {
  if (!isRecord(raw)) throw new Error('Invalid terminal smoke config')
  const keys = Object.keys(raw).sort()
  if (
    keys.length !== CONFIG_KEYS.length ||
    keys.some((key, index) => key !== CONFIG_KEYS[index])
  ) {
    throw new Error('Invalid terminal smoke config')
  }
  for (const [key, expected] of Object.entries(FIXED_CONFIG)) {
    const value = raw[key]
    if (!Number.isSafeInteger(value) || value !== expected) {
      throw new Error('Invalid terminal smoke config')
    }
  }
  if (typeof raw.reconnectRequired !== 'boolean') {
    throw new Error('Invalid terminal smoke config')
  }
  return {
    ...FIXED_CONFIG,
    reconnectRequired: raw.reconnectRequired,
    ssh: parseTerminalSmokeSshConfig(raw.ssh),
  }
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x1f || codePoint === 0x7f) return true
  }
  return false
}

function parseStaleOutputProbe(
  raw: unknown,
): TerminalSmokeStaleOutputProbe {
  if (!isRecord(raw)) {
    throw new Error('Invalid terminal smoke stale-output probe')
  }
  const keys = Object.keys(raw).sort()
  if (
    keys.length !== 2 ||
    keys[0] !== 'barrierMarker' ||
    keys[1] !== 'staleMarker' ||
    typeof raw.staleMarker !== 'string' ||
    typeof raw.barrierMarker !== 'string' ||
    raw.staleMarker.length === 0 ||
    raw.barrierMarker.length === 0 ||
    raw.staleMarker === raw.barrierMarker ||
    hasControlCharacters(raw.staleMarker) ||
    hasControlCharacters(raw.barrierMarker)
  ) {
    throw new Error('Invalid terminal smoke stale-output probe')
  }
  return {
    staleMarker: raw.staleMarker,
    barrierMarker: raw.barrierMarker,
  }
}

export function isTerminalSmokeTauriRuntime(
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

const defaultIpc: TerminalSmokeIpc = {
  isTauri: isTerminalSmokeTauriRuntime,
  invoke,
}

export async function loadTerminalSmokeConfig(
  ipc: TerminalSmokeIpc = defaultIpc,
): Promise<TerminalSmokeConfig | null> {
  if (!ipc.isTauri()) return null
  const raw = await ipc.invoke('terminal_smoke_config')
  return raw === null ? null : parseTerminalSmokeConfig(raw)
}

export async function reportTerminalSmokeConnected(
  ipc: Pick<TerminalSmokeIpc, 'invoke'> = defaultIpc,
): Promise<number> {
  const elapsedMs = await ipc.invoke('terminal_smoke_connected')
  if (!Number.isSafeInteger(elapsedMs) || (elapsedMs as number) < 0) {
    throw new Error('Invalid terminal smoke connection checkpoint')
  }
  return elapsedMs as number
}

export async function reportTerminalSmokeReconnect(
  ipc: Pick<TerminalSmokeIpc, 'invoke'> = defaultIpc,
): Promise<void> {
  await ipc.invoke('terminal_smoke_reconnect_requested')
}

export async function emitTerminalSmokeStaleOutput(
  retiredSessionId: string,
  activeSessionId: string,
  ipc: Pick<TerminalSmokeIpc, 'invoke'> = defaultIpc,
): Promise<TerminalSmokeStaleOutputProbe> {
  const raw = await ipc.invoke('terminal_smoke_emit_stale_output', {
    retiredSessionId,
    activeSessionId,
  })
  return parseStaleOutputProbe(raw)
}

export async function submitTerminalSmokeResult(
  result: TerminalSmokeResult,
  ipc: Pick<TerminalSmokeIpc, 'invoke'> = defaultIpc,
): Promise<void> {
  await ipc.invoke('terminal_smoke_complete', { result })
}
