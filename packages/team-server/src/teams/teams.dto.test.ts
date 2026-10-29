import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { TeamNameDto } from './teams.dto'

describe('TeamNameDto', () => {
  it('accepts a bounded non-empty name', () => {
    expect(
      validateSync(plainToInstance(TeamNameDto, { name: 'Operations' })),
    ).toEqual([])
  })

  it('rejects blank and oversized names', () => {
    expect(
      validateSync(plainToInstance(TeamNameDto, { name: '   ' })),
    ).not.toEqual([])
    expect(
      validateSync(plainToInstance(TeamNameDto, { name: 'x'.repeat(101) })),
    ).not.toEqual([])
  })
})
