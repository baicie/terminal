import { invoke } from '@tauri-apps/api/core'

export interface InputProbeAutomationConfig {
  readyPath: string
  resultPath: string
  rounds: number
  expectedText: string
}

export interface InputProbeAutomationRoundResult {
  round: number
  expectedHex: string
  receivedHex: string
  ok: boolean
}

export interface InputProbeAutomationResult {
  ok: boolean
  rounds: number
  expectedText: string
  expectedHex: string
  durationMs: number
  results: InputProbeAutomationRoundResult[]
  error: string | null
}

interface InputProbeIpc {
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

const defaultIpc: InputProbeIpc = {
  isTauri: isTauriRuntime,
  invoke,
}

function parseConfig(raw: unknown): InputProbeAutomationConfig | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid terminal input probe config')
  }
  const value = raw as Record<string, unknown>
  const keys = Object.keys(value).sort()
  if (
    keys.length !== 4 ||
    keys.join(',') !== 'expectedText,readyPath,resultPath,rounds' ||
    typeof value.readyPath !== 'string' ||
    value.readyPath.length === 0 ||
    typeof value.resultPath !== 'string' ||
    value.resultPath.length === 0 ||
    !Number.isSafeInteger(value.rounds) ||
    (value.rounds as number) < 1 ||
    (value.rounds as number) > 100 ||
    typeof value.expectedText !== 'string' ||
    value.expectedText.length === 0 ||
    value.expectedText.length > 32
  ) {
    throw new Error('Invalid terminal input probe config')
  }
  return {
    readyPath: value.readyPath,
    resultPath: value.resultPath,
    rounds: value.rounds as number,
    expectedText: value.expectedText,
  }
}

export async function loadInputProbeAutomationConfig(
  ipc: InputProbeIpc = defaultIpc,
): Promise<InputProbeAutomationConfig | null> {
  if (!ipc.isTauri()) return null
  const raw = await ipc.invoke('input_probe_config')
  return parseConfig(raw)
}

export async function publishInputProbeDiag(
  message: string,
  ipc: InputProbeIpc = defaultIpc,
): Promise<void> {
  await ipc.invoke('input_probe_diag', { message })
}

export async function focusInputProbeWindow(
  ipc: InputProbeIpc = defaultIpc,
): Promise<void> {
  await ipc.invoke('input_probe_focus')
}

export async function publishInputProbeReady(
  round: number,
  ipc: InputProbeIpc = defaultIpc,
): Promise<void> {
  await ipc.invoke('input_probe_ready', { round })
}

export async function publishInputProbeResult(
  result: InputProbeAutomationResult,
  ipc: InputProbeIpc = defaultIpc,
): Promise<void> {
  await ipc.invoke('input_probe_result', { result })
}
