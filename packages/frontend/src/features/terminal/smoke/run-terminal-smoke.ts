import type {
  TerminalSmokeConfig,
  TerminalSmokeResult,
  TerminalSmokeResizeObservation,
  TerminalSmokeStaleOutputProbe,
  TerminalSmokeStage,
} from './terminal-smoke-contract'
import {
  hasExactLogicalLine,
  hasLogicalLineContaining,
  type ParsedTerminalBuffer,
  waitForExactLogicalLine,
  waitForLogicalLineContaining,
} from './terminal-smoke-buffer'
import {
  createTerminalSmokeNonce,
  createTerminalSmokeProtocol,
} from './terminal-smoke-protocol'
import { waitForTerminalSmokeFrame } from './terminal-smoke-frame'

export { waitForTerminalSmokeFrame } from './terminal-smoke-frame'

const RUST_DEADLINE_RESERVE_MS = 15_000
const DEFAULT_FRONTEND_TIMEOUT_MS = 165_000
const DEFAULT_PROBE_INTERVAL_MS = 250

export interface TerminalSmokeTerminal extends ParsedTerminalBuffer {
  readonly rows: number
  input(data: string): void
  resize(cols: number, rows: number): void
}

export interface RunTerminalSmokeOptions {
  signal?: AbortSignal
  nonce?: string
  frontendTimeoutMs?: number
  probeIntervalMs?: number
  nextFrame?: () => Promise<void>
  diagnostics?: () => string | undefined
  staleOutputProbe?: () => Promise<TerminalSmokeStaleOutputProbe>
  /** Called after the ready marker is parsed by xterm. */
  onInteractive?: () => Promise<number | void> | number | void
  /** Stop after the parser-visible ready marker (used before a reconnect). */
  stopAfterInteractive?: boolean
}

export interface WaitForTerminalSmokeInteractiveOptions {
  signal?: AbortSignal
  nonce?: string
  onInteractive?: () => Promise<number | void> | number | void
}

/**
 * Drive only the parser-visible ready marker. This is used by the reconnect
 * gate so the pre-reconnect session is measured for interactivity but is not
 * counted as one of the ten full smoke rounds.
 */
