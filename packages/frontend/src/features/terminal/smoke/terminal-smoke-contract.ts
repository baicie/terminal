import {
  terminalSmokeIpc as defaultIpc,
  type TerminalSmokeIpc,
} from './terminal-smoke-renderer-heartbeat-contract'
export {
  isTerminalSmokeTauriRuntime,
  loadTerminalSmokeRendererHeartbeat,
  parseTerminalSmokeRendererHeartbeatConfig,
  type TerminalSmokeRendererHeartbeatConfig,
} from './terminal-smoke-renderer-heartbeat-contract'
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
  resizeSequence: TerminalSmokeResizeStep[]
  timeoutMs: number
  rounds: number
  reconnectRequired: boolean
  /**
   * Asks the round to synthesize a host wake once the reconnect ladder is
   * exhausted. Only the long-outage case sets this: a sleep outlasts the whole
   * automatic budget, and recovery from there runs through the
   * visibility-change path that no other case can reach.
   */
  hostWakeRequired: boolean
  ssh: TerminalSmokeSshConfig
}

export interface TerminalSmokeResizeStep {
  cols: number
  rows: number
}

export interface TerminalSmokeResizeObservation {
  requestedCols: number
  requestedRows: number
  observedCols: number
  observedRows: number
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
  resizeTrace: TerminalSmokeResizeObservation[]
  reconnectObserved: boolean
  hostWakeSynthesized: boolean
  staleOutputRejected: boolean
  /** Milliseconds from application start to the first connected session. */
  firstConnectionMs: number
}

export interface TerminalSmokeStaleOutputProbe {
  staleMarker: string
  barrierMarker: string
}

export type TerminalSmokeHostWakeSource =
  | 'reconnect-checkpoint-fallback'
  | 'reconnect-state-recovery'
  | 'retryable-error'

export type TerminalSmokeHostWakeEvent =
  | 'fallback-armed'
  | 'fallback-poll'
  | 'fallback-poll-in-flight'
  | 'fallback-timer-fired'
  | 'fallback-timer-cleared'
  | 'reconnect-state-timer-armed'
  | 'reconnect-state-timer-fired'
  | 'reconnect-state-timer-cleared'
  | 'round-controller-aborted'
  | 'checkpoint'

export type TerminalSmokeHostWakeReporter = (
  event?: TerminalSmokeHostWakeEvent,
  source?: TerminalSmokeHostWakeSource,
) => Promise<void>

const FIXED_CONFIG = {
  loadBytes: 8_388_608,
  initialCols: 80,
  initialRows: 24,
  targetCols: 97,
  targetRows: 31,
  resizeSequence: [
    { cols: 132, rows: 43 },
    { cols: 90, rows: 30 },
    { cols: 120, rows: 40 },
    { cols: 97, rows: 31 },
  ],
  timeoutMs: 180_000,
  rounds: 10,
}

const CONFIG_KEYS = [
  ...Object.keys(FIXED_CONFIG),
  'reconnectRequired',
  'hostWakeRequired',
  'ssh',
].sort()

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
    if (key === 'resizeSequence') {
      if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
        throw new Error('Invalid terminal smoke config')
      }
      continue
    }
    if (!Number.isSafeInteger(value) || value !== expected) {
      throw new Error('Invalid terminal smoke config')
    }
  }
  if (typeof raw.reconnectRequired !== 'boolean') {
    throw new Error('Invalid terminal smoke config')
  }
  if (typeof raw.hostWakeRequired !== 'boolean') {
    throw new Error('Invalid terminal smoke config')
  }
  return {
    ...FIXED_CONFIG,
    reconnectRequired: raw.reconnectRequired,
    hostWakeRequired: raw.hostWakeRequired,
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

/**
 * Asks the backend to publish a host-wake checkpoint for the runner.
 *
 * The recovery path after the reconnect ladder is exhausted is the
 * visibility-change handler, which only a real wake can fire. The runner
 * drives it through this checkpoint instead of a real sleep.
 */
export async function reportTerminalSmokeHostWake(
  eventOrIpc: TerminalSmokeHostWakeEvent | Pick<TerminalSmokeIpc, 'invoke'> =
    'checkpoint',
  source: TerminalSmokeHostWakeSource = 'retryable-error',
  passedIpc: Pick<TerminalSmokeIpc, 'invoke'> = defaultIpc,
): Promise<void> {
  const event = typeof eventOrIpc === 'string' ? eventOrIpc : 'checkpoint'
  const ipc =
    typeof eventOrIpc === 'string'
      ? passedIpc
      : eventOrIpc
  await ipc.invoke('terminal_smoke_host_wake', { event, source })
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
