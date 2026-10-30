import type { Prisma } from '@prisma/client'
import { ForbiddenException } from '@nestjs/common'
import { resolveCreateSensitivity } from '../shares/share-security'

export interface QueuedSharePayload {
  id: string
  teamId: string
  type: string
  data: unknown
  encryptedData?: string
  isSensitive?: boolean
  permission: string
  baseVersion?: number
}

export function requireQueuedShareScope(
  rawData: unknown,
  item: { teamId: string; shareId: string },
): QueuedSharePayload {
  const shareData = rawData as QueuedSharePayload
  if (
    !shareData
    || shareData.teamId !== item.teamId
    || shareData.id !== item.shareId
  ) {
    throw new ForbiddenException('Queued share is outside team scope')
  }
  return shareData
}

export function buildQueuedShareCreateData(
  shareData: QueuedSharePayload,
  teamId: string,
  userId: string,
): Prisma.ShareCreateInput {
  const isSensitive = resolveCreateSensitivity(
    shareData.isSensitive,
    shareData.encryptedData,
  )
  return {
    id: shareData.id,
    team: { connect: { id: teamId } },
    type: shareData.type as 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE',
    isSensitive,
    sharedBy: userId,
    permission: shareData.permission as 'READONLY' | 'READWRITE',
    data: (isSensitive ? {} : shareData.data) as Prisma.InputJsonValue,
    ...(isSensitive && {
      encryptedData: shareData.encryptedData,
    }),
  }
}
