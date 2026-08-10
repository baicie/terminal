import { BadRequestException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  requireSensitiveCiphertext,
  resolveUpdateSecurity,
} from '../shares/share-security'

type QueueOperation = 'CREATE' | 'UPDATE' | 'DELETE'

interface ExistingShareSecurity {
  encryptedData: string | null
  isSensitive: boolean
}

export function canonicalizeQueuedData(
  operation: QueueOperation,
  teamId: string,
  shareId: string,
  data: unknown,
  existing?: ExistingShareSecurity,
): Prisma.InputJsonValue | undefined {
  if (operation === 'DELETE') return undefined
  if (!isRecord(data)) {
    throw new BadRequestException('Queue data is required for share writes')
  }
  if (data.id !== shareId || data.teamId !== teamId) {
    throw new BadRequestException('Queued share is outside team scope')
  }
  if (typeof data.type !== 'string' || typeof data.permission !== 'string') {
    throw new BadRequestException('Queued share metadata is invalid')
  }

  const baseVersion =
    typeof data.baseVersion === 'number' &&
    Number.isSafeInteger(data.baseVersion) &&
    data.baseVersion >= 0
      ? data.baseVersion
      : undefined
  if (operation === 'UPDATE' && baseVersion === undefined) {
    throw new BadRequestException(
      'Queued updates require a non-negative baseVersion',
    )
  }

  const encryptedData =
    typeof data.encryptedData === 'string' ? data.encryptedData : undefined
  if (data.encryptedData !== undefined && encryptedData === undefined) {
    throw new BadRequestException('encryptedData must be a string')
  }
  if (
    data.isSensitive !== undefined &&
    typeof data.isSensitive !== 'boolean'
  ) {
    throw new BadRequestException('isSensitive must be a boolean')
  }
  if (data.isSensitive === false && encryptedData !== undefined) {
    throw new BadRequestException(
      'encryptedData cannot be used when isSensitive is false',
    )
  }

  const security = existing
    ? resolveUpdateSecurity(
        {
          data: data.data,
          encryptedData,
          isSensitive: data.isSensitive as boolean | undefined,
        },
        existing,
      )
    : {
        encryptedData,
        isSensitive: data.isSensitive === true || encryptedData !== undefined,
      }
  const resolvedEncryptedData = security.encryptedData ?? undefined
  requireSensitiveCiphertext(security.isSensitive, resolvedEncryptedData)
  if (!security.isSensitive && data.data === undefined) {
    throw new BadRequestException('Plaintext queued shares require data')
  }

  return {
    id: shareId,
    teamId,
    type: data.type,
    data: security.isSensitive ? {} : (data.data as Prisma.InputJsonValue),
    ...(security.isSensitive && { encryptedData: resolvedEncryptedData }),
    ...(security.isSensitive || data.isSensitive !== undefined
      ? { isSensitive: security.isSensitive }
      : {}),
    permission: data.permission,
    ...(baseVersion !== undefined && { baseVersion }),
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
