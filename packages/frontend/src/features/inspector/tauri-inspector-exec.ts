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

interface ExecResultDto {
  stdout: string
  stderr: string
  exitCode: number | null
  exit_code?: number | null
}

export const tauriInspectorExec: InspectorExec = {
  async exec(sessionId, command, timeoutMs) {
    const result = await invoke<ExecResultDto>('session_exec', {
      sessionId,
      command,
      timeoutMs,
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
