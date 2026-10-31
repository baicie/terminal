import type { Terminal } from '@baicie/xterm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runTerminalSmoke,
  waitForTerminalSmokeFrame,
} from './run-terminal-smoke'
import { collectTerminalSmokeDiagnostics } from './terminal-smoke-diagnostics'
import { createTerminalSmokeProtocol } from './terminal-smoke-protocol'
import { terminalSmokeTestConfig } from './terminal-smoke-test-fixtures'

const config = terminalSmokeTestConfig
const nonce = 'a1b2c3d4e5f60718'

class FakeTerminal {
  cols = config.initialCols
  rows = config.initialRows
  readonly inputs: string[] = []
  readonly resizes: Array<{ cols: number; rows: number }> = []
  readonly lines: string[] = []
  readonly listeners = new Set<() => void>()
  resizeProbeCount = 0
  emitMarkers = true
  deferFinalResizeDimensions = false
  private readonly protocol = createTerminalSmokeProtocol(config, nonce)

  readonly buffer = {
    active: {
      get length() {
        return terminalForBuffer.lines.length
      },
      getLine(index: number) {
        const text = terminalForBuffer.lines[index]
        if (text === undefined) return undefined
        return {
          isWrapped: false,
          length: text.length,
          translateToString: () => text,
        }
      },
    },
  }

  input(data: string) {
    this.inputs.push(data)
    if (!this.emitMarkers) return
    if (data.includes("'READY_'")) this.append(this.protocol.readyMarker)
    else if (data.includes("'UNICODE_'")) {
      const protocol = this.protocol as typeof this.protocol & {
        unicodeMarker: string
      }
      this.append(protocol.unicodeMarker)
    } else if (data.includes("'LOAD_END_'")) {
      this.append(this.protocol.loadEndMarker)
    } else if (data.includes("'AFTER_LOAD_OK_'")) {
      this.append(this.protocol.afterLoadMarker)
    } else if (data.includes("'RESIZED_SIZE_'")) {
      this.resizeProbeCount += 1
      const marker =
        this.protocol.resizeMarkers[this.resizeProbeCount - 1] ??
        this.protocol.resizeMarker
      this.append(marker)
    }
  }

  resize(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
    if (this.deferFinalResizeDimensions && cols === config.targetCols) {
      this.cols -= 1
      this.rows -= 1
    }
    this.resizes.push({ cols, rows })
  }

  onWriteParsed(listener: () => void) {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  emitOutput(line: string) {
    this.append(line)
  }

  private append(line: string) {
    this.lines.push(line)
    for (const listener of this.listeners) listener()
  }
}

let terminalForBuffer: FakeTerminal

describe('runTerminalSmoke', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('continues when animation frames are throttled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const cancelFrame = vi.fn()
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 42),
    )
    vi.stubGlobal('cancelAnimationFrame', cancelFrame)

