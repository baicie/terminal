import { describe, expect, it } from 'vitest'
import {
  isSwaggerEnabled,
  resolveCorsOrigins,
  resolveRegistrationMode,
  validateServerEnvironment,
} from './server-config'

describe('resolveCorsOrigins', () => {
  it('fails closed when production origins are not configured', () => {
    expect(() => resolveCorsOrigins(undefined, 'production')).toThrow(
      'CORS_ORIGINS',
    )
  })

  it('uses explicit desktop and Vite origins during development', () => {
    const origins = resolveCorsOrigins(undefined, 'development')

    expect(origins).toContain('tauri://localhost')
    expect(origins).toContain('http://tauri.localhost')
    expect(origins).toContain('http://localhost:1420')
    expect(origins).not.toContain('*')
  })

  it('trims configured origins and rejects a credentialed wildcard', () => {
    expect(
      resolveCorsOrigins(
        ' https://one.example,https://two.example ',
        'production',
      ),
    ).toEqual(['https://one.example', 'https://two.example'])
    expect(() => resolveCorsOrigins('*', 'development')).toThrow('wildcard')
  })
})

describe('isSwaggerEnabled', () => {
  it('keeps production documentation disabled unless explicitly enabled', () => {
    expect(isSwaggerEnabled(undefined, 'production')).toBe(false)
    expect(isSwaggerEnabled('true', 'production')).toBe(true)
  })

  it('enables development documentation by default and honors an explicit opt-out', () => {
    expect(isSwaggerEnabled(undefined, 'development')).toBe(true)
    expect(isSwaggerEnabled('false', 'development')).toBe(false)
  })

  it('rejects ambiguous values instead of silently enabling documentation', () => {
    expect(() => isSwaggerEnabled('yes', 'production')).toThrow(
      'SWAGGER_ENABLED',
    )
  })
})

describe('registration and environment safety', () => {
  it('defaults production registration to closed and development to open', () => {
    expect(resolveRegistrationMode(undefined, 'production')).toBe('closed')
    expect(resolveRegistrationMode(undefined, 'development')).toBe('open')
  })

  it('requires a strong token when token-gated registration is enabled', () => {
    expect(() =>
      validateServerEnvironment({
        NODE_ENV: 'production',
        REGISTRATION_MODE: 'token',
      }),
    ).toThrow('REGISTRATION_TOKEN')
    expect(() =>
      validateServerEnvironment({
        NODE_ENV: 'production',
        REGISTRATION_MODE: 'token',
        REGISTRATION_TOKEN: 'short',
      }),
    ).toThrow('at least 32')
  })

  it('rejects ambiguous environment and registration mode values', () => {
    expect(() => validateServerEnvironment({ NODE_ENV: 'prod' })).toThrow(
      'NODE_ENV',
    )
    expect(() =>
      validateServerEnvironment({ NODE_ENV: ' Production ' }),
    ).toThrow('NODE_ENV')
    expect(() => validateServerEnvironment({})).toThrow('NODE_ENV')
    expect(() =>
      validateServerEnvironment({
        NODE_ENV: 'production',
        REGISTRATION_MODE: 'enabled',
      }),
    ).toThrow('REGISTRATION_MODE')
  })
})
