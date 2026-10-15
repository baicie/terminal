import { invoke } from '@tauri-apps/api/core'

interface RemotePromptProbeIpc {
  isTauri: () => boolean
  invoke: (command: string) => Promise<unknown>
}

export interface RemotePromptProbeConfig {
  marker: string
  command: string
  expectedCwd?: string
  expectedExitCode?: number
}

let activeConfig: RemotePromptProbeConfig | null = null

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

const defaultIpc: RemotePromptProbeIpc = {
  isTauri: isTauriRuntime,
  invoke: command => invoke(command),
}

export function configureRemotePromptProbe(
  config: RemotePromptProbeConfig | null,
): void {
  activeConfig = config
}

export function getRemotePromptProbeConfig(): RemotePromptProbeConfig | null {
  return activeConfig
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

export function parseRemotePromptProbeConfig(
  value: unknown,
): RemotePromptProbeConfig | null {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid remote prompt probe configuration')
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const allowedKeys = ['command', 'expectedCwd', 'expectedExitCode', 'marker']
  if (
    keys.some(key => !allowedKeys.includes(key)) ||
    keys.length < 2 ||
    keys[0] !== 'command' ||
    !keys.includes('marker')
  ) {
    throw new Error('Invalid remote prompt probe configuration')
  }
  if (
    typeof record.marker !== 'string' ||
    typeof record.command !== 'string' ||
    record.marker.length === 0 ||
    record.command.length === 0 ||
    record.marker.length > 512 ||
    record.command.length > 4_096 ||
    hasControlCharacters(record.marker) ||
    hasControlCharacters(record.command)
  ) {
    throw new Error('Invalid remote prompt probe configuration')
  }
  if (
    record.expectedCwd !== undefined &&
    (typeof record.expectedCwd !== 'string' ||
      record.expectedCwd.length === 0 ||
      record.expectedCwd.length > 4_096 ||
      !record.expectedCwd.startsWith('/') ||
      hasControlCharacters(record.expectedCwd))
  ) {
    throw new Error('Invalid remote prompt probe configuration')
  }
  if (
    record.expectedExitCode !== undefined &&
    (typeof record.expectedExitCode !== 'number' ||
      !Number.isInteger(record.expectedExitCode) ||
      record.expectedExitCode < 0 ||
      record.expectedExitCode > 255)
  ) {
    throw new Error('Invalid remote prompt probe configuration')
  }
  return {
    marker: record.marker,
    command: record.command,
    ...(record.expectedCwd === undefined
      ? {}
      : { expectedCwd: record.expectedCwd }),
    ...(record.expectedExitCode === undefined
      ? {}
      : { expectedExitCode: record.expectedExitCode }),
  }
}

export async function loadRemotePromptProbeConfig(
  ipc: RemotePromptProbeIpc = defaultIpc,
): Promise<RemotePromptProbeConfig | null> {
  if (!ipc.isTauri()) return null
  return parseRemotePromptProbeConfig(
    await ipc.invoke('remote_prompt_probe_config'),
  )
}

export function reportRemotePromptProbeObserved(): Promise<void> {
  return invoke('remote_prompt_probe_observed')
}
