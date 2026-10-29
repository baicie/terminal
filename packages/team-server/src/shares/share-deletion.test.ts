import { describe, expect, it, vi } from 'vitest'
import { deleteShareWithAudit } from './share-deletion'

describe('deleteShareWithAudit', () => {
  it('deletes the share and records its tombstone in one transaction', async () => {
    const transaction = {
      auditLog: { create: vi.fn().mockResolvedValue(undefined) },
      share: { delete: vi.fn().mockResolvedValue(undefined) },
    }
    const prisma = {
      $transaction: vi.fn(async callback => callback(transaction)),
    }

    await deleteShareWithAudit(prisma as never, {
      shareId: 'share-a',
      shareType: 'HOST',
      teamId: 'team-a',
      userId: 'user-a',
    })

    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(transaction.share.delete).toHaveBeenCalledWith({
      where: { id: 'share-a' },
    })
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: 'SHARE_DELETED',
        details: { shareId: 'share-a', shareType: 'HOST' },
        teamId: 'team-a',
        userId: 'user-a',
      },
    })
  })
})
