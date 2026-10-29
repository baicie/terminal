import { invoke } from '@tauri-apps/api/core'
import {
  terminalSessionManager,
  type TerminalSessionResourceSnapshot,
} from '@/features/terminal/services/terminal-session-manager'

const BACKEND_KEYS = [
  'channels',
  'managerSessions',
  'metadata',
  'outputControls',
  'sshPool',
  'sshRegistry',
]

export interface TerminalSmokeBackendResources {
  managerSessions: string[]
  metadata: string[]
  channels: string[]
  sshPool: string[]
  sshRegistry: string[]
  outputControls: string[]
}

export interface TerminalSmokeResourceSnapshot {
  frontend: TerminalSessionResourceSnapshot
  backend: TerminalSmokeBackendResources
}

interface ResourceDependencies {
  frontend: () => TerminalSessionResourceSnapshot
  invoke: (command: string) => Promise<unknown>
}

interface StabilityOptions {
  expected?: TerminalSmokeResourceSnapshot
  signal?: AbortSignal
  sleep?: () => Promise<void>
}

const defaultDependencies: ResourceDependencies = {
  frontend: () => terminalSessionManager.resourceSnapshot(),
  invoke,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sortedStrings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('Invalid terminal smoke resource snapshot')
  }
  return [...value].sort()
}

export function parseTerminalSmokeBackendResources(
  value: unknown,
): TerminalSmokeBackendResources {
  if (!isRecord(value)) {
    throw new Error('Invalid terminal smoke resource snapshot')
  }
  const keys = Object.keys(value).sort()
  if (
    keys.length !== BACKEND_KEYS.length ||
    keys.some((key, index) => key !== BACKEND_KEYS[index])
  ) {
    throw new Error('Invalid terminal smoke resource snapshot')
  }
  return {
    managerSessions: sortedStrings(value.managerSessions),
    metadata: sortedStrings(value.metadata),
    channels: sortedStrings(value.channels),
    sshPool: sortedStrings(value.sshPool),
    sshRegistry: sortedStrings(value.sshRegistry),
    outputControls: sortedStrings(value.outputControls),
  }
}

function normalizeFrontend(
  value: TerminalSessionResourceSnapshot,
): TerminalSessionResourceSnapshot {
  return {
    recordTabIds: [...value.recordTabIds].sort(),
    sessionMappings: [...value.sessionMappings].sort((left, right) =>
      left.sessionId === right.sessionId
        ? left.tabId.localeCompare(right.tabId)
        : left.sessionId.localeCompare(right.sessionId),
    ),
  }
}

export async function readTerminalSmokeResources(
  dependencies: ResourceDependencies = defaultDependencies,
): Promise<TerminalSmokeResourceSnapshot> {
  const frontend = normalizeFrontend(dependencies.frontend())
  const backend = parseTerminalSmokeBackendResources(
    await dependencies.invoke('terminal_smoke_resources'),
  )
  return { frontend, backend }
}

function snapshotsEqual(
  left: TerminalSmokeResourceSnapshot,
  right: TerminalSmokeResourceSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function defaultSleep(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 25))
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw signal.reason ?? new Error('Terminal smoke resource polling aborted')
}

export async function waitForStableTerminalSmokeResources(
  read: () => Promise<TerminalSmokeResourceSnapshot> = () =>
    readTerminalSmokeResources(),
  options: StabilityOptions = {},
): Promise<TerminalSmokeResourceSnapshot> {
  const sleep = options.sleep ?? defaultSleep
  let previous: TerminalSmokeResourceSnapshot | null = null
  let stableReads = 0
  for (;;) {
    throwIfAborted(options.signal)
    const current = await read()
    const matches = options.expected
      ? snapshotsEqual(current, options.expected)
      : previous !== null && snapshotsEqual(current, previous)
    stableReads = matches ? stableReads + 1 : options.expected ? 0 : 1
    if (stableReads >= 2) return current
    previous = current
    await sleep()
  }
}
