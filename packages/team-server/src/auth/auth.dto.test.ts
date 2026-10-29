import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { CreateTokenDto, RegisterDto } from './auth.dto'

function errorsFor<T extends object>(type: new () => T, input: object) {
  return validateSync(plainToInstance(type, input))
}

describe('Auth DTO validation', () => {
  it('accepts supported registration and token names', () => {
    expect(
      errorsFor(RegisterDto, { userId: 'user-123', name: 'Alice' }),
    ).toEqual([])
    expect(errorsFor(CreateTokenDto, {})).toEqual([])
  })

  it('rejects empty or malformed user IDs', () => {
    expect(errorsFor(RegisterDto, { userId: '' })).not.toEqual([])
    expect(errorsFor(RegisterDto, { userId: 'user id' })).not.toEqual([])
  })

  it('rejects oversized names at the HTTP boundary', () => {
    expect(
      errorsFor(RegisterDto, { userId: 'user-123', name: 'x'.repeat(101) }),
    ).not.toEqual([])
    expect(errorsFor(CreateTokenDto, { name: 'x'.repeat(101) })).not.toEqual([])
  })
})
