import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { CreateShareDto, UpdateShareDto } from './shares.dto'

describe('Shares DTO validation', () => {
  it('accepts plaintext and encrypted share payloads', () => {
    expect(
      validateSync(
        plainToInstance(CreateShareDto, {
          type: 'HOST',
          data: { hostname: 'host.example' },
          permission: 'READONLY',
        }),
      ),
    ).toEqual([])
    expect(
      validateSync(
        plainToInstance(CreateShareDto, {
          type: 'HOST',
          data: {},
          encryptedData: 'ciphertext',
          isSensitive: true,
          permission: 'READWRITE',
        }),
      ),
    ).toEqual([])
  })

  it('rejects invalid enums and missing encrypted data', () => {
    expect(
      validateSync(
        plainToInstance(CreateShareDto, {
          type: 'INVALID',
          data: {},
          permission: 'OWNER',
        }),
      ),
    ).not.toEqual([])
    expect(
      validateSync(
        plainToInstance(CreateShareDto, {
          type: 'HOST',
          data: {},
          isSensitive: true,
          permission: 'READONLY',
        }),
      ),
    ).not.toEqual([])
  })

  it('rejects invalid update flags while allowing a permission-only update', () => {
    expect(
      validateSync(
        plainToInstance(UpdateShareDto, { permission: 'READWRITE' }),
      ),
    ).toEqual([])
    expect(
      validateSync(plainToInstance(UpdateShareDto, { isSensitive: 'yes' })),
    ).not.toEqual([])
    expect(
      validateSync(plainToInstance(UpdateShareDto, { isSensitive: true })),
    ).not.toEqual([])
    expect(
      validateSync(
        plainToInstance(UpdateShareDto, {
          isSensitive: true,
          encryptedData: 'ciphertext',
        }),
      ),
    ).toEqual([])
  })
})
