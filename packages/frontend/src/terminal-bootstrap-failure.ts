import { submitTerminalSmokeResult } from './features/terminal/smoke/terminal-smoke-contract'
import type { TerminalSmokeResult } from './features/terminal/smoke/terminal-smoke-contract'

export async function reportTerminalSmokeBootstrapFailure(
  error: unknown,
  submit: (result: TerminalSmokeResult) => Promise<void> =
    submitTerminalSmokeResult,
): Promise<void> {
  await submit({
    ok: false,
    stage: 'mounting',
    error: error instanceof Error ? error.message : String(error),
    loadBytes: 0,
    roundsCompleted: 0,
    uniqueSessionCount: 0,
    resourcesRecovered: false,
    durationMs: 1,
    terminalCols: 80,
    terminalRows: 24,
    loadEndVisible: false,
    afterLoadVisible: false,
    resizedSizeVisible: false,
    resizeTrace: [],
    reconnectObserved: false,
    hostWakeSynthesized: false,
    staleOutputRejected: false,
    firstConnectionMs: 0,
  })
}
