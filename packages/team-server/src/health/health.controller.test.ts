import { ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { HealthController } from './health.controller'

describe('HealthController database failures', () => {
  it.each([
    ['/health', 'check'],
    ['/health/ready', 'readiness'],
  ] as const)(
    'throws HTTP 503 for %s when the database is unavailable',
    async (_endpoint, method) => {
      const prisma = {
        $queryRaw: vi.fn().mockRejectedValue(new Error('database offline')),
      }
      const controller = new HealthController(prisma as never)

      const response = controller[method]()

      await expect(response).rejects.toBeInstanceOf(ServiceUnavailableException)
      await expect(response).rejects.toMatchObject({
        status: 503,
      })
    },
  )
})
