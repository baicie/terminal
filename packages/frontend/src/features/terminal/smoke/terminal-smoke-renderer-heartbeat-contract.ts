import { invoke } from '@tauri-apps/api/core'

export interface TerminalSmokeIpc {
  isTauri: () => boolean
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>
}

export interface TerminalSmokeRendererHeartbeatConfig {
  endpoint: string
  token: string
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

export const terminalSmokeIpc: TerminalSmokeIpc = {
  isTauri: isTerminalSmokeTauriRuntime,
  invoke,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseTerminalSmokeRendererHeartbeatConfig(
  raw: unknown,
): TerminalSmokeRendererHeartbeatConfig {
  if (!isRecord(raw)) {
    throw new Error('Invalid terminal smoke renderer heartbeat config')
  }
  const keys = Object.keys(raw).sort()
  if (
    keys.length !== 2 ||
    keys[0] !== 'endpoint' ||
    keys[1] !== 'token' ||
    typeof raw.endpoint !== 'string' ||
    typeof raw.token !== 'string' ||
    raw.endpoint.length === 0 ||
    raw.token.length === 0 ||
    raw.token.trim() !== raw.token
  ) {
    throw new Error('Invalid terminal smoke renderer heartbeat config')
  }
  let endpoint: URL
  try {
    endpoint = new URL(raw.endpoint)
  } catch {
    throw new Error('Invalid terminal smoke renderer heartbeat config')
  }
  if (
    endpoint.protocol !== 'http:' ||
    endpoint.hostname !== '127.0.0.1' ||
    endpoint.port === '' ||
    endpoint.pathname !== '/heartbeat' ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.search !== '' ||
    endpoint.hash !== '' ||
    !/^[a-f0-9]{64}$/.test(raw.token)
  ) {
    throw new Error('Invalid terminal smoke renderer heartbeat config')
  }
  return { endpoint: raw.endpoint, token: raw.token }
}

export async function loadTerminalSmokeRendererHeartbeat(
  ipc: TerminalSmokeIpc = terminalSmokeIpc,
): Promise<TerminalSmokeRendererHeartbeatConfig | null> {
  if (!ipc.isTauri()) return null
  const raw = await ipc.invoke('terminal_smoke_renderer_heartbeat_config')
  return raw === null ? null : parseTerminalSmokeRendererHeartbeatConfig(raw)
}
