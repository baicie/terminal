import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamApiAuth } from './team-api-auth'

describe('TeamApiAuth.register', () => {
  afterEach(() => vi.restoreAllMocks())

  it('allows first registration with an endpoint but without an API token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ userId: 'user-id', token: 'new-token' }), {
        status: 201,
      }),
    )
    const api = new TeamApiAuth()
    api.configure('https://team.example.test', '', 'user-id')

    const result = await api.register('user-id', 'User')

    expect(result.data?.token).toBe('new-token')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://team.example.test/api/v1/auth/register',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  it('still rejects protected token operations until a token is configured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const api = new TeamApiAuth()
    api.configure('https://team.example.test', '', 'user-id')

    await expect(api.createToken('second token')).resolves.toEqual({
      error: 'API not configured',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
