import { GUARDS_METADATA } from '@nestjs/common/constants'
import { describe, expect, it } from 'vitest'
import { ApiKeyGuard } from './api-key.guard'
import { AuthController } from './auth.controller'

describe('AuthController token routes', () => {
  it.each([
    'createToken',
    'listTokens',
    'revokeToken',
    'revokeTokenById',
  ] as const)('protects %s with ApiKeyGuard', methodName => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AuthController.prototype[methodName],
    ) as unknown[] | undefined

    expect(Array.isArray(guards)).toBe(true)
    expect(guards?.includes(ApiKeyGuard)).toBe(true)
  })
})
