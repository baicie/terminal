import { describe, expect, it, vi } from 'vitest'
import { resolveConflict } from './sync-conflicts'

function prismaFor(isSensitive: boolean) {
  return {
    share: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'share-1',
        teamId: 'team-1',
        sharedBy: 'user-1',
        version: 3n,
        isSensitive,
        data: { name: 'server' },
        encryptedData: isSensitive ? 'ciphertext' : null,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    teamMember: {
      findUnique: vi.fn().mockResolvedValue({ teamId: 'team-1', userId: 'user-1' }),
    },
  } as never
}

describe('resolveConflict sensitivity safety', () => {
  it('refuses a local plaintext resolution against a sensitive share', async () => {
    const prisma = prismaFor(true)
    const result = await resolveConflict(
      prisma,
      'share-1',
      'user-1',
      'LOCAL',
      { data: { name: 'local' }, isSensitive: false, baseVersion: 3, permission: 'READONLY' },
    )
    expect(result).toEqual({ success: false, error: 'SENSITIVE_STATE_MISMATCH' })
    expect((prisma as { share: { updateMany: ReturnType<typeof vi.fn> } }).share.updateMany)
      .not.toHaveBeenCalled()
  })

  it('refuses a sensitive resolution against a plaintext share', async () => {
    const prisma = prismaFor(false)
    const result = await resolveConflict(
      prisma,
      'share-1',
      'user-1',
      'LOCAL',
      { data: {}, isSensitive: true, encryptedData: 'ciphertext', baseVersion: 3, permission: 'READONLY' },
    )
    expect(result).toEqual({ success: false, error: 'SENSITIVE_STATE_MISMATCH' })
    expect((prisma as { share: { updateMany: ReturnType<typeof vi.fn> } }).share.updateMany)
      .not.toHaveBeenCalled()
  })
})
