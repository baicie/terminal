import { invoke } from '@tauri-apps/api/core'
import { beforeEach, expect, it, vi } from 'vitest'
import { SessionService } from './session'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('./session-connection-logs', () => ({
  finishConnectionLog: vi.fn(),
  recordConnectionFailure: vi.fn(),
  recordConnectionSuccess: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined)
})

it('acknowledges consumed output with the backend session identity', async () => {
  const service = new SessionService() as SessionService & {
    ackOutput: (sessionId: string, bytes: number) => Promise<void>
  }

  expect(service.ackOutput).toBeTypeOf('function')
  await service.ackOutput('session-ack', 7)

  expect(invoke).toHaveBeenCalledWith('session_ack_output', {
    sessionId: 'session-ack',
    bytes: 7,
  })
})
