import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { AddMemberDto, UpdateMemberRoleDto } from './members.dto'

describe('Members DTO validation', () => {
  it('accepts a valid member payload', () => {
    const input = {
      userId: 'user-1',
      userName: 'Alice',
      userEmail: 'alice@example.com',
      role: 'MEMBER',
    }
    expect(validateSync(plainToInstance(AddMemberDto, input))).toEqual([])
  })

  it('rejects malformed identifiers, emails, and roles', () => {
    expect(
      validateSync(plainToInstance(AddMemberDto, { userId: '../user' })),
    ).not.toEqual([])
    expect(
      validateSync(
        plainToInstance(AddMemberDto, {
          userId: 'user-1',
          userEmail: 'invalid',
        }),
      ),
    ).not.toEqual([])
    expect(
      validateSync(plainToInstance(UpdateMemberRoleDto, { role: 'OWNER' })),
    ).not.toEqual([])
  })
})
