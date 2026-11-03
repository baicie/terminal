// Reading every startup gate under one budget, and recording how each ended.
//
// Split out of `terminal-bootstrap.tsx` when the reporting took that file past
// its line limit. The semantics are unchanged: every gate starts together, each
// one independently gives up at the same absolute deadline, and the outcome of
// each is recorded so a silent fallback can be told apart from an ordinary
// launch (P9.3.1 P1-2).
import type { BootstrapConfigReport } from './terminal-bootstrap-deadline'
import { bootstrapNow, loadBootstrapConfig, loadOptionalBootstrapConfigs } from './terminal-bootstrap-deadline'
import { describeBootstrapGates } from './terminal-bootstrap-gates'
import { traceStage } from './service/database/startup-trace'

export interface BootstrapGateLoaders<TSmoke, TRemote, TProbe, TRaw, TShell> {
  smoke: () => Promise<TSmoke | null>
  remotePrompt?: () => Promise<TRemote | null>
  inputProbe: () => Promise<TProbe | null>
  rawProbe?: () => Promise<TRaw | null>
  shellProbe?: () => Promise<TShell | null>
}

export interface BootstrapGateResults<TSmoke, TRemote, TProbe, TRaw, TShell> {
  smoke: TSmoke | null
  optional: {
    remotePrompt: TRemote | null
    inputProbe: TProbe | null
    rawProbe: TRaw | null
    shellProbe: TShell | null
  }
  /** Renders and emits the gate record for the mode that was finally chosen. */
  reportMode: (mode: string) => void
}

/**
 * Starts all five gate reads at once and resolves with their results.
 *
 * Queued instead of concurrent, a cold WebView's first round-trip could take the
 * whole second and every loader behind it returned null without ever being
 * invoked -- the normal app mounted and the runner only found no result.json
 * (run 41437956656, macOS nano-edit).
 */
export async function loadBootstrapGates<TSmoke, TRemote, TProbe, TRaw, TShell>(
  loaders: BootstrapGateLoaders<TSmoke, TRemote, TProbe, TRaw, TShell>,
  deadlineAt: number,
  signal?: AbortSignal,
): Promise<BootstrapGateResults<TSmoke, TRemote, TProbe, TRaw, TShell>> {
  // Each gate records how it ended (loaded / not enabled / timed out / never
  // invoked). Without it, "the probe was not enabled" and "the probe's IPC lost
  // the race with the budget" are the same `null`.
  const gateReports: BootstrapConfigReport[] = []
  const recordGate = (report: BootstrapConfigReport): void => {
    gateReports.push(report)
  }
  const smokePromise = loadBootstrapConfig(
    loaders.smoke,
    deadlineAt,
    signal,
    bootstrapNow,
    recordGate,
    'smoke',
  )
  const optionalPromise = loadOptionalBootstrapConfigs(
    {
      remotePrompt: loaders.remotePrompt,
      inputProbe: loaders.inputProbe,
      rawProbe: loaders.rawProbe,
      shellProbe: loaders.shellProbe,
    },
    deadlineAt,
    signal,
    recordGate,
  )
  // Smoke mode discards the optional results; a rejection arriving in the
  // meantime must not surface as an unhandled one.
  void optionalPromise.catch(() => undefined)

  const smoke = await smokePromise
  // Smoke mode returns before the optional gates are awaited, so callers that
  // only need the smoke answer do not pay for the rest. The promise stays
  // available for the non-smoke path.
  return {
    smoke,
    optional: (await optionalPromise) as BootstrapGateResults<
      TSmoke,
      TRemote,
      TProbe,
      TRaw,
      TShell
    >['optional'],
    // Emitted once, at the point the mode is decided. It goes through the same
    // startup trace the runner already reads, so a probe that silently fell
    // back to the normal app leaves evidence in the process log instead of only
    // a missing result.json 60 seconds later.
    reportMode: (mode: string): void => {
      traceStage('bootstrap-gates', describeBootstrapGates(mode, gateReports))
    },
  }
}
