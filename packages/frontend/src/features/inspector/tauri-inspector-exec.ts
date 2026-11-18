/**
 * The Inspector's exec bridge.
 *
 * A thin adapter over `session_exec`, which opens a **separate exec channel** — that
 * is what keeps probe bytes out of the interactive shell and off the OUTPUT ACK path.
 *
 * It exists as its own module so `ServerInspector` takes an `InspectorExec` and has no
 * Tauri dependency: the panel is then testable without an app host, and swapping the
 * transport later is one file.
 */

import { invoke } from '@tauri-apps/api/core'
import type { InspectorExec } from './inspector-probe'

let lastExecId: string | null = null

interface ExecResultDto {
  stdout: string
  stderr: string
  exitCode: number | null
  exit_code?: number | null
}

/**
 * Ids handed out for in-flight execs, so a close can stop one.
 *
 * ## Why the id is generated here rather than by Rust
 *
 * Cancelling is a second IPC call that has to arrive **while the first is still
 * blocked**. If Rust minted the id and returned it, the caller would only learn it
 * after the probe finished — which is precisely the moment it is no longer useful.
 *
 * The client knows the id before it makes the call, so the cancellation can race the
 * probe instead of following it.
 */
let nextExecId = 0

export const tauriInspectorExec: InspectorExec = {
  /**
   * Stop the last exec this adapter started.
   *
   * Called when the panel closes or the host changes. It stops **that exec only**: the
   * session, its interactive shell and its OUTPUT ACK accounting are untouched, which
   * is the whole reason `session_exec` opens a separate channel.
   *
   * `session_exec_cancel` answers `false` when the exec already finished — the caller
   * is racing the probe's natural completion, and that race is normal, not an error.
   */
  async cancelLast() {
    const execId = lastExecId
    if (execId === null) return
    lastExecId = null
    try {
      await invoke('session_exec_cancel', { execId })
    } catch {
      // A cancelled exec is a best-effort action. The probe's own timeout still bounds
      // it, so a failed cancel degrades to the old behaviour rather than to a hang.
    }
  },

  async exec(sessionId, command, timeoutMs) {
    nextExecId += 1
    const execId = `inspector-exec-${nextExecId}`
    lastExecId = execId
    const result = await invoke<ExecResultDto>('session_exec', {
      sessionId,
      command,
      timeoutMs,
      execId,
    })
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      // The Rust DTO uses `exitCode`; tolerate `exit_code` so a rename on one side
      // does not silently report every probe as a failure.
      exitCode: result.exitCode ?? result.exit_code ?? null,
    }
  },
}
