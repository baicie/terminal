import { Prisma } from '@prisma/client'
import {
  resolveCreateSensitivity,
  resolveUpdateSecurity,
} from '../shares/share-security'

export interface ShareWritePayload {
  baseVersion?: number
  data?: unknown
  encryptedData?: string
  isSensitive?: boolean
  permission?: string
}

export interface ShareCreatePayload {
  id: string
  teamId: string
  type: string
  data: unknown
  encryptedData?: string
  isSensitive?: boolean
  permission: string
}

interface ExistingShareSecurity {
  encryptedData: string | null
  isSensitive: boolean
  permission: 'READONLY' | 'READWRITE'
}

export function buildShareUpdateData(
  payload: ShareWritePayload,
  existing: ExistingShareSecurity,
  preservePermission = false,
  preserveSensitivity = false,
): Prisma.ShareUpdateInput {
  const permission = preservePermission
    ? existing.permission
    : (payload.permission as 'READONLY' | 'READWRITE' | undefined)
  const permissionData = permission === undefined ? {} : { permission }

  if (preserveSensitivity) {
    return existing.isSensitive
      ? {
          data: {},
          encryptedData: payload.encryptedData ?? existing.encryptedData,
          isSensitive: true,
          ...permissionData,
        }
      : {
          data: payload.data as Prisma.InputJsonValue,
          encryptedData: null,
          isSensitive: false,
          ...permissionData,
        }
  }

  const security = resolveUpdateSecurity(payload, existing)
  return security.isSensitive
    ? {
        data: {},
        encryptedData: security.encryptedData,
        isSensitive: true,
        ...permissionData,
      }
    : {
        data: payload.data as Prisma.InputJsonValue,
        encryptedData: null,
        isSensitive: false,
        ...permissionData,
      }
}

export function buildShareCreateData(
  share: ShareCreatePayload,
  userId: string,
): Prisma.ShareCreateInput {
  const isSensitive = resolveCreateSensitivity(
    share.isSensitive,
    share.encryptedData,
  )
  return {
    id: share.id,
    team: { connect: { id: share.teamId } },
    type: share.type as 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE',
    isSensitive,
    sharedBy: userId,
    permission: share.permission as 'READONLY' | 'READWRITE',
    data: (isSensitive ? {} : share.data) as Prisma.InputJsonValue,
    ...(isSensitive && { encryptedData: share.encryptedData }),
  }
}