    const nextFrame = waitForTerminalSmokeFrame()
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(nextFrame).resolves.toBeUndefined()
    expect(cancelFrame).toHaveBeenCalledWith(42)
  })

  it('drives markers, Unicode, load, and a retried resize through xterm', async () => {
    const term = new FakeTerminal()
    terminalForBuffer = term

    const result = await runTerminalSmoke(term, config, {
      nonce,
      probeIntervalMs: 1,
      nextFrame: async () => {},
      onInteractive: () => 1234.2,
    })

    expect(result).toMatchObject({
      ok: true,
      stage: 'complete',
      loadBytes: 8_388_608,
      terminalCols: 97,
      terminalRows: 31,
      loadEndVisible: true,
      afterLoadVisible: true,
      resizedSizeVisible: true,
      resizeTrace: config.resizeSequence.map(step => ({
        requestedCols: step.cols,
        requestedRows: step.rows,
        observedCols: step.cols,
        observedRows: step.rows,
      })),
      firstConnectionMs: 1235,
    })
    expect(term.inputs.some(value => value.includes("'READY_'"))).toBe(true)
    expect(term.inputs.some(value => value.includes('中文🙂'))).toBe(true)
    expect(
      term.inputs.some(value => value.includes("printf '%01024d' 0")),
    ).toBe(true)
    expect(term.inputs.some(value => value.includes("'AFTER_LOAD_OK_'"))).toBe(
      true,
    )
    expect(term.inputs.some(value => value.includes("'RESIZED_SIZE_'"))).toBe(
      true,
    )
    expect(term.resizeProbeCount).toBeGreaterThanOrEqual(
      config.resizeSequence.length,
    )
    expect(term.resizes).toEqual(config.resizeSequence)
    expect(term.listeners.size).toBe(0)
  })

  it('waits for the final render frame before checking terminal dimensions', async () => {
    const term = new FakeTerminal()
    terminalForBuffer = term
    term.deferFinalResizeDimensions = true
    let frameCount = 0

    const result = await runTerminalSmoke(term, config, {
      nonce,
      probeIntervalMs: 1,
      nextFrame: async () => {
        frameCount += 1
        if (frameCount === 2) {
          term.cols = config.targetCols
          term.rows = config.targetRows
        }
      },
    })

    expect(result).toMatchObject({
      ok: true,
      terminalCols: config.targetCols,
      terminalRows: config.targetRows,
    })
    expect(frameCount).toBe(2)
  })

  it('can stop after the parser-visible ready marker before requesting reconnect', async () => {
    const term = new FakeTerminal()
    terminalForBuffer = term
    const onInteractive = vi.fn(() => 456)

    const result = await runTerminalSmoke(term, config, {
      nonce,
      onInteractive,
      stopAfterInteractive: true,
      nextFrame: async () => {},
    })

    expect(result).toMatchObject({
      ok: true,
      stage: 'ready',
      firstConnectionMs: 456,
      loadBytes: 0,
    })
    expect(onInteractive).toHaveBeenCalledOnce()
    expect(term.inputs).toHaveLength(1)
  })

  it('continues only after the active-session barrier proves stale output was rejected', async () => {
    const term = new FakeTerminal()
    terminalForBuffer = term
    const staleMarker = 'TERMINAL_SMOKE_STALE_OUTPUT_CANARY'
    const barrierMarker = 'TERMINAL_SMOKE_ACTIVE_OUTPUT_BARRIER'

    const result = await runTerminalSmoke(term, config, {
      nonce,
      probeIntervalMs: 1,
      nextFrame: async () => {},
      staleOutputProbe: async () => {
        term.emitOutput(barrierMarker)
        return { staleMarker, barrierMarker }
      },
    })

    expect(result).toMatchObject({
      ok: true,
      stage: 'complete',
      staleOutputRejected: true,
    })
    expect(term.inputs[0]).toContain("'READY_")
  })

  it('fails before issuing shell probes when retired-session output reaches xterm', async () => {
    const term = new FakeTerminal()
    terminalForBuffer = term
    const staleMarker = 'TERMINAL_SMOKE_STALE_OUTPUT_CANARY'
    const barrierMarker = 'TERMINAL_SMOKE_ACTIVE_OUTPUT_BARRIER'

    const result = await runTerminalSmoke(term, config, {
      nonce,
      nextFrame: async () => {},
      staleOutputProbe: async () => {
        term.emitOutput(staleMarker)
        term.emitOutput(barrierMarker)
        return { staleMarker, barrierMarker }
      },
    })

    expect(result).toMatchObject({
      ok: false,
      stage: 'stale-output',
      staleOutputRejected: false,
      error: expect.stringContaining('retired SSH session'),
    })
    expect(term.inputs).toEqual([])
  })

  it('accepts a barrier marker that shares its line with the shell prompt', async () => {
    // The Linux smoke shell prints its prompt without a trailing newline, so
    // the barrier arrives glued to it; an exact-line reader never matches it.
    const term = new FakeTerminal()
    terminalForBuffer = term
    const staleMarker = 'TERMINAL_SMOKE_STALE_OUTPUT_CANARY'
    const barrierMarker = 'TERMINAL_SMOKE_ACTIVE_OUTPUT_BARRIER'

    const result = await runTerminalSmoke(term, config, {
      nonce,
      probeIntervalMs: 1,
      frontendTimeoutMs: 2_000,
      nextFrame: async () => {},
      staleOutputProbe: async () => {
        term.emitOutput(`\u001b]133;A\u0007$ ${barrierMarker}\r\n`)
        return { staleMarker, barrierMarker }
      },
    })

    expect(result).toMatchObject({
      ok: true,
      stage: 'complete',
      staleOutputRejected: true,
    })
    expect(term.inputs[0]).toContain("'READY_")
  })

  it('still fails when the stale canary appears anywhere on screen', async () => {
    const term = new FakeTerminal()
    terminalForBuffer = term
    const staleMarker = 'TERMINAL_SMOKE_STALE_OUTPUT_CANARY'
    const barrierMarker = 'TERMINAL_SMOKE_ACTIVE_OUTPUT_BARRIER'

    const result = await runTerminalSmoke(term, config, {
      nonce,
      nextFrame: async () => {},
      staleOutputProbe: async () => {
        term.emitOutput(`retired session output reached ${staleMarker} here`)
        term.emitOutput(barrierMarker)
        return { staleMarker, barrierMarker }
      },
    })

    expect(result).toMatchObject({
      ok: false,
      stage: 'stale-output',
      staleOutputRejected: false,
      error: expect.stringContaining('retired SSH session'),
    })
    expect(term.inputs).toEqual([])
  })

  it('returns a failure and releases parser listeners after timeout', async () => {
    const term = new FakeTerminal()
    terminalForBuffer = term
    term.emitMarkers = false

    const result = await runTerminalSmoke(term, config, {
      nonce,
      frontendTimeoutMs: 10,
      nextFrame: async () => {},
    })

    expect(result.ok).toBe(false)
    expect(result.stage).toBe('ready')
    expect(result.error).toContain('timed out')
    expect(term.listeners.size).toBe(0)
  })

  it('includes output progress in a timeout failure when diagnostics are available', async () => {
    const term = new FakeTerminal()
    terminalForBuffer = term
    term.emitMarkers = false

    const result = await runTerminalSmoke(term, config, {
      nonce,
      frontendTimeoutMs: 10,
      nextFrame: async () => {},
      diagnostics: () =>
        'accepted=1048576,parsed=0,queued=1015808,chunks=32,inFlight=32768,writeInFlight=true',
    })

    expect(result.error).toContain(
      'output=accepted=1048576,parsed=0,queued=1015808',
    )
  })
})

