import type { PrismaService } from '../prisma.service'
import { ConflictException, UnauthorizedException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthService } from './auth.service'
import { hashApiToken } from './token-hash'

function createPrismaMock() {
  const mock = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    apiToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  }
  mock.$transaction.mockImplementation(
    async (callback: (client: unknown) => Promise<unknown>) => callback(mock),
  )
  return mock
}

let prisma: ReturnType<typeof createPrismaMock>
let service: AuthService

beforeEach(() => {
  prisma = createPrismaMock()
  service = new AuthService(prisma as unknown as PrismaService)
})

describe('AuthService.register', () => {
  it('refuses to issue a new token for an existing user id', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' })

    await expect(service.register('existing-user')).rejects.toBeInstanceOf(
      ConflictException,
    )
    expect(prisma.apiToken.create).not.toHaveBeenCalled()
  })

  it('only writes fields present in the Prisma User model', async () => {
    prisma.user.findUnique.mockResolvedValue(null)
    prisma.user.create.mockResolvedValue({ id: 'new-user' })
    prisma.apiToken.create.mockResolvedValue({})

    await service.register('new-user')

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { id: 'new-user' },
    })
  })
})

describe('AuthService token storage', () => {
  it('stores only a SHA-256 digest when creating a token', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' })
    prisma.apiToken.create.mockResolvedValue({})

    const result = await service.createToken('user-1', 'Desktop')
    const storedToken = prisma.apiToken.create.mock.calls[0][0].data.token

    expect(result.token).toHaveLength(32)
    expect(storedToken).toBe(hashApiToken(result.token))
    expect(storedToken).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(storedToken).not.toBe(result.token)
  })

  it('never accepts a stored digest as the bearer token', async () => {
    const storedDigest = hashApiToken('secret-token')
    const tokenRecord = {
      id: 'token-1',
      token: storedDigest,
      userId: 'user-1',
      expiresAt: null,
    }
    prisma.apiToken.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(where.token === storedDigest ? tokenRecord : null),
    )

    await expect(service.validateToken(storedDigest)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
    expect(prisma.apiToken.update).not.toHaveBeenCalled()
  })

  it('migrates a valid legacy plaintext token after first use', async () => {
    const legacyRecord = {
      id: 'token-1',
      token: 'legacy-token',
      userId: 'user-1',
      expiresAt: null,
    }
    prisma.apiToken.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(where.token === 'legacy-token' ? legacyRecord : null),
    )
    prisma.apiToken.update.mockResolvedValue({})

    await expect(service.validateToken('legacy-token')).resolves.toEqual({
      userId: 'user-1',
    })
    expect(prisma.apiToken.update).toHaveBeenCalledWith({
      where: { id: 'token-1' },
      data: { token: hashApiToken('legacy-token') },
    })
  })
})
