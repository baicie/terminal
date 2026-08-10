import type { ExecutionContext } from '@nestjs/common'
import { UnauthorizedException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { ApiKeyGuard } from './api-key.guard'

function createContext(authorization = 'Bearer api-token') {
  const request: {
    headers: { authorization: string }
    user?: { userId: string }
  } = { headers: { authorization } }
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext

  return { context, request }
}

describe('ApiKeyGuard', () => {
  it('returns unauthorized when token validation rejects the credential', async () => {
    const authService = {
      validateToken: vi
        .fn()
        .mockRejectedValue(new UnauthorizedException('Invalid token')),
    }
    const guard = new ApiKeyGuard(authService as never)
    const { context } = createContext()

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('propagates database failures instead of disguising them as unauthorized', async () => {
    const databaseError = new Error(
      'Prisma connection failed at postgresql://secret-host/team',
    )
    const authService = {
      validateToken: vi.fn().mockRejectedValue(databaseError),
    }
    const guard = new ApiKeyGuard(authService as never)
    const { context } = createContext()

    await expect(guard.canActivate(context)).rejects.toBe(databaseError)
  })
})
