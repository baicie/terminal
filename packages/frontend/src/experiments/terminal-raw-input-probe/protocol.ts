import { invoke } from '@tauri-apps/api/core'

export type RawInputProbeCase =
  | 'sgr-mouse'
  | 'bracketed-paste'
  | 'raw-x10'

export interface RawInputProbeConfig {
  resultPath: string
  caseName: RawInputProbeCase
  expectedHex: string
}

export interface RawInputProbeResult {
  ok: boolean
  caseName: RawInputProbeCase
  expectedHex: string
  receivedHex: string
  durationMs: number
  error: string | null
}

const CASES: Record<RawInputProbeCase, string> = {
  'sgr-mouse': '1b5b3c303b333b344d',
  'bracketed-paste':
    '1b5b3230307e66697273740d7365636f6e641b5b3230317e',
  'raw-x10': '1b5b4d20813f',
}
const NONCE_PATTERN = /^[A-Za-z0-9_-]{1,48}$/
const HEX_PATTERN = /^[0-9a-f]+$/
const MAX_BUFFER_BYTES = 64 * 1024

export function expectedRawInputHex(caseName: RawInputProbeCase): string {
  return CASES[caseName]
}

export function rawInputProbeMarkers(nonce: string): {
  ready: string
  result: string
  end: string
} {
  validateNonce(nonce)
  const prefix = `__RAW_INPUT_PROBE_${nonce}_`
  return {
    ready: `${prefix}READY__`,
    result: `${prefix}RESULT__`,
    end: '__END__',
  }
}

export function createRawInputProbeCommand(
  nonce: string,
  expectedHex: string,
): string {
  validateNonce(nonce)
  if (!HEX_PATTERN.test(expectedHex) || expectedHex.length % 2 !== 0) {
    throw new Error('Invalid raw input probe expected bytes')
  }
  const markers = rawInputProbeMarkers(nonce)
  const splitMarker = (marker: string): [string, string] => {
    const splitAt = Math.ceil(marker.length / 2)
    return [marker.slice(0, splitAt), marker.slice(splitAt)]
  }
  const [readyPrefix, readySuffix] = splitMarker(markers.ready)
  const [resultPrefix, resultSuffix] = splitMarker(markers.result)
  const [endPrefix, endSuffix] = splitMarker(markers.end)
  const count = expectedHex.length / 2
  return [
    `stty -echo -icanon -istrip -icrnl -inlcr -igncr -ixon -ixoff min 1 time 0`,
    `printf '\\r\\n%s%s\\r\\n' '${readyPrefix}' '${readySuffix}'`,
    `received_hex=$(dd bs=1 count=${count} 2>/dev/null | od -An -tx1 | tr -d '[:space:]')`,
    `printf '\\r\\n%s%s%s%s%s\\r\\n' '${resultPrefix}' '${resultSuffix}' "$received_hex" '${endPrefix}' '${endSuffix}'`,
    'stty sane',
  ].join('; ')
}

export type RawInputProbeEvent =
  | { kind: 'ready' }
  | { kind: 'result'; hex: string }

export class RawInputProbeParser {
  private buffer = ''
  private waitingForReady = true

  constructor(private readonly nonce: string) {
    validateNonce(nonce)
  }

