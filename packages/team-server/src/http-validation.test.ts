import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { IdentifierPipe } from './http-validation'

describe('IdentifierPipe', () => {
  const pipe = new IdentifierPipe()

  it('accepts UUIDs and existing safe identifier formats', () => {
    expect(pipe.transform('00000000-0000-0000-0000-000000000001')).toBe(
      '00000000-0000-0000-0000-000000000001',
    )
    expect(pipe.transform('team.demo:1')).toBe('team.demo:1')
  })

  it('rejects empty, oversized, or unsafe identifiers', () => {
    expect(() => pipe.transform('')).toThrow(BadRequestException)
    expect(() => pipe.transform('x'.repeat(129))).toThrow(BadRequestException)
    expect(() => pipe.transform('../team')).toThrow(BadRequestException)
  })
})
