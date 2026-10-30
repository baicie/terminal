import type { Update } from '@tauri-apps/plugin-updater'

/**
 * Failure classes a user can act on differently. A rejected signature stays
 * separate on purpose: it is a trust decision, not a transient network fault.
 */
export type UpdateFailureStatus =
  | 'offline'
  | 'timeout'
  | 'unreachable'
  | 'unconfigured'
  | 'signature'

export interface UpdateFailure {
  status: UpdateFailureStatus
  detail: string
}

export type UpdateStatus =
  | { status: 'unsupported' }
  | UpdateFailure
  | { status: 'up-to-date'; version: string | null }
  | { status: 'available'; version: string; notes: string | null }
  | { status: 'error'; detail: string }

export interface UpdateBridge {
  currentVersion: () => Promise<string>
  check: () => Promise<Pick<Update, 'version' | 'body'> | null>
}

export interface UpdateDependencies {
  /** False in a plain browser preview, where no updater can exist. */
  isDesktop: () => boolean
  loadBridge: () => Promise<UpdateBridge>
  /** Connectivity probe, false when the runtime reports no network at all. */
  isOnline?: () => boolean
}

/**
 * Signatures are matched first: a manifest whose signature does not verify may
 * be tampered with, so it must never borrow the milder "not configured" copy.
 */
const SIGNATURE_HINTS = /signature|signed for version|minisign|trusted comment/i
const UNCONFIGURED_HINTS =
  /pubkey|public key|does not have any endpoints|no endpoints|endpoint must use a secure protocol|not configured|not enabled/i
const TIMEOUT_HINTS = /timeout|timed out|deadline exceeded|etimedout/i
const UNREACHABLE_HINTS =
  /failed to fetch|network|dns|nodename nor servname|connection refused|error trying to connect|unreachable|no route to host|release json|status code|econnrefused|enotfound|econnreset/i

export const UPDATE_FAILURE_STATUSES: readonly UpdateFailureStatus[] = [
  'offline',
  'timeout',
  'unreachable',
  'unconfigured',
  'signature',
]

export function isUpdateFailure(status: UpdateStatus): status is UpdateFailure {
  return (UPDATE_FAILURE_STATUSES as readonly string[]).includes(status.status)
}

/** Tauri rejects updater commands with strings, so unwrap both shapes. */
function failureDetail(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const { message } = error as { message?: unknown }
    if (typeof message === 'string') return message
  }
  return String(error)
}

export function classifyUpdateFailure(
  error: unknown,
  context: { isOnline?: boolean } = {},
): UpdateStatus {
  const detail = failureDetail(error)
  if (SIGNATURE_HINTS.test(detail)) return { status: 'signature', detail }
  if (UNCONFIGURED_HINTS.test(detail)) return { status: 'unconfigured', detail }
  // Only claim "offline" when the runtime agrees, so a dead endpoint is never
  // reported as the user's own network problem.
  if (context.isOnline === false) return { status: 'offline', detail }
  if (TIMEOUT_HINTS.test(detail)) return { status: 'timeout', detail }
  if (UNREACHABLE_HINTS.test(detail)) return { status: 'unreachable', detail }
  return { status: 'error', detail }
}

export const defaultUpdateDependencies: UpdateDependencies = {
  isDesktop: () =>
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
  isOnline: () =>
    typeof navigator === 'undefined' || navigator.onLine !== false,
  loadBridge: async () => {
    const [{ getVersion }, { check }] = await Promise.all([
      import('@tauri-apps/api/app'),
      import('@tauri-apps/plugin-updater'),
    ])
    return {
      currentVersion: () => getVersion(),
      check: () => check(),
    }
  },
}

/**
 * Reads the version the running binary reports: the value Tauri baked in from
 * tauri.conf.json. Null means the runtime refused to answer, and the caller
 * must say so instead of inventing a placeholder version.
 */
export async function readCurrentVersion(
  dependencies: UpdateDependencies = defaultUpdateDependencies,
): Promise<string | null> {
  if (!dependencies.isDesktop()) return null
  try {
    const bridge = await dependencies.loadBridge()
    return await bridge.currentVersion()
  } catch {
    return null
  }
}

/**
 * Resolves the update state without ever downloading or installing anything.
 * Installation stays an explicit user action so a background check cannot
 * replace the binary the user is running.
 */
export async function checkForUpdates(
  dependencies: UpdateDependencies = defaultUpdateDependencies,
): Promise<UpdateStatus> {
  if (!dependencies.isDesktop()) return { status: 'unsupported' }
  const context = { isOnline: dependencies.isOnline?.() }

  let bridge: UpdateBridge
  try {
    bridge = await dependencies.loadBridge()
  } catch (error) {
    return classifyUpdateFailure(error, context)
  }

  // A failed version read must not hide the result of the check itself.
  const version = await bridge.currentVersion().catch(() => null)
  try {
    const update = await bridge.check()
    if (!update) return { status: 'up-to-date', version }
    return {
      status: 'available',
      version: update.version,
      notes: update.body ?? null,
    }
  } catch (error) {
    return classifyUpdateFailure(error, context)
  }
}
