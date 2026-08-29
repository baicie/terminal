import type { PrismaService } from '../prisma.service'

interface ShareDeletion {
  shareId: string
  shareType: string
  teamId: string
  userId: string
}

export async function deleteShareWithAudit(
  prisma: PrismaService,
  deletion: ShareDeletion,
): Promise<void> {
  await prisma.$transaction(async transaction => {
    await transaction.share.delete({ where: { id: deletion.shareId } })
    await transaction.auditLog.create({
      data: {
        teamId: deletion.teamId,
        userId: deletion.userId,
        action: 'SHARE_DELETED',
        details: {
          shareId: deletion.shareId,
          shareType: deletion.shareType,
        },
      },
    })
  })
}
