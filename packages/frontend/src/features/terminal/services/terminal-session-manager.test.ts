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

vi.mock('./session', () => ({
  sessionService: {
    write: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  },
}))

import {
  getTerminalRequestKey,
  TerminalSessionManager,
  type TerminalSessionRequest,
} from './terminal-session-manager'
import { sessionService } from './session'

const request: TerminalSessionRequest = {
  tabId: 'local-1',
  tabType: 'local',
  cols: 80,
  rows: 24,
}

describe('TerminalSessionManager', () => {
  beforeEach(() => {
    eventHandlers.clear()
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
    expect(key).toBe('local-1:local:host-1::')
    expect(key).not.toContain('must-not-be-in-key')
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
})
