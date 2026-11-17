/**
 * The React adapter for the AI runner.
 *
 * Three jobs, all thin: load profiles from SQLite, build one runner wired to the real
 * credential provider and the real active tab, and expose a way to start a run.
 *
 * ## Why one runner for the process
 *
 * Two runners would each hold their own "a run is in progress" state, so the dock could
 * start a second request while the first was streaming — the double-run the runner
 * refuses. One instance, created lazily, mirrors `vaultService` and the extension
 * registry.
 *
 * ## Why the key is read through the storage layer
 *
 * `readKey` delegates to `getProfileSecret`, which reads the vault. The runner never
 * sees a provider: it receives a string and hands it to the driver. That keeps the
 * secret's path in one module.
 */

import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/store/app'
import { AiRunner, driverRegistry } from '@/features/ai/ai-runner'
import type { ModelProfilePublic } from '@/features/ai/model-profile'
import {
  getProfileSecret,
  listModelProfiles,
} from '@/service/database/ai-profiles'

export interface AiRuntime {
  runner: AiRunner
  profiles: ModelProfilePublic[]
  /** True until the first profile load finishes. */
  loading: boolean
  reload(): Promise<void>
}

let runnerSingleton: AiRunner | null = null

/**
 * A cancellation signal that a caller can trip.
 *
 * `whenCancelled` never rejects, which is what the driver contract promises and what
 * lets the HTTP adapter use it for `AbortController` without a try/catch.
 */
function createCancelSignal(): { cancelled: boolean, cancel(): void, whenCancelled(): Promise<void> } {
  let cancelled = false
  let cancel: () => void = () => undefined
  const promise = new Promise<void>(resolve => {
    cancel = resolve
  })
  return {
    // A getter over a closure variable, not a mutable field: the driver reads
    // `cancelled` between chunks, and a plain property would let a caller that kept a
    // reference see a stale value.
    get cancelled() {
      return cancelled
    },
    cancel() {
      cancelled = true
      cancel()
    },
    whenCancelled: () => promise,
  }
}

let runCounter = 0

function getRunner(): AiRunner {
  if (runnerSingleton) return runnerSingleton
  const drivers = driverRegistry()
  runnerSingleton = new AiRunner({
    driverFor: provider => drivers.get(provider),
    readKey: profileId => getProfileSecret(profileId),
    // The visible session is the active tab: a result for a tab the user left is
    // marked stale rather than presented as the current one's.
    visibleSessionId: () => useAppStore.getState().activeTabId ?? null,
    onState: () => undefined,
    nextRunId: () => `ai-run-${++runCounter}`,
    // A fresh signal per run: reusing one would make the second cancel a no-op.
    createSignal: () => createCancelSignal(),
  })
  return runnerSingleton
}

/** Test-only: drop the singleton so a suite starts with no run in flight. */
export function __resetAiRunnerForTests(): void {
  runnerSingleton = null
  runCounter = 0
}

export function useAiRuntime(): AiRuntime {
  const runner = getRunner()
  const [profiles, setProfiles] = useState<ModelProfilePublic[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      setProfiles(await listModelProfiles())
    } catch {
      // An unreadable profile table must not break the dock: an empty list is a
      // truthful "nothing configured", and the Settings page reports the real error.
      setProfiles([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { runner, profiles, loading, reload }
}
