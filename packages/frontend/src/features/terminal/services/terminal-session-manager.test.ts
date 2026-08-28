import { beforeEach, describe, expect, it, vi } from 'vitest'

const eventHandlers = new Map<string, (event: { payload: unknown }) => void>()

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(
    async (name: string, handler: (event: { payload: unknown }) => void) => {
      eventHandlers.set(name, handler)
      return () => eventHandlers.delete(name)
    },
  ),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === 'session_create_local') return 'session-1'
    return undefined
  }),
}))

vi.mock('./terminal-launcher', () => ({
  startTerminalShell: vi.fn(async () => 'session-1'),
}))

vi.mock('./terminal-session-transport', () => ({
  terminalSessionTransport: {
    write: vi.fn(async () => {}),
    writeRaw: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
    ackOutput: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  },
}))

vi.mock('./serial', () => ({
  serialService: {
    disconnect: vi.fn(async () => {}),
  },
}))

import {
  getTerminalRequestKey,
  TerminalSessionManager,
  type TerminalSessionRequest,
} from './terminal-session-manager'
import { serialService } from './serial'
import { startTerminalShell } from './terminal-launcher'
import { terminalSessionTransport as sessionService } from './terminal-session-transport'

const sessionServiceWithOutputAck = sessionService as typeof sessionService & {
  ackOutput: (sessionId: string, bytes: number) => Promise<void>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const request: TerminalSessionRequest = {
  tabId: 'local-1',
  tabType: 'local',
  cols: 80,
  rows: 24,
}

describe('TerminalSessionManager', () => {
  beforeEach(() => {
    eventHandlers.clear()
    vi.mocked(startTerminalShell).mockReset()
    vi.mocked(startTerminalShell).mockResolvedValue('session-1')
    vi.mocked(sessionService.write).mockReset()
    vi.mocked(sessionService.write).mockResolvedValue(undefined)
    vi.mocked(sessionService.writeRaw).mockReset()
    vi.mocked(sessionService.writeRaw).mockResolvedValue(undefined)
    vi.mocked(sessionService.resize).mockReset()
    vi.mocked(sessionService.resize).mockResolvedValue(undefined)
    vi.mocked(sessionServiceWithOutputAck.ackOutput).mockReset()
    vi.mocked(sessionServiceWithOutputAck.ackOutput).mockResolvedValue(
      undefined,
    )
    vi.mocked(sessionService.close).mockReset()
    vi.mocked(sessionService.close).mockResolvedValue(undefined)
    vi.mocked(serialService.disconnect).mockReset()
    vi.mocked(serialService.disconnect).mockResolvedValue(undefined)
  })

  it('builds a stable key without including credentials', () => {
    const key = getTerminalRequestKey({
      ...request,
      host: {
        id: 'host-1',
        name: 'prod',
        hostname: 'example.com',
        port: 22,
        username: 'root',
        authType: 'password',
        password: 'must-not-be-in-key',
        isFavorite: false,
        portForwards: [],
        createdAt: 0,
        updatedAt: 0,
      },
    })
    expect(key).toBe('local-1:local:host-1:0:::')
    expect(key).not.toContain('must-not-be-in-key')
  })

  it('uses the workspace id to isolate otherwise identical sessions', () => {
    const first = getTerminalRequestKey({
      ...request,
      workspaceId: 'workspace-one',
    })
    const second = getTerminalRequestKey({
      ...request,
      workspaceId: 'workspace-two',
    })

    expect(first).not.toBe(second)
  })

  it('isolates a trust-once pinned request from the normal known-hosts request', () => {
    const trusted = getTerminalRequestKey({
      ...request,
      tabType: 'remote',
      expectedHostKey: 'ssh-ed25519 AAAApinned',
    })
    const knownHosts = getTerminalRequestKey({
      ...request,
      tabType: 'remote',
    })

    expect(trusted).not.toBe(knownHosts)
    expect(trusted).not.toContain('AAAApinned')
  })

  it('isolates jump-host pins without exposing the public key', () => {
    const pinned = getTerminalRequestKey({
      ...request,
      tabType: 'remote',
      expectedJumpHostKey: 'ssh-ed25519 AAAAjump-pinned',
    })
    const knownHosts = getTerminalRequestKey({ ...request, tabType: 'remote' })

    expect(pinned).not.toBe(knownHosts)
    expect(pinned).not.toContain('AAAAjump-pinned')
  })

  it('changes the request key when a saved host revision changes', () => {
    const savedHost = {
      id: 'host-1',
      name: 'prod',
      hostname: 'example.com',
      port: 22,
      username: 'root',
      authType: 'agent' as const,
      isFavorite: false,
      portForwards: [],
      createdAt: 1,
      updatedAt: 1,
    }

    const before = getTerminalRequestKey({ ...request, host: savedHost })
    const after = getTerminalRequestKey({
      ...request,
      host: { ...savedHost, updatedAt: 2 },
    })

    expect(before).not.toBe(after)
  })

  it('restarts when distinct raw pins share the same request hash', async () => {
    const firstRequest = {
      ...request,
      tabType: 'remote' as const,
      expectedHostKey: '7yzx',
    }
    const secondRequest = {
      ...firstRequest,
      expectedHostKey: 'e6ad',
    }
    expect(getTerminalRequestKey(firstRequest)).toBe(
      getTerminalRequestKey(secondRequest),
    )
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockResolvedValueOnce('session-2')
    const manager = new TerminalSessionManager()
    const firstStates: string[] = []
    manager.attach(firstRequest, {
      onOutput: () => {},
      onState: snapshot => firstStates.push(snapshot.status),
    })
    await vi.waitFor(() => expect(firstStates.at(-1)).toBe('connected'))

    manager.attach(secondRequest, {
      onOutput: () => {},
      onState: () => {},
    })

    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalledTimes(2))
    expect(sessionService.close).toHaveBeenCalledWith('session-1')
    expect(startTerminalShell).toHaveBeenLastCalledWith(
      'remote',
      undefined,
      undefined,
      80,
      24,
      undefined,
      'e6ad',
      undefined,
    )
  })

  it.each(['host', 'jump'] as const)(
    'restarts and closes the old session when the %s revision changes',
    async changedRevision => {
      const savedJumpHost = {
        id: 'jump-1',
        name: 'bastion',
        hostname: 'jump.example.com',
        port: 22,
        username: 'operator',
        authType: 'agent' as const,
        isFavorite: false,
        portForwards: [],
        createdAt: 1,
        updatedAt: 1,
      }
      const savedHost = {
        id: 'host-1',
        name: 'prod',
        hostname: 'prod.example.com',
        port: 22,
        username: 'deploy',
        authType: 'agent' as const,
        isFavorite: false,
        portForwards: [],
        jumpHostId: savedJumpHost.id,
        createdAt: 1,
        updatedAt: 1,
      }
      const firstRequest = {
        ...request,
        tabType: 'remote' as const,
        host: savedHost,
        jumpHost: savedJumpHost,
      }
      const nextRequest = {
        ...firstRequest,
        host:
          changedRevision === 'host'
            ? { ...savedHost, updatedAt: 2 }
            : savedHost,
        jumpHost:
          changedRevision === 'jump'
            ? { ...savedJumpHost, updatedAt: 2 }
            : savedJumpHost,
      }
      vi.mocked(startTerminalShell)
        .mockResolvedValueOnce('session-1')
        .mockResolvedValueOnce('session-2')
      const manager = new TerminalSessionManager()
      const firstStates: string[] = []
      manager.attach(firstRequest, {
        onOutput: () => {},
        onState: snapshot => firstStates.push(snapshot.status),
      })
      await vi.waitFor(() => expect(firstStates.at(-1)).toBe('connected'))

      manager.attach(nextRequest, {
        onOutput: () => {},
        onState: () => {},
      })

      await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalledTimes(2))
      expect(sessionService.close).toHaveBeenCalledWith('session-1')
    },
  )

  it('reports sorted session resources and restores the baseline after awaited closes', async () => {
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-z')
      .mockResolvedValueOnce('session-a')
    const manager = new TerminalSessionManager()
    const initialSnapshot = manager.resourceSnapshot()
    const zStates: string[] = []
    const aStates: string[] = []

    expect(initialSnapshot).toEqual({
      recordTabIds: [],
      sessionMappings: [],
    })

    manager.attach(
      { ...request, tabId: 'tab-z' },
      {
        onOutput: () => {},
        onState: snapshot => zStates.push(snapshot.status),
      },
    )
    await vi.waitFor(() => expect(zStates.at(-1)).toBe('connected'))
    manager.attach(
      { ...request, tabId: 'tab-a' },
      {
        onOutput: () => {},
        onState: snapshot => aStates.push(snapshot.status),
      },
    )
    await vi.waitFor(() => expect(aStates.at(-1)).toBe('connected'))

    expect(manager.resourceSnapshot()).toEqual({
      recordTabIds: ['tab-a', 'tab-z'],
      sessionMappings: [
        { sessionId: 'session-a', tabId: 'tab-a' },
        { sessionId: 'session-z', tabId: 'tab-z' },
      ],
    })

    await manager.close('tab-z')
    await manager.close('tab-a')

    expect(manager.resourceSnapshot()).toEqual(initialSnapshot)
  })

  it('routes output after listeners are ready and closes the backend session', async () => {
    const manager = new TerminalSessionManager()
    const output: string[] = []
    const states: string[] = []
    const binding = manager.attach(request, {
      onOutput: data => output.push(data),
      onState: snapshot => states.push(snapshot.status),
    })

    await new Promise(resolve => setTimeout(resolve, 0))
    eventHandlers.get('local-data')?.({
      payload: {
        session_id: 'session-1',
        data: 'ready\r\n',
        is_stderr: false,
      },
    })

    expect(states).toEqual(['idle', 'connecting', 'connected'])
    expect(output).toEqual(['ready\r\n'])

    binding.write('pwd\r')
    await manager.close(request.tabId)
    expect(states).toHaveLength(3)
  })

  it('clears a closed session before accepting more input', async () => {
    const manager = new TerminalSessionManager()
    const snapshots: Array<{ sessionId: string | null; status: string }> = []
    const binding = manager.attach(request, {
      onOutput: () => {},
      onState: snapshot => snapshots.push(snapshot),
    })

    await new Promise(resolve => setTimeout(resolve, 0))
    eventHandlers.get('local-close')?.({ payload: 'session-1' })
    vi.mocked(sessionService.write).mockClear()

    binding.write('echo should-not-send\r')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(snapshots.at(-1)).toEqual({
      error: null,
      sessionId: null,
      status: 'disconnected',
    })
    expect(sessionService.write).not.toHaveBeenCalled()
  })

  it('keeps the final output receipt active through a natural close', async () => {
    const manager = new TerminalSessionManager()
    const output: string[] = []
    let finalReceipt:
      | { isActive: () => boolean; acknowledge: () => void }
      | undefined
    manager.attach(request, {
      onOutput: (data, _bytes, receipt) => {
        output.push(data)
        if (data === 'final frame') finalReceipt = receipt
      },
      onState: () => {},
    })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalled())

    eventHandlers.get('local-data')?.({
      payload: {
        session_id: 'session-1',
        data: 'final frame',
        is_stderr: false,
        bytes: 11,
      },
    })
    eventHandlers.get('local-close')?.({ payload: 'session-1' })

    expect(output).toEqual(['final frame', '\r\n[disconnected]\r\n'])
    expect(finalReceipt?.isActive()).toBe(true)
    finalReceipt?.acknowledge()
    expect(sessionServiceWithOutputAck.ackOutput).toHaveBeenCalledWith(
      'session-1',
      11,
    )
  })

  it('replays a close that arrives before session creation resolves', async () => {
    const start = deferred<string>()
    vi.mocked(startTerminalShell).mockReturnValue(start.promise)
    const manager = new TerminalSessionManager()
    const output: string[] = []
    const states: string[] = []
    manager.attach(request, {
      onOutput: (data, _bytes, receipt) => {
        output.push(data)
        receipt.acknowledge()
      },
      onState: snapshot => states.push(snapshot.status),
    })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalled())

    eventHandlers.get('local-data')?.({
      payload: {
        session_id: 'fast-session',
        data: 'short lived',
        is_stderr: false,
        bytes: 11,
      },
    })
    eventHandlers.get('local-close')?.({ payload: 'fast-session' })
    start.resolve('fast-session')

    await vi.waitFor(() => expect(states.at(-1)).toBe('disconnected'))
    expect(states).not.toContain('connected')
    expect(output).toEqual(['short lived', '\r\n[disconnected]\r\n'])
  })

  it('keeps an early SSH exit code when close follows before creation resolves', async () => {
    const start = deferred<string>()
    vi.mocked(startTerminalShell).mockReturnValue(start.promise)
    const manager = new TerminalSessionManager()
    const remoteRequest = { ...request, tabType: 'remote' as const }
    const output: string[] = []
    const states: string[] = []
    manager.attach(remoteRequest, {
      onOutput: (data, _bytes, receipt) => {
        output.push(data)
        receipt.acknowledge()
      },
      onState: snapshot => states.push(snapshot.status),
    })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalled())

    eventHandlers.get('ssh-exit')?.({ payload: ['fast-session', 23] })
    eventHandlers.get('ssh-close')?.({ payload: 'fast-session' })
    start.resolve('fast-session')

    await vi.waitFor(() => expect(states.at(-1)).toBe('disconnected'))
    expect(states).not.toContain('connected')
    expect(output).toEqual(['\r\n[process exited with code 23]\r\n'])
  })

  it('keeps pre-create final output active when a backend error follows it', async () => {
    const start = deferred<string>()
    vi.mocked(startTerminalShell).mockReturnValue(start.promise)
    const manager = new TerminalSessionManager()
    const states: string[] = []
    let finalReceipt:
      | { isActive: () => boolean; acknowledge: () => void }
      | undefined
    manager.attach(request, {
      onOutput: (data, _bytes, receipt) => {
        if (data === 'final frame') finalReceipt = receipt
      },
      onState: snapshot => states.push(snapshot.status),
    })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalled())

    eventHandlers.get('local-data')?.({
      payload: {
        session_id: 'fast-session',
        data: 'final frame',
        is_stderr: false,
        bytes: 11,
      },
    })
    eventHandlers.get('terminal-error')?.({
      payload: {
        session_id: 'fast-session',
        message: 'reader failed after its final frame',
      },
    })
    start.resolve('fast-session')

    await vi.waitFor(() => expect(states.at(-1)).toBe('error'))
    expect(states).not.toContain('connected')
    expect(finalReceipt?.isActive()).toBe(true)
  })

  it('fails a connecting session when unknown lifecycle buffering overflows', async () => {
    const start = deferred<string>()
    vi.mocked(startTerminalShell).mockReturnValue(start.promise)
    const manager = new TerminalSessionManager()
    const snapshots: Array<{ status: string; error: string | null }> = []
    manager.attach(request, {
      onOutput: () => {},
      onState: snapshot => snapshots.push(snapshot),
    })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalled())

    for (let index = 0; index <= 1024; index++) {
      eventHandlers.get('local-close')?.({ payload: `unknown-${index}` })
    }

    await vi.waitFor(() => expect(snapshots.at(-1)?.status).toBe('error'))
    expect(snapshots.at(-1)?.error).toContain(
      'Terminal lifecycle buffer exceeded',
    )
    start.resolve('real-session')
    await vi.waitFor(() =>
      expect(sessionService.close).toHaveBeenCalledWith('real-session'),
    )
    expect(snapshots.map(snapshot => snapshot.status)).not.toContain(
      'connected',
    )
  })

  it('fails a serial session whose pre-attach close was lost to lifecycle overflow', async () => {
    vi.mocked(startTerminalShell).mockResolvedValue('serial-victim')
    const manager = new TerminalSessionManager()
    await manager.prepare('serial')

    eventHandlers.get('serial-close')?.({ payload: 'serial-victim' })
    for (let index = 0; index < 1024; index++) {
      eventHandlers.get('serial-close')?.({ payload: `unknown-${index}` })
    }

    const snapshots: Array<{ status: string; error: string | null }> = []
    manager.attach(
      {
        ...request,
        tabId: 'serial-victim-tab',
        tabType: 'serial',
        serialSessionId: 'serial-victim',
      },
      {
        onOutput: () => {},
        onState: snapshot => snapshots.push(snapshot),
      },
    )

    await vi.waitFor(() => expect(snapshots.at(-1)?.status).toBe('error'))
    expect(snapshots.at(-1)?.error).toContain(
      'Terminal lifecycle buffer exceeded',
    )
    expect(snapshots.map(snapshot => snapshot.status)).not.toContain(
      'connected',
    )
  })

  it('queues pre-connect input and drains it with one ordered write in flight', async () => {
    const start = deferred<string>()
    const firstWrite = deferred<void>()
    const writes: string[] = []
    let activeWrites = 0
    let maxActiveWrites = 0
    vi.mocked(startTerminalShell).mockReturnValue(start.promise)
    vi.mocked(sessionService.write).mockImplementation(
      async (_sessionId, data) => {
        writes.push(data)
        activeWrites++
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites)
        if (data === 'one') await firstWrite.promise
        activeWrites--
      },
    )

    const manager = new TerminalSessionManager()
    const binding = manager.attach(request, {
      onOutput: () => {},
      onState: () => {},
    })
    binding.write('one')
    binding.write('two')

    expect(sessionService.write).not.toHaveBeenCalled()
    start.resolve('session-1')
    await vi.waitFor(() => expect(sessionService.write).toHaveBeenCalledOnce())

    binding.write('three')
    expect(sessionService.write).toHaveBeenCalledOnce()
    firstWrite.resolve()
    await vi.waitFor(() => expect(writes).toEqual(['one', 'two', 'three']))
    expect(maxActiveWrites).toBe(1)
  })

  it('uses the latest connecting size for creation and the final backend resize', async () => {
    const start = deferred<string>()
    vi.mocked(startTerminalShell).mockReturnValue(start.promise)
    const manager = new TerminalSessionManager()
    const binding = manager.attach(request, {
      onOutput: () => {},
      onState: () => {},
    })

    binding.resize(100, 32)
    binding.resize(132, 47)
    start.resolve('session-1')

    await vi.waitFor(() => expect(sessionService.resize).toHaveBeenCalled())
    expect(startTerminalShell).toHaveBeenCalledWith(
      'local',
      undefined,
      undefined,
      132,
      47,
      undefined,
      undefined,
      undefined,
    )
    expect(sessionService.resize).toHaveBeenLastCalledWith('session-1', 132, 47)
  })

  it('coalesces resize pressure to the latest dimensions', async () => {
    const firstResize = deferred<void>()
    vi.mocked(sessionService.resize).mockImplementation(async (_id, cols) => {
      if (cols === 90) await firstResize.promise
    })
    const manager = new TerminalSessionManager()
    const binding = manager.attach(request, {
      onOutput: () => {},
      onState: () => {},
    })
    await vi.waitFor(() =>
      expect(sessionService.resize).toHaveBeenCalledWith('session-1', 80, 24),
    )
    vi.mocked(sessionService.resize).mockClear()

    binding.resize(90, 30)
    binding.resize(100, 35)
    binding.resize(120, 40)
    await vi.waitFor(() => expect(sessionService.resize).toHaveBeenCalledOnce())
    firstResize.resolve()
    await vi.waitFor(() =>
      expect(sessionService.resize).toHaveBeenLastCalledWith(
        'session-1',
        120,
        40,
      ),
    )
    expect(sessionService.resize).toHaveBeenCalledTimes(2)
  })

  it('delivers terminal output as an opaque VT stream', async () => {
    const manager = new TerminalSessionManager()
    const output: string[] = []
    manager.attach(request, {
      onOutput: data => output.push(data),
      onState: () => {},
    })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalled())

    eventHandlers.get('local-data')?.({
      payload: {
        session_id: 'session-1',
        data: '\x1b[31m%\x1b[0m\r\n%\r\n',
        is_stderr: false,
      },
    })

    expect(output).toEqual(['\x1b[31m%\x1b[0m\r\n%\r\n'])
  })

  it('keeps structured connection errors readable', async () => {
    vi.mocked(startTerminalShell).mockRejectedValue({
      kind: 'authentication_failed',
      message: 'all methods rejected',
    })
    const states: Array<{ error: string | null }> = []
    const manager = new TerminalSessionManager()
    manager.attach(request, {
      onOutput: () => {},
      onState: state => states.push(state),
    })

    await vi.waitFor(() => expect(states.at(-1)?.error).not.toBeNull())
    expect(states.at(-1)?.error).toBe('all methods rejected')
  })

  it('coalesces rapid reconnect requests into one backend restart', async () => {
    const close = deferred<void>()
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockResolvedValueOnce('session-2')
    vi.mocked(sessionService.close).mockReturnValue(close.promise)
    const manager = new TerminalSessionManager()
    const states: Array<{ sessionId: string | null; status: string }> = []
    const binding = manager.attach(request, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        sessionId: 'session-1',
        status: 'connected',
      }),
    )

    binding.reconnect()
    binding.reconnect()

    expect(sessionService.close).toHaveBeenCalledTimes(1)
    expect(startTerminalShell).toHaveBeenCalledTimes(1)
    close.resolve()
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        sessionId: 'session-2',
        status: 'connected',
      }),
    )
    expect(startTerminalShell).toHaveBeenCalledTimes(2)
  })

  it('keeps reconnect coalesced while the replacement session is connecting', async () => {
    const replacement = deferred<string>()
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockReturnValueOnce(replacement.promise)
      .mockResolvedValueOnce('session-3')
    const manager = new TerminalSessionManager()
    const states: Array<{ sessionId: string | null; status: string }> = []
    const binding = manager.attach(request, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        sessionId: 'session-1',
        status: 'connected',
      }),
    )

    binding.reconnect()
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalledTimes(2))
    await new Promise(resolve => setTimeout(resolve, 0))

    binding.reconnect()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(startTerminalShell).toHaveBeenCalledTimes(2)
    replacement.resolve('session-2')
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        sessionId: 'session-2',
        status: 'connected',
      }),
    )
  })

  it('retires natural-close output before starting a new generation', async () => {
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockResolvedValueOnce('session-2')
    const manager = new TerminalSessionManager()
    const states: Array<{ sessionId: string | null; status: string }> = []
    let oldReceipt:
      | { isActive: () => boolean; acknowledge: () => void }
      | undefined
    const firstBinding = manager.attach(request, {
      onOutput: (data, _bytes, receipt) => {
        if (data === 'old frame') oldReceipt = receipt
      },
      onState: snapshot => states.push(snapshot),
    })
    await vi.waitFor(() => expect(states.at(-1)?.sessionId).toBe('session-1'))

    eventHandlers.get('local-data')?.({
      payload: {
        session_id: 'session-1',
        data: 'old frame',
        is_stderr: false,
        bytes: 9,
      },
    })
    eventHandlers.get('local-close')?.({ payload: 'session-1' })
    expect(oldReceipt?.isActive()).toBe(true)

    firstBinding.reconnect()
    await vi.waitFor(() => expect(states.at(-1)?.sessionId).toBe('session-2'))
    expect(oldReceipt?.isActive()).toBe(false)

    const redelivered: string[] = []
    manager.attach(request, {
      onOutput: data => redelivered.push(data),
      onState: () => {},
    })
    expect(redelivered).not.toContain('old frame')
  })

  it('does not let a stale disconnect overwrite a newer connected session', async () => {
    const oldClose = deferred<void>()
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockResolvedValueOnce('session-2')
    vi.mocked(sessionService.close).mockImplementation(async sessionId => {
      if (sessionId === 'session-1') await oldClose.promise
    })
    const manager = new TerminalSessionManager()
    const states: Array<{ sessionId: string | null; status: string }> = []
    const binding = manager.attach(request, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        sessionId: 'session-1',
        status: 'connected',
      }),
    )

    binding.disconnect()
    await vi.waitFor(() =>
      expect(sessionService.close).toHaveBeenCalledWith('session-1'),
    )
    binding.reconnect()
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        sessionId: 'session-2',
        status: 'connected',
      }),
    )

    oldClose.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(states.at(-1)).toMatchObject({
      sessionId: 'session-2',
      status: 'connected',
    })

    binding.write('new-session-input')
    await vi.waitFor(() =>
      expect(sessionService.write).toHaveBeenCalledWith(
        'session-2',
        'new-session-input',
      ),
    )
  })

  it('waits for a stale backend result to close before close resolves', async () => {
    const start = deferred<string>()
    vi.mocked(startTerminalShell).mockReturnValue(start.promise)
    const manager = new TerminalSessionManager()
    const states: string[] = []
    manager.attach(request, {
      onOutput: () => {},
      onState: state => states.push(state.status),
    })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalledOnce())

    let closeResolved = false
    const close = manager.close(request.tabId).then(() => {
      closeResolved = true
    })
    await Promise.resolve()
    expect(closeResolved).toBe(false)

    start.resolve('stale-session')
    await close

    expect(sessionService.close).toHaveBeenCalledWith('stale-session')
    expect(states).toEqual(['idle', 'connecting'])
  })

  it('disconnects serial sessions when their tab closes', async () => {
    vi.mocked(startTerminalShell).mockResolvedValue('serial-1')
    const manager = new TerminalSessionManager()
    manager.attach(
      {
        ...request,
        tabId: 'serial-tab',
        tabType: 'serial',
        serialSessionId: 'serial-1',
      },
      { onOutput: () => {}, onState: () => {} },
    )
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalled())

    await manager.close('serial-tab')

    expect(serialService.disconnect).toHaveBeenCalledWith('serial-1')
  })

  it('does not fake a serial reconnect with a retired session id', async () => {
    vi.mocked(startTerminalShell).mockResolvedValue('serial-1')
    const manager = new TerminalSessionManager()
    const states: Array<{
      sessionId: string | null
      status: string
      error: string | null
    }> = []
    const binding = manager.attach(
      {
        ...request,
        tabId: 'serial-tab',
        tabType: 'serial',
        serialSessionId: 'serial-1',
      },
      { onOutput: () => {}, onState: state => states.push(state) },
    )
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))
    eventHandlers.get('serial-close')?.({ payload: 'serial-1' })
    expect(states.at(-1)?.status).toBe('disconnected')

    binding.reconnect()

    await vi.waitFor(() =>
      expect(states.at(-1)?.error).toContain('serial connection dialog'),
    )
    expect(states.at(-1)).toMatchObject({
      sessionId: null,
      status: 'disconnected',
    })
    expect(startTerminalShell).toHaveBeenCalledTimes(1)
  })

  it('buffers serial output after listeners are prepared but before tab attach', async () => {
    vi.mocked(startTerminalShell).mockResolvedValue('serial-early')
    const manager = new TerminalSessionManager()
    await manager.prepare('serial')
    eventHandlers.get('serial-data')?.({
      payload: {
        session_id: 'serial-early',
        data: 'boot banner\r\n',
        is_stderr: false,
      },
    })
    const output: string[] = []

    manager.attach(
      {
        ...request,
        tabId: 'serial-early-tab',
        tabType: 'serial',
        serialSessionId: 'serial-early',
      },
      { onOutput: data => output.push(data), onState: () => {} },
    )

    await vi.waitFor(() => expect(output).toEqual(['boot banner\r\n']))
  })

  it('routes an output receipt through its backend session id', async () => {
    const manager = new TerminalSessionManager()
    let acknowledgeOutput: (() => void) | undefined
    manager.attach(request, {
      onOutput: (_data, _bytes, receipt) => {
        acknowledgeOutput = receipt.acknowledge
      },
      onState: () => {},
    })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalled())
    eventHandlers.get('local-data')?.({
      payload: {
        session_id: 'session-1',
        data: 'rendered',
        is_stderr: false,
        bytes: 8,
      },
    })

    expect(acknowledgeOutput).toBeTypeOf('function')
    acknowledgeOutput?.()

    await vi.waitFor(() =>
      expect(sessionServiceWithOutputAck.ackOutput).toHaveBeenCalledWith(
        'session-1',
        8,
      ),
    )
  })

  it('does not acknowledge stale output against a reconnected backend session', async () => {
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockResolvedValueOnce('session-2')
    const manager = new TerminalSessionManager()
    const states: Array<{ sessionId: string | null; status: string }> = []
    let completeOldOutput: (() => void) | undefined
    const binding = manager.attach(request, {
      onOutput: (_data, _bytes, receipt) => {
        completeOldOutput = receipt.acknowledge
      },
      onState: state => states.push(state),
    })
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        sessionId: 'session-1',
        status: 'connected',
      }),
    )
    eventHandlers.get('local-data')?.({
      payload: {
        session_id: 'session-1',
        data: 'old',
        is_stderr: false,
        bytes: 3,
      },
    })
    expect(completeOldOutput).toBeTypeOf('function')

    binding.reconnect()
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        sessionId: 'session-2',
        status: 'connected',
      }),
    )
    completeOldOutput?.()

    expect(sessionServiceWithOutputAck.ackOutput).not.toHaveBeenCalled()
  })

  it('redelivers detached unacknowledged output without accepting its stale completion', async () => {
    const manager = new TerminalSessionManager()
    const redelivered: Array<{ data: string; bytes?: number }> = []
    let completeDetachedOutput: (() => void) | undefined
    let completeRedeliveredOutput: (() => void) | undefined
    const firstBinding = manager.attach(request, {
      onOutput: (_data, _bytes, receipt) => {
        completeDetachedOutput = receipt.acknowledge
      },
      onState: () => {},
    })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalled())
    eventHandlers.get('local-data')?.({
      payload: {
        session_id: 'session-1',
        data: 'pending',
        is_stderr: false,
        bytes: 7,
      },
    })
    expect(completeDetachedOutput).toBeTypeOf('function')

    firstBinding.dispose()
    manager.attach(request, {
      onOutput: (data, bytes, receipt) => {
        redelivered.push({ data, bytes })
        completeRedeliveredOutput = receipt.acknowledge
      },
      onState: () => {},
    })
    completeDetachedOutput?.()

    expect.soft(redelivered).toEqual([{ data: 'pending', bytes: 7 }])
    expect(sessionServiceWithOutputAck.ackOutput).not.toHaveBeenCalled()
    completeRedeliveredOutput?.()
    expect(sessionServiceWithOutputAck.ackOutput).toHaveBeenCalledOnce()
    expect(sessionServiceWithOutputAck.ackOutput).toHaveBeenCalledWith(
      'session-1',
      7,
    )
  })

  it('delivers each output batch to one listener and acknowledges it once', async () => {
    const manager = new TerminalSessionManager()
    const consumers: string[] = []
    manager.attach(request, {
      onOutput: (_data, _bytes, receipt) => {
        consumers.push('first')
        receipt.acknowledge()
      },
      onState: () => {},
    })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalled())
    manager.attach(request, {
      onOutput: (_data, _bytes, receipt) => {
        consumers.push('second')
        receipt.acknowledge()
      },
      onState: () => {},
    })

    eventHandlers.get('local-data')?.({
      payload: {
        session_id: 'session-1',
        data: 'once',
        is_stderr: false,
        bytes: 4,
      },
    })

    expect.soft(consumers).toHaveLength(1)
    expect.soft(sessionServiceWithOutputAck.ackOutput).toHaveBeenCalledOnce()
    expect(sessionServiceWithOutputAck.ackOutput).toHaveBeenCalledWith(
      'session-1',
      4,
    )
  })

  it('retains all flow-controlled output while the xterm surface is detached', async () => {
    const manager = new TerminalSessionManager()
    const firstBinding = manager.attach(request, {
      onOutput: () => {},
      onState: () => {},
    })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalled())
    firstBinding.dispose()

    const chunk = 'x'.repeat(1024)
    for (let index = 0; index < 600; index++) {
      eventHandlers.get('local-data')?.({
        payload: {
          session_id: 'session-1',
          data: chunk,
          is_stderr: false,
          bytes: chunk.length,
        },
      })
    }

    let renderedBytes = 0
    manager.attach(request, {
      onOutput: data => {
        renderedBytes += data.length
      },
      onState: () => {},
    })

    expect(renderedBytes).toBe(600 * 1024)
  })

  it('ignores output that arrives after a session has been retired', async () => {
    const manager = new TerminalSessionManager()
    const output: string[] = []
    const states: string[] = []
    const binding = manager.attach(request, {
      onOutput: data => output.push(data),
      onState: snapshot => states.push(snapshot.status),
    })
    await vi.waitFor(() => expect(states.at(-1)).toBe('connected'))

    binding.disconnect()
    await vi.waitFor(() =>
      expect(sessionService.close).toHaveBeenCalledWith('session-1'),
    )
    eventHandlers.get('local-data')?.({
      payload: {
        session_id: 'session-1',
        data: 'late output',
        is_stderr: false,
        bytes: 11,
      },
    })

    expect(output).not.toContain('late output')
  })

  it('closes the backend and rejects further input after an I/O failure', async () => {
    vi.mocked(sessionService.write).mockRejectedValueOnce(
      new Error('writer unavailable'),
    )
    const states: Array<{
      status: string
      sessionId: string | null
      error: string | null
    }> = []
    const manager = new TerminalSessionManager()
    const binding = manager.attach(request, {
      onOutput: () => {},
      onState: snapshot => states.push(snapshot),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    binding.write('will fail')
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    expect(states.at(-1)).toMatchObject({
      sessionId: null,
      error: 'writer unavailable',
    })
    expect(sessionService.close).toHaveBeenCalledWith('session-1')

    binding.write('must not be sent')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(sessionService.write).toHaveBeenCalledOnce()
  })

  it('surfaces backend output failures instead of reporting a normal disconnect', async () => {
    const states: Array<{
      status: string
      sessionId: string | null
      error: string | null
    }> = []
    const manager = new TerminalSessionManager()
    const binding = manager.attach(request, {
      onOutput: () => {},
      onState: snapshot => states.push(snapshot),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    eventHandlers.get('terminal-error')?.({
      payload: {
        session_id: 'session-1',
        message: 'frontend output ACK timed out after 10000 ms',
      },
    })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    expect(states.at(-1)).toMatchObject({
      sessionId: null,
      error: 'frontend output ACK timed out after 10000 ms',
    })
    expect(sessionService.close).toHaveBeenCalledWith('session-1')

    eventHandlers.get('local-close')?.({ payload: 'session-1' })
    binding.write('must not be sent after output failure')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(states.at(-1)?.status).toBe('error')
    expect(sessionService.write).not.toHaveBeenCalled()
  })

  it('keeps a final output receipt active through a backend error', async () => {
    const states: string[] = []
    let finalReceipt:
      | { isActive: () => boolean; acknowledge: () => void }
      | undefined
    const manager = new TerminalSessionManager()
    manager.attach(request, {
      onOutput: (data, _bytes, receipt) => {
        if (data === 'final frame') finalReceipt = receipt
      },
      onState: snapshot => states.push(snapshot.status),
    })
    await vi.waitFor(() => expect(states.at(-1)).toBe('connected'))

    eventHandlers.get('local-data')?.({
      payload: {
        session_id: 'session-1',
        data: 'final frame',
        is_stderr: false,
        bytes: 11,
      },
    })
    eventHandlers.get('terminal-error')?.({
      payload: {
        session_id: 'session-1',
        message: 'reader failed after its final frame',
      },
    })

    await vi.waitFor(() => expect(states.at(-1)).toBe('error'))
    expect(finalReceipt?.isActive()).toBe(true)
    finalReceipt?.acknowledge()
    expect(sessionServiceWithOutputAck.ackOutput).toHaveBeenCalledWith(
      'session-1',
      11,
    )
  })
})