function terminalWithViewport(
  lines: string[],
  geometry: { cursorY: number; viewportY: number; baseY: number },
) {
  return {
    buffer: {
      active: {
        length: lines.length,
        cursorY: geometry.cursorY,
        viewportY: geometry.viewportY,
        baseY: geometry.baseY,
        getLine(index: number) {
          const text = lines[index]
          if (text === undefined) return undefined
          return {
            isWrapped: false,
            length: text.length,
            translateToString: () => text,
          }
        },
      },
    },
  } as unknown as Terminal
}

describe('collectTerminalSmokeDiagnostics', () => {
  it('reports recent non-empty lines instead of the blank bottom of a 24-row viewport', () => {
    const lines = [
      'AFTER_LOAD_OK_a1b2c3d4',
      ...Array.from({ length: 23 }, () => ''),
    ]
    const diagnostics = JSON.parse(
      collectTerminalSmokeDiagnostics(
        terminalWithViewport(lines, { cursorY: 0, viewportY: 0, baseY: 0 }),
        () => 'input',
        () => 'output',
      ),
    )

    expect(diagnostics.tail).toEqual(['AFTER_LOAD_OK_a1b2c3d4'])
    expect(diagnostics.bufferLength).toBe(24)
  })

  it('includes buffer geometry so an empty tail is distinguishable from an empty terminal', () => {
    const lines = Array.from({ length: 24 }, () => '')
    const diagnostics = JSON.parse(
      collectTerminalSmokeDiagnostics(
        terminalWithViewport(lines, { cursorY: 20, viewportY: 18, baseY: 18 }),
        () => 'input',
        () => 'output',
      ),
    )

    expect(diagnostics.tail).toEqual([])
    expect(diagnostics).toMatchObject({
      bufferLength: 24,
      cursorY: 20,
      viewportY: 18,
      baseY: 18,
    })
  })
})
