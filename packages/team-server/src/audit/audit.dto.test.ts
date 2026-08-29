import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { AuditQueryDto } from './audit.dto'

describe('AuditQueryDto', () => {
  it('accepts the documented range and rejects invalid or excessive limits', () => {
    expect(
      validateSync(plainToInstance(AuditQueryDto, { limit: '100' })),
    ).toEqual([])
    expect(
      validateSync(plainToInstance(AuditQueryDto, { limit: 'invalid' })),
    ).not.toEqual([])
    expect(
      validateSync(plainToInstance(AuditQueryDto, { limit: '501' })),
    ).not.toEqual([])
  })
})
