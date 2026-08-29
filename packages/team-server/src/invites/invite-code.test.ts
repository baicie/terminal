import { describe, expect, it, vi } from 'vitest'
import { generateInviteCode } from './invite-code'

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
