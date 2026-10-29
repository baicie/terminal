import type { Update } from '@tauri-apps/plugin-updater'

export type UpdateStatus =
  | { status: 'unsupported' }
  | { status: 'unconfigured'; detail: string }
  | { status: 'up-to-date'; version: string }
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
}

const CONFIGURATION_HINTS =
  /public key|pubkey|publickey|signature|invalid updater|endpoint|network|failed to fetch/i

export function classifyUpdateFailure(error: unknown): UpdateStatus {
  const detail = error instanceof Error ? error.message : String(error)
  // A placeholder pubkey or an unreachable endpoint is a configuration state,
  // not a crash: the UI must say so instead of showing a generic failure.
  if (CONFIGURATION_HINTS.test(detail))
    return { status: 'unconfigured', detail }
  return { status: 'error', detail }
}

export const defaultUpdateDependencies: UpdateDependencies = {
  isDesktop: () =>
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
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
 * Resolves the update state without ever downloading or installing anything.
 * Installation stays an explicit user action so a background check cannot
 * replace the binary the user is running.
 */
export async function checkForUpdates(
  dependencies: UpdateDependencies = defaultUpdateDependencies,
): Promise<UpdateStatus> {
  if (!dependencies.isDesktop()) return { status: 'unsupported' }

  let bridge: UpdateBridge
  try {
    bridge = await dependencies.loadBridge()
  } catch (error) {
    return classifyUpdateFailure(error)
  }

  try {
    const [version, update] = await Promise.all([
      bridge.currentVersion(),
      bridge.check(),
    ])
    if (!update) return { status: 'up-to-date', version }
    return {
      status: 'available',
      version: update.version,
      notes: update.body ?? null,
    }
  } catch (error) {
    return classifyUpdateFailure(error)
  }
}
