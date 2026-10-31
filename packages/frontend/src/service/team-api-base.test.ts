import { afterEach, expect, it, vi } from 'vitest'
import { TEAM_API_TIMEOUT_MS, TeamApiBase } from './team-api-base'

class ProbeApi extends TeamApiBase {
  ping() {
    return this.request<{ ok: boolean }>('GET', '/ping')
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('aborts a request that exceeds the timeout instead of hanging forever', async () => {
  vi.useFakeTimers()
  vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new Error('aborted')),
      )
    })
  })
  const api = new ProbeApi()
  api.configure('https://team.example.test', 'token', 'user-id')

  const pending = api.ping()
  await vi.advanceTimersByTimeAsync(TEAM_API_TIMEOUT_MS + 1)

  await expect(pending).resolves.toEqual({
    error: `Request timed out after ${TEAM_API_TIMEOUT_MS}ms`,
  })
})