export async function waitForTerminalSmokeInteractive(
  term: TerminalSmokeTerminal,
  config: TerminalSmokeConfig,
  options: WaitForTerminalSmokeInteractiveOptions = {},
): Promise<void> {
  const controller = new AbortController()
  const protocol = createTerminalSmokeProtocol(
    config,
    options.nonce ?? createTerminalSmokeNonce(),
  )
  const forwardAbort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', forwardAbort, { once: true })
  if (options.signal?.aborted) forwardAbort()
  try {
    term.input(protocol.readyCommand)
    await waitForExactLogicalLine(term, protocol.readyMarker, {
      signal: controller.signal,
    })
    await options.onInteractive?.()
  } finally {
    options.signal?.removeEventListener('abort', forwardAbort)
    controller.abort()
  }
}
function defaultNextFrame(): Promise<void> {
  return waitForTerminalSmokeFrame()
}
function durationSince(startedAt: number): number {
  return Math.max(1, Math.ceil(performance.now() - startedAt))
}
function describeFailure(
  error: unknown,
  diagnostics?: () => string | undefined,
): string {
  const message = error instanceof Error ? error.message : String(error)
  const detail = diagnostics?.()
  return detail ? `${message}; output=${detail}` : message
}
export async function runTerminalSmoke(
  term: TerminalSmokeTerminal,
  config: TerminalSmokeConfig,
  options: RunTerminalSmokeOptions = {},
): Promise<TerminalSmokeResult> {
  const startedAt = performance.now()
  const controller = new AbortController()
  const protocol = createTerminalSmokeProtocol(
    config,
    options.nonce ?? createTerminalSmokeNonce(),
  )
  const nextFrame = options.nextFrame ?? defaultNextFrame
  const frontendTimeoutMs =
    options.frontendTimeoutMs ??
    Math.min(
      DEFAULT_FRONTEND_TIMEOUT_MS,
      config.timeoutMs - RUST_DEADLINE_RESERVE_MS,
    )
  const probeIntervalMs = options.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS
  let stage: TerminalSmokeStage = 'ready'
  let staleOutputRejected = false
  let firstConnectionMs = 0
  const resizeTrace: TerminalSmokeResizeObservation[] = []
  let probeTimer: ReturnType<typeof setInterval> | undefined
  const timeoutTimer = setTimeout(
    () => controller.abort(new Error('Terminal smoke timed out')),
    frontendTimeoutMs,
  )
  const forwardAbort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', forwardAbort, { once: true })
  if (options.signal?.aborted) forwardAbort()

  try {
    if (options.staleOutputProbe) {
      stage = 'stale-output'
      const probe = await options.staleOutputProbe()
      // The smoke shell prints its prompt without a newline, so the barrier
      // can share a line with it; the canary check is the stricter of the two.
      await waitForLogicalLineContaining(term, probe.barrierMarker, {
        signal: controller.signal,
      })
      if (hasLogicalLineContaining(term, probe.staleMarker)) {
        throw new Error('Output from the retired SSH session reached xterm')
      }
      staleOutputRejected = true
      stage = 'ready'
    }

    term.input(protocol.readyCommand)
    await waitForExactLogicalLine(term, protocol.readyMarker, {
      signal: controller.signal,
    })

    if (options.onInteractive) {
      const elapsed = await options.onInteractive()
      if (typeof elapsed === 'number' && Number.isFinite(elapsed) && elapsed > 0) {
        firstConnectionMs = Math.ceil(elapsed)
      }
    }
    if (options.stopAfterInteractive) {
      return {
        ok: true,
        stage: 'ready',
        error: null,
        loadBytes: 0,
        roundsCompleted: 0,
        uniqueSessionCount: 0,
        resourcesRecovered: false,
        durationMs: durationSince(startedAt),
        terminalCols: term.cols,
        terminalRows: term.rows,
        loadEndVisible: false,
        afterLoadVisible: false,
        resizedSizeVisible: false,
        resizeTrace,
        reconnectObserved: false,
        hostWakeSynthesized: false,
        staleOutputRejected,
        firstConnectionMs,
      }
    }

    term.input(protocol.unicodeCommand)
    await waitForExactLogicalLine(term, protocol.unicodeMarker, {
      signal: controller.signal,
    })

    stage = 'load'
    term.input(protocol.loadCommand)
    await waitForExactLogicalLine(term, protocol.loadEndMarker, {
      signal: controller.signal,
    })

    stage = 'after-load'
    await nextFrame()
    term.input(protocol.afterLoadCommand)
    await waitForExactLogicalLine(term, protocol.afterLoadMarker, {
      signal: controller.signal,
    })

    stage = 'resize'
    for (const [index, step] of config.resizeSequence.entries()) {
      const marker = protocol.resizeMarkers[index]
      const command = protocol.resizeProbeCommands[index]
      if (!marker || !command) {
        throw new Error(`Missing resize probe contract for step ${index + 1}`)
      }
      term.resize(step.cols, step.rows)
      term.input(command)
      probeTimer = setInterval(
        () => term.input(command),
        probeIntervalMs,
      )
      await waitForExactLogicalLine(term, marker, {
        signal: controller.signal,
      })
      clearInterval(probeTimer)
      probeTimer = undefined
      resizeTrace.push({
        requestedCols: step.cols,
        requestedRows: step.rows,
        observedCols: step.cols,
        observedRows: step.rows,
      })
    }

    // xterm can finish parsing the final marker before its renderer and resize
    // callbacks have settled. Yield once so the postconditions observe the
    // same dimensions that the user-facing terminal surface exposes.
    await nextFrame()
    const loadEndVisible = hasExactLogicalLine(term, protocol.loadEndMarker)
    const afterLoadVisible = hasExactLogicalLine(term, protocol.afterLoadMarker)
    const resizedSizeVisible = hasExactLogicalLine(term, protocol.resizeMarker)
    if (
      !loadEndVisible ||
      !afterLoadVisible ||
      !resizedSizeVisible ||
      resizeTrace.length !== config.resizeSequence.length ||
      term.cols !== config.targetCols ||
      term.rows !== config.targetRows
    ) {
      throw new Error(
        `Terminal smoke postconditions are not visible: ${JSON.stringify({
          terminalCols: term.cols,
          terminalRows: term.rows,
          loadEndVisible,
          afterLoadVisible,
          resizedSizeVisible,
          resizeTraceLength: resizeTrace.length,
          expectedResizeTraceLength: config.resizeSequence.length,
        })}`,
      )
    }

    stage = 'complete'
    return {
      ok: true,
      stage,
      error: null,
      loadBytes: config.loadBytes,
      roundsCompleted: 1,
      uniqueSessionCount: 1,
      resourcesRecovered: false,
      durationMs: durationSince(startedAt),
      terminalCols: term.cols,
      terminalRows: term.rows,
      loadEndVisible,
      afterLoadVisible,
      resizedSizeVisible,
      resizeTrace,
      reconnectObserved: false,
      hostWakeSynthesized: false,
      staleOutputRejected,
      firstConnectionMs,
    }
  } catch (error) {
    const loadEndVisible = hasExactLogicalLine(term, protocol.loadEndMarker)
    return {
      ok: false,
      stage,
      error: describeFailure(error, options.diagnostics),
      loadBytes: loadEndVisible ? config.loadBytes : 0,
      roundsCompleted: 0,
      uniqueSessionCount: 0,
      resourcesRecovered: false,
      durationMs: durationSince(startedAt),
      terminalCols: term.cols,
      terminalRows: term.rows,
      loadEndVisible,
      afterLoadVisible: hasExactLogicalLine(term, protocol.afterLoadMarker),
      resizedSizeVisible: hasExactLogicalLine(term, protocol.resizeMarker),
      resizeTrace,
      reconnectObserved: false,
      hostWakeSynthesized: false,
      staleOutputRejected,
      firstConnectionMs,
    }
  } finally {
    if (probeTimer !== undefined) clearInterval(probeTimer)
    clearTimeout(timeoutTimer)
    options.signal?.removeEventListener('abort', forwardAbort)
    controller.abort()
  }
}
