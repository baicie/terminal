/**
 * The React adapter for the AI runner.
 *
 * Three jobs, all thin: load profiles from SQLite, build one runner wired to the
 * backend over IPC, and expose a way to start a run.
 *
 * ## Why one runner for the process
 *
 * Two runners would each hold their own "a run is in progress" state, so the dock could
 * start a second request while the first was streaming — the double-run the runner
 * refuses. One instance, created lazily, mirrors `vaultService` and the extension
 * registry.
 *
 * ## Why there is no key here any more
 *
 * This module used to pass `readKey: () => getProfileSecret(profileId)`; the runner
 * then handed the plaintext key to a `fetch` inside the WebView, which is what the
 * design (§4) forbids. The runner's dependencies now have no way to obtain a key, and
 * the request it sends carries a `profileId` rather than a secret — so the exposure
 * cannot return without changing this file's shape first.
 *
 * Reading the profile *row* here is fine and stays: endpoint, model and limits are
 * configuration, and `secretRef` is a pointer, not a key. Only the key itself moved.
 */

import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/store/app'
import { AiRunner } from '@/features/ai/ai-runner'
import { cancelRun, generate } from '@/features/ai/ai-ipc'
import type { ModelProfilePublic } from '@/features/ai/model-profile'
import { listModelProfiles } from '@/service/database/ai-profiles'
import { sessionIdForTab } from '@/features/terminal/services/terminal-session-ids'

export interface AiRuntime {
  runner: AiRunner
  profiles: ModelProfilePublic[]
  /** True until the first profile load finishes. */
  loading: boolean
  reload(): Promise<void>
}

let runnerSingleton: AiRunner | null = null
let runCounter = 0

function getRunner(): AiRunner {
  if (runnerSingleton) return runnerSingleton
  runnerSingleton = new AiRunner({
    generate: (input, onEvent) => generate(input, onEvent),
    cancel: requestId => cancelRun(requestId),
    // The visible session is the active tab: a result for a tab the user left is
    // marked stale rather than presented as the current one's.
    visibleSessionId: () => useAppStore.getState().activeTabId ?? null,
    // The backend session behind that tab, so a reconnect invalidates an approval that
    // named the previous one. Read from the registry the terminal publishes into.
    visibleBackendSessionId: () => {
      const activeTabId = useAppStore.getState().activeTabId
      return activeTabId ? sessionIdForTab(activeTabId) : null
    },
    onState: () => undefined,
    nextRunId: () => `ai-run-${++runCounter}`,
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
