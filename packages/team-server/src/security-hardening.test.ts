import { MODULE_METADATA } from '@nestjs/common/constants'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { describe, expect, it } from 'vitest'
import { AppModule } from './app.module'
import { AuthController } from './auth/auth.controller'
import { InvitesController } from './invites/invites.controller'

const THROTTLER_LIMIT = 'THROTTLER:LIMITdefault'
const THROTTLER_TTL = 'THROTTLER:TTLdefault'

function throttleMetadata(target: (...args: never[]) => unknown) {
  return {
    limit: Reflect.getMetadata(THROTTLER_LIMIT, target) as number | undefined,
    ttl: Reflect.getMetadata(THROTTLER_TTL, target) as number | undefined,
  }
}

describe('Team Server rate limiting', () => {
  it('registers the throttler module and global guard', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as {
      module?: unknown
    }[]
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AppModule,
    ) as { provide?: unknown; useClass?: unknown }[]

    expect(imports.some(item => item.module === ThrottlerModule)).toBe(true)
    expect(providers).toContainEqual({
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    })
  })

  it.each([
    ['register', AuthController.prototype.register],
    ['joinByCode', InvitesController.prototype.joinByCode],
    ['joinByLink', InvitesController.prototype.joinByLink],
  ])('applies a strict limit to %s', (_name, handler) => {
    expect(throttleMetadata(handler)).toEqual({ limit: 5, ttl: 60_000 })
  })
})