  push(chunk: string): RawInputProbeEvent[] {
    if (!chunk) return []
    this.buffer += chunk
    if (new TextEncoder().encode(this.buffer).byteLength > MAX_BUFFER_BYTES) {
      throw new Error('Raw input probe output exceeded its safety limit')
    }
    const markers = rawInputProbeMarkers(this.nonce)
    const events: RawInputProbeEvent[] = []
    while (true) {
      if (this.waitingForReady) {
        const readyIndex = this.buffer.indexOf(markers.ready)
        if (readyIndex < 0) {
          this.retainMarkerSuffix(markers.ready)
          return events
        }
        this.buffer = this.buffer.slice(readyIndex + markers.ready.length)
        this.waitingForReady = false
        events.push({ kind: 'ready' })
        continue
      }
      const resultIndex = this.buffer.indexOf(markers.result)
      if (resultIndex < 0) {
        this.retainMarkerSuffix(markers.result)
        return events
      }
      const valueStart = resultIndex + markers.result.length
      const endIndex = this.buffer.indexOf(markers.end, valueStart)
      if (endIndex < 0) {
        this.buffer = this.buffer.slice(resultIndex)
        return events
      }
      const hex = this.buffer
        .slice(valueStart, endIndex)
        .replace(/[\t\r\n ]/g, '')
        .toLowerCase()
      if (!HEX_PATTERN.test(hex) || hex.length % 2 !== 0) {
        throw new Error(
          `Raw input probe returned invalid hexadecimal data: ${JSON.stringify(hex.slice(0, 128))}`,
        )
      }
      this.buffer = this.buffer.slice(endIndex + markers.end.length)
      this.waitingForReady = true
      events.push({ kind: 'result', hex })
      return events
    }
  }

  private retainMarkerSuffix(marker: string): void {
    const maxSuffix = Math.min(marker.length - 1, this.buffer.length)
    for (let length = maxSuffix; length > 0; length -= 1) {
      if (this.buffer.endsWith(marker.slice(0, length))) {
        this.buffer = this.buffer.slice(-length)
        return
      }
    }
    this.buffer = ''
  }
}

interface RawInputProbeIpc {
  isTauri: () => boolean
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>
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

const defaultIpc: RawInputProbeIpc = { isTauri: isTauriRuntime, invoke }

function parseConfig(raw: unknown): RawInputProbeConfig | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid raw input probe config')
  }
  const value = raw as Record<string, unknown>
  const keys = Object.keys(value).sort()
  if (
    keys.join(',') !== 'caseName,expectedHex,resultPath' ||
    typeof value.resultPath !== 'string' ||
    value.resultPath.length === 0 ||
    typeof value.caseName !== 'string' ||
    !(value.caseName in CASES) ||
    typeof value.expectedHex !== 'string' ||
    value.expectedHex !== CASES[value.caseName as RawInputProbeCase]
  ) {
    throw new Error('Invalid raw input probe config')
  }
  return {
    resultPath: value.resultPath,
    caseName: value.caseName as RawInputProbeCase,
    expectedHex: value.expectedHex,
  }
}

export async function loadRawInputProbeConfig(
  ipc: RawInputProbeIpc = defaultIpc,
): Promise<RawInputProbeConfig | null> {
  if (!ipc.isTauri()) return null
  return parseConfig(await ipc.invoke('raw_input_probe_config'))
}

export async function publishRawInputProbeResult(
  result: RawInputProbeResult,
  ipc: Pick<RawInputProbeIpc, 'invoke'> = defaultIpc,
): Promise<void> {
  await ipc.invoke('raw_input_probe_result', { result })
}

export function parseRawInputProbeResult(
  raw: unknown,
  config: RawInputProbeConfig,
): RawInputProbeResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Invalid raw input probe result')
  }
  const value = raw as Record<string, unknown>
  const keys = Object.keys(value).sort()
  if (
    keys.join(',') !== 'caseName,durationMs,error,expectedHex,ok,receivedHex' ||
    value.caseName !== config.caseName ||
    value.expectedHex !== config.expectedHex ||
    typeof value.receivedHex !== 'string' ||
    !HEX_PATTERN.test(value.receivedHex) ||
    !Number.isSafeInteger(value.durationMs) ||
    (value.durationMs as number) < 1 ||
    typeof value.ok !== 'boolean' ||
    (value.error !== null && typeof value.error !== 'string')
  ) {
    throw new Error('Invalid raw input probe result')
  }
  if (value.ok !== (value.receivedHex === config.expectedHex)) {
    throw new Error('Raw input probe result ok flag is inconsistent')
  }
  return value as unknown as RawInputProbeResult
}

function validateNonce(nonce: string): void {
  if (!NONCE_PATTERN.test(nonce)) throw new Error('Invalid raw input probe nonce')
}
