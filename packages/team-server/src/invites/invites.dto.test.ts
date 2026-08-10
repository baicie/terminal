import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { CreateInviteDto, JoinByCodeDto, JoinByLinkDto } from './invites.dto'

function errorsFor<T extends object>(type: new () => T, input: object) {
  return validateSync(plainToInstance(type, input))
}

describe('Invite DTO validation', () => {
  it('accepts supported invite and join payloads', () => {
    expect(
      errorsFor(CreateInviteDto, { type: 'LINK', role: 'MEMBER' }),
    ).toEqual([])
    expect(
      errorsFor(CreateInviteDto, { type: 'EMAIL', email: 'a@example.com' }),
    ).toEqual([])
    expect(errorsFor(JoinByCodeDto, { code: 'TEAM-ABCD-2345' })).toEqual([])
    expect(errorsFor(JoinByLinkDto, { userName: 'Alice' })).toEqual([])
  })

  it('rejects unsupported invite types, roles, and missing email addresses', () => {
    expect(errorsFor(CreateInviteDto, { type: 'OTHER' })).not.toEqual([])
    expect(
      errorsFor(CreateInviteDto, { type: 'LINK', role: 'OWNER' }),
    ).not.toEqual([])
    expect(errorsFor(CreateInviteDto, { type: 'EMAIL' })).not.toEqual([])
    expect(
      errorsFor(CreateInviteDto, { type: 'EMAIL', email: 'invalid' }),
    ).not.toEqual([])
  })

  it('rejects malformed invite codes and oversized user names', () => {
    expect(errorsFor(JoinByCodeDto, { code: '1234' })).not.toEqual([])
    expect(errorsFor(JoinByLinkDto, { userName: 'x'.repeat(101) })).not.toEqual(
      [],
    )
  })
})
