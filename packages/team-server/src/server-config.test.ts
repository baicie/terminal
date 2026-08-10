import { describe, expect, it } from 'vitest'
import { isSwaggerEnabled, resolveCorsOrigins } from './server-config'

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
