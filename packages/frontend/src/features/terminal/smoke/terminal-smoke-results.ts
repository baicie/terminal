import type {
  TerminalSmokeConfig,
  TerminalSmokeResult,
  TerminalSmokeStage,
} from './terminal-smoke-contract'

export interface TerminalSmokeProgress {
  result?: TerminalSmokeResult
  resourcesRecovered: boolean
  roundsCompleted: number
  terminalCols?: number
  terminalRows?: number
  uniqueSessionCount: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function durationSince(startedAt: number, timeoutMs: number): number {
  return Math.max(
    1,
    Math.min(timeoutMs, Math.ceil(performance.now() - startedAt)),
  )
}

export function terminalSmokeFailure(
  config: TerminalSmokeConfig,
  startedAt: number,
  stage: TerminalSmokeStage,
  error: unknown,
  progress: TerminalSmokeProgress,
): TerminalSmokeResult {
  return {
    ok: false,
    stage,
    error: errorMessage(error),
    loadBytes: progress.result?.loadBytes ?? 0,
    roundsCompleted: progress.roundsCompleted,
    uniqueSessionCount: progress.uniqueSessionCount,
    resourcesRecovered: progress.resourcesRecovered,
    durationMs: durationSince(startedAt, config.timeoutMs),
    terminalCols:
      progress.result?.terminalCols ??
      progress.terminalCols ??
      config.initialCols,
    terminalRows:
      progress.result?.terminalRows ??
      progress.terminalRows ??
      config.initialRows,
    loadEndVisible: progress.result?.loadEndVisible ?? false,
    afterLoadVisible: progress.result?.afterLoadVisible ?? false,
    resizedSizeVisible: progress.result?.resizedSizeVisible ?? false,
    reconnectObserved: progress.result?.reconnectObserved ?? false,
    staleOutputRejected: progress.result?.staleOutputRejected ?? false,
    firstConnectionMs: progress.result?.firstConnectionMs ?? 0,
  }
}

export function terminalSmokeSuccess(
  config: TerminalSmokeConfig,
  startedAt: number,
  results: TerminalSmokeResult[],
  uniqueSessionCount: number,
): TerminalSmokeResult {
  const last = results.at(-1)
  if (!last) {
    return terminalSmokeFailure(
      config,
      startedAt,
      'complete',
      'No rounds completed',
      {
        resourcesRecovered: true,
        roundsCompleted: 0,
        uniqueSessionCount,
      },
    )
  }
  return {
    ...last,
    ok: true,
    stage: 'complete',
    error: null,
    loadBytes: config.loadBytes,
    roundsCompleted: results.length,
    uniqueSessionCount,
    resourcesRecovered: true,
    durationMs: durationSince(startedAt, config.timeoutMs),
    loadEndVisible: results.every(result => result.loadEndVisible),
    afterLoadVisible: results.every(result => result.afterLoadVisible),
    resizedSizeVisible: results.every(result => result.resizedSizeVisible),
    reconnectObserved: results.some(result => result.reconnectObserved),
    staleOutputRejected: results.some(result => result.staleOutputRejected),
    firstConnectionMs: results.reduce(
      (first, result) => first || result.firstConnectionMs,
      0,
    ),
  }
}
export function terminalSmokeRoundFailure(
  term: { cols: number; rows: number },
  config: TerminalSmokeConfig,
  error: unknown,
): TerminalSmokeResult {
  return terminalSmokeFailure(config, performance.now(), 'connecting', error, {
    resourcesRecovered: false,
    roundsCompleted: 0,
    terminalCols: term.cols,
    terminalRows: term.rows,
    uniqueSessionCount: 0,
  })
}
