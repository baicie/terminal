import { describe, expect, it, vi } from 'vitest'
import { IDENTIFIER_PATTERN } from '../http-validation'
import {
  generateInviteCode,
  generateLinkToken,
  LINK_TOKEN_HEAD_ALPHABET,
  LINK_TOKEN_LENGTH,
} from './invite-code'

describe('generateInviteCode', () => {
  it('draws every character independently from the secure random source', () => {
    const randomIndex = vi.fn(
      (maximum: number) => (randomIndex.mock.calls.length - 1) % maximum,
    )

    expect(generateInviteCode(randomIndex)).toBe('TEAM-ABCD-EFGH')
    expect(randomIndex).toHaveBeenCalledTimes(8)
    expect(randomIndex.mock.calls.every(([maximum]) => maximum === 32)).toBe(
      true,
    )
  })
})

describe('generateLinkToken', () => {
  it('never starts with a character that identifier validation rejects', () => {
    expect(LINK_TOKEN_HEAD_ALPHABET).toMatch(/^\w+$/)
    expect(LINK_TOKEN_HEAD_ALPHABET).not.toContain('-')

    for (let attempt = 0; attempt < 200; attempt++) {
      const token = generateLinkToken()
      expect(token).toHaveLength(LINK_TOKEN_LENGTH)
      expect(IDENTIFIER_PATTERN.test(token)).toBe(true)
    }
  })
})
