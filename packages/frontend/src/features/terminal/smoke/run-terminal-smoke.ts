import type {
  TerminalSmokeConfig,
  TerminalSmokeResult,
  TerminalSmokeStaleOutputProbe,
  TerminalSmokeStage,
} from './terminal-smoke-contract'
import {
  hasExactLogicalLine,
  type ParsedTerminalBuffer,
  waitForExactLogicalLine,
} from './terminal-smoke-buffer'
import {
  createTerminalSmokeNonce,
  createTerminalSmokeProtocol,
} from './terminal-smoke-protocol'

const RUST_DEADLINE_RESERVE_MS = 15_000
const DEFAULT_FRONTEND_TIMEOUT_MS = 165_000
const DEFAULT_PROBE_INTERVAL_MS = 250
const NEXT_FRAME_FALLBACK_MS = 100

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
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function waitForTerminalSmokeFrame(): Promise<void> {
  return new Promise(resolve => {
    let settled = false
    let frameId: number | null = null
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null
    const finish = () => {
      if (settled) return
      settled = true
      if (frameId !== null) cancelAnimationFrame(frameId)
      if (fallbackTimer !== null) clearTimeout(fallbackTimer)
      resolve()
    }
    frameId = requestAnimationFrame(finish)
    fallbackTimer = setTimeout(finish, NEXT_FRAME_FALLBACK_MS)
  })
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
  const message = errorMessage(error)
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
      await waitForExactLogicalLine(term, probe.barrierMarker, {
        signal: controller.signal,
      })
      if (hasExactLogicalLine(term, probe.staleMarker)) {
        throw new Error('Output from the retired SSH session reached xterm')
      }
      staleOutputRejected = true
      stage = 'ready'
    }

    term.input(protocol.readyCommand)
    await waitForExactLogicalLine(term, protocol.readyMarker, {
      signal: controller.signal,
    })

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
    term.resize(config.targetCols, config.targetRows)
    term.input(protocol.resizeProbeCommand)
    probeTimer = setInterval(
      () => term.input(protocol.resizeProbeCommand),
      probeIntervalMs,
    )
    await waitForExactLogicalLine(term, protocol.resizeMarker, {
      signal: controller.signal,
    })
    clearInterval(probeTimer)
    probeTimer = undefined

    const loadEndVisible = hasExactLogicalLine(term, protocol.loadEndMarker)
    const afterLoadVisible = hasExactLogicalLine(term, protocol.afterLoadMarker)
    const resizedSizeVisible = hasExactLogicalLine(term, protocol.resizeMarker)
    if (
      !loadEndVisible ||
      !afterLoadVisible ||
      !resizedSizeVisible ||
      term.cols !== config.targetCols ||
      term.rows !== config.targetRows
    ) {
      throw new Error('Terminal smoke postconditions are not visible')
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
      reconnectObserved: false,
      staleOutputRejected,
      firstConnectionMs: 0,
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
      reconnectObserved: false,
      staleOutputRejected,
      firstConnectionMs: 0,
    }
  } finally {
    if (probeTimer !== undefined) clearInterval(probeTimer)
    clearTimeout(timeoutTimer)
    options.signal?.removeEventListener('abort', forwardAbort)
    controller.abort()
  }
}
