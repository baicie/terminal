import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runTerminalSmoke,
  waitForTerminalSmokeFrame,
} from './run-terminal-smoke'
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
        this.resizeProbeCount === 1
          ? `RESIZED_SIZE_${nonce} 24 80`
          : this.protocol.resizeMarker
      this.append(marker)
    }
  }

  resize(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
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
    expect(term.resizeProbeCount).toBeGreaterThanOrEqual(2)
    expect(term.resizes).toEqual([{ cols: 97, rows: 31 }])
    expect(term.listeners.size).toBe(0)
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
