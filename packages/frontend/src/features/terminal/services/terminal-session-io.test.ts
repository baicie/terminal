import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./terminal-session-transport', () => ({
  terminalSessionTransport: {
    write: vi.fn(async () => {}),
    writeRaw: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
  },
}))

vi.mock('./serial', () => ({
  serialService: {
    write: vi.fn(async () => {}),
    writeRaw: vi.fn(async () => {}),
  },
}))

import { serialService } from './serial'
import { terminalSessionTransport as sessionService } from './terminal-session-transport'
import { TerminalSessionIo } from './terminal-session-io'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('TerminalSessionIo raw input', () => {
  beforeEach(() => {
    vi.mocked(sessionService.write).mockReset().mockResolvedValue(undefined)
    vi.mocked(sessionService.writeRaw).mockReset().mockResolvedValue(undefined)
    vi.mocked(sessionService.resize).mockReset().mockResolvedValue(undefined)
    vi.mocked(serialService.write).mockReset().mockResolvedValue(undefined)
    vi.mocked(serialService.writeRaw).mockReset().mockResolvedValue(undefined)
  })

  it('rejects input typed during an automatic reconnect but holds it for a manual one', async () => {
    // The asymmetry is deliberate and load-bearing.
    //
    // Automatic reconnect runs on its own, with a visible countdown. Input
    // typed in that window was aimed at the prompt the *previous* session was
    // showing: a sudo password, a destructive command, half a line. Replaying
    // it into a brand new shell could execute something the user never meant to
    // run against a different machine state, so it is dropped.
    //
    // A manual reconnect is the user deliberately retrying the same thing and
    // expecting their keystrokes to land, so that path buffers them.
    const automatic = new TerminalSessionIo(
      'remote',
      { cols: 80, rows: 24 },
      () => {},
    )
    automatic.connect('session-1')
    automatic.prepareForAutomaticReconnect()
    vi.mocked(sessionService.write).mockClear()
    automatic.write('sudo rm -rf /tmp/x\r')
    await new Promise(resolve => setTimeout(resolve, 5))
    automatic.connect('session-2')
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(sessionService.write).not.toHaveBeenCalled()

    const manual = new TerminalSessionIo(
      'remote',
      { cols: 80, rows: 24 },
      () => {},
    )
    manual.connect('session-1')
    manual.prepareForReconnect()
    vi.mocked(sessionService.write).mockClear()
    manual.write('pwd\r')
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(sessionService.write).not.toHaveBeenCalled()

    manual.connect('session-2')
    await vi.waitFor(() =>
      expect(sessionService.write).toHaveBeenCalledWith('session-2', 'pwd\r'),
    )
  })

  it('keeps text and raw bytes in one FIFO and clones raw input', async () => {
    const io = new TerminalSessionIo('local', { cols: 80, rows: 24 }, () => {})
    const raw = Uint8Array.from([0, 0x80, 0xff])

    io.write('before')
    io.writeRaw(raw)
    raw[0] = 0x7f
    io.connect('local-1')

    await vi.waitFor(() => {
      expect(sessionService.writeRaw).toHaveBeenCalledOnce()
    })
    expect(sessionService.write).toHaveBeenCalledWith('local-1', 'before')
    expect(sessionService.writeRaw).toHaveBeenCalledWith(
      'local-1',
      Uint8Array.from([0, 0x80, 0xff]),
    )
    expect(
      vi.mocked(sessionService.write).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(sessionService.writeRaw).mock.invocationCallOrder[0],
    )
  })

  it('reports accepted, queued, and completed input bytes', async () => {
    const pendingWrite = deferred<void>()
    vi.mocked(sessionService.write).mockImplementation(async () => {
      await pendingWrite.promise
    })
    const io = new TerminalSessionIo('remote', { cols: 80, rows: 24 }, () => {})
    io.connect('ssh-1')
    io.write('ready')

    await vi.waitFor(() => expect(sessionService.write).toHaveBeenCalledOnce())
    expect(io.snapshot()).toMatchObject({
      state: 'connected',
      acceptedBytes: 5,
      sentBytes: 0,
      queuedBytes: 5,
      queuedChunks: 1,
      writeInFlight: true,
    })

    pendingWrite.resolve()
    await vi.waitFor(() => {
      expect(io.snapshot()).toMatchObject({
        acceptedBytes: 5,
        sentBytes: 5,
        queuedBytes: 0,
        queuedChunks: 0,
        writeInFlight: false,
      })
    })
  })

  it('uses serial_write_raw for raw serial input', async () => {
    const io = new TerminalSessionIo('serial', { cols: 80, rows: 24 }, () => {})
    io.connect('serial-1')
    io.writeRaw(Uint8Array.from([0x80, 0xff]))

    await vi.waitFor(() => {
      expect(serialService.writeRaw).toHaveBeenCalledWith(
        'serial-1',
        Uint8Array.from([0x80, 0xff]),
      )
    })
    expect(serialService.write).not.toHaveBeenCalled()
    expect(sessionService.writeRaw).not.toHaveBeenCalled()
  })

  it('does not let a pending input write block the latest resize', async () => {
    const pendingWrite = deferred<void>()
    vi.mocked(sessionService.write).mockImplementation(async () => {
      await pendingWrite.promise
    })
    const io = new TerminalSessionIo('remote', { cols: 80, rows: 24 }, () => {})
    io.connect('ssh-1')
    await vi.waitFor(() => expect(sessionService.resize).toHaveBeenCalledOnce())
    vi.mocked(sessionService.resize).mockClear()

    io.write('blocked input')
    await vi.waitFor(() => expect(sessionService.write).toHaveBeenCalledOnce())
    io.resize(120, 40)
    try {
      await vi.waitFor(() =>
        expect(sessionService.resize).toHaveBeenCalledWith('ssh-1', 120, 40),
      )
    } finally {
      pendingWrite.resolve()
    }
  })

  it('does not let a pending resize block terminal input', async () => {
    const pendingResize = deferred<void>()
    const io = new TerminalSessionIo('remote', { cols: 80, rows: 24 }, () => {})
    io.connect('ssh-1')
    await vi.waitFor(() => expect(sessionService.resize).toHaveBeenCalledOnce())
    vi.mocked(sessionService.resize).mockClear()
    vi.mocked(sessionService.resize).mockImplementation(async () => {
      await pendingResize.promise
    })

    io.resize(120, 40)
    await vi.waitFor(() => expect(sessionService.resize).toHaveBeenCalledOnce())
    io.write('must stay interactive')

    try {
      await vi.waitFor(() =>
        expect(sessionService.write).toHaveBeenCalledWith(
          'ssh-1',
          'must stay interactive',
        ),
      )
    } finally {
      pendingResize.resolve()
    }
  })

  it('does not let an old generation write block new session input', async () => {
    const oldWrite = deferred<void>()
    vi.mocked(sessionService.write).mockImplementation(async sessionId => {
      if (sessionId === 'ssh-old') await oldWrite.promise
    })
    const io = new TerminalSessionIo('remote', { cols: 80, rows: 24 }, () => {})
    io.connect('ssh-old')
    io.write('old input')
    await vi.waitFor(() =>
      expect(sessionService.write).toHaveBeenCalledWith('ssh-old', 'old input'),
    )

    io.prepareForReconnect()
    io.connect('ssh-new')
    io.write('new input')
    await Promise.resolve()

    try {
      expect(sessionService.write).toHaveBeenCalledWith('ssh-new', 'new input')
    } finally {
      oldWrite.resolve()
    }
  })

  it('keeps raw-to-text input order in the shared FIFO', async () => {
    const io = new TerminalSessionIo('local', { cols: 80, rows: 24 }, () => {})
    io.connect('local-1')

    io.writeRaw(Uint8Array.from([0x80, 0xff]))
    io.write('after')

    await vi.waitFor(() => expect(sessionService.write).toHaveBeenCalledOnce())
    expect(
      vi.mocked(sessionService.writeRaw).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(sessionService.write).mock.invocationCallOrder[0])
  })

  it('refuses input past the 1 MiB queue ceiling and says so', async () => {
    // A wedged or slow PTY must not let typing grow the queue without bound.
    // The rejection has to be loud: a silent drop here looks exactly like a
    // terminal that has stopped accepting keystrokes, and the user has no way
    // to tell that from a dead session.
    const pendingWrite = deferred<void>()
    vi.mocked(sessionService.write).mockImplementation(async () => {
      await pendingWrite.promise
    })
    const onError = vi.fn()
    const io = new TerminalSessionIo('remote', { cols: 80, rows: 24 }, onError)
    io.connect('ssh-1')
    io.write('first')
    await vi.waitFor(() => expect(sessionService.write).toHaveBeenCalledOnce())

    // Fill the queue while the first write is still in flight, so nothing
    // drains and the ceiling is reached deterministically.
    const chunk = 'x'.repeat(64 * 1024)
    // The in-flight 'first' chunk still counts toward the ceiling, so 15 of
    // these stay under it and the 16th is the first that must be refused.
    for (let index = 0; index < 15; index += 1) io.write(chunk)
    expect(io.snapshot().state).toBe('connected')

    io.write(chunk)

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect((onError.mock.calls[0]?.[0] as Error).message).toContain(
      'input queue exceeded',
    )
    // Refusing input must not leave the pane writable: the queue is already
    // over its ceiling, so accepting more would just deepen the hole.
    expect(io.snapshot().state).toBe('disconnected')
    pendingWrite.resolve()
  })

  it('applies the same ceiling to raw input as to text input', async () => {
    // Raw input is the paste and IME path. A ceiling that only guarded typed
    // text would let a large paste through unbounded.
    const pendingWrite = deferred<void>()
    vi.mocked(sessionService.writeRaw).mockImplementation(async () => {
      await pendingWrite.promise
    })
    const onError = vi.fn()
    const io = new TerminalSessionIo('remote', { cols: 80, rows: 24 }, onError)
    io.connect('ssh-1')
    io.writeRaw(Uint8Array.from([0x61]))
    await vi.waitFor(() => expect(sessionService.writeRaw).toHaveBeenCalledOnce())

    const chunk = new Uint8Array(64 * 1024)
    for (let index = 0; index < 16; index += 1) io.writeRaw(chunk)
    io.writeRaw(chunk)

    expect(onError).toHaveBeenCalledOnce()
    expect((onError.mock.calls[0]?.[0] as Error).message).toContain(
      'input queue exceeded',
    )
    pendingWrite.resolve()
  })
})
