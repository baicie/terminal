import { BadRequestException } from '@nestjs/common'

interface ShareSecurityPayload {
  data?: unknown
  encryptedData?: string
  isSensitive?: boolean
}

interface ExistingShareSecurity {
  encryptedData: string | null
  isSensitive: boolean
}

export function requireSensitiveCiphertext(
  isSensitive: boolean,
  encryptedData: string | null | undefined,
): void {
  if (isSensitive && !encryptedData) {
    throw new BadRequestException(
      'encryptedData is required for sensitive shares',
    )
  }
}

export function resolveCreateSensitivity(
  isSensitive: boolean | undefined,
  encryptedData: string | undefined,
): boolean {
  if (isSensitive === false && encryptedData !== undefined) {
    throw new BadRequestException(
      'encryptedData cannot be used when isSensitive is false',
    )
  }
  const resolved = isSensitive ?? encryptedData !== undefined
  requireSensitiveCiphertext(resolved, encryptedData)
  return resolved
}

export function resolveUpdateSecurity(
  payload: ShareSecurityPayload,
  existing: ExistingShareSecurity,
): { encryptedData: string | null | undefined; isSensitive: boolean } {
  if (payload.isSensitive === false && payload.encryptedData !== undefined) {
    throw new BadRequestException(
      'encryptedData cannot be used when isSensitive is false',
    )
  }
  const isSensitive =
    payload.isSensitive ??
    (payload.encryptedData !== undefined || existing.isSensitive)
  const encryptedData = payload.encryptedData ?? existing.encryptedData
  requireSensitiveCiphertext(isSensitive, encryptedData)
  if (existing.isSensitive && !isSensitive && payload.data === undefined) {
    throw new BadRequestException(
      'data is required when converting a sensitive share to plaintext',
    )
  }
  return { encryptedData, isSensitive }
}
