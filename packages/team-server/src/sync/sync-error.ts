import { HttpException } from '@nestjs/common'

export const SYNC_OPERATION_FAILED = 'SYNC_OPERATION_FAILED'

const SAFE_ERROR_NAMES = new Set([
  'Error',
  'RangeError',
  'TypeError',
  'PrismaClientInitializationError',
  'PrismaClientKnownRequestError',
  'PrismaClientRustPanicError',
  'PrismaClientUnknownRequestError',
  'PrismaClientValidationError',
])

export function describeSyncError(error: unknown): string {
  if (error instanceof HttpException) {
    return `HTTP_${error.getStatus()}`
  }
  const name = (error as { name?: unknown } | null)?.name
  if (typeof name === 'string' && SAFE_ERROR_NAMES.has(name)) {
    return name
  }
  return 'UNEXPECTED_ERROR'
}
