import { HttpException } from '@nestjs/common'
import {
  isLegacyTimestampCursor,
  normalizeSyncProtocol,
  SYNC_CURSOR_VERSION,
} from './sync-protocol'

/**
 * The one refusal shape a client can act on: it names the protocol it must speak
 * and promises that no row was sent, so an old client cannot mistake the answer
 * for an empty window.
 */
export function syncUpgradeRequired(message: string): HttpException {
  return new HttpException(
    {
      statusCode: 426,
      code: 'CLIENT_UPGRADE_REQUIRED',
      message,
      requiredCursorVersion: SYNC_CURSOR_VERSION,
    },
    426,
  )
}

/**
 * Decides whether one request may be served, and whether the client proved it
 * can page.
 *
 * The declaration and the cursor have to agree: a protocol-2 client never sends
 * a bare number, a protocol-1 client never sends a composite cursor. Anything
 * else is guesswork about which half to believe, and guessing here is what
 * silently truncates an old client's window.
 */
export function validateSyncProtocol(
  cursor: number | string | undefined,
  declared: string | null | undefined,
): { protocol2: boolean } {
  const protocol = normalizeSyncProtocol(declared)
  if (isLegacyTimestampCursor(cursor)) {
    throw syncUpgradeRequired(
      'This client uses the retired timestamp cursor. Upgrade the client before syncing again; no data was changed.',
    )
  }
  if (protocol === 'unsupported') {
    throw syncUpgradeRequired(
      `Sync protocol ${String(declared).trim()} is not supported. Upgrade the client before syncing again; no data was changed.`,
    )
  }
  const cursorText = typeof cursor === 'string' ? cursor.trim() : ''
  const cursorIsV2 = cursorText.includes('.')
  if (protocol === '2' && cursorText !== '' && !cursorIsV2) {
    throw syncUpgradeRequired(
      'This client declares sync protocol 2 but sent a protocol-1 cursor. Upgrade the client before syncing again; no data was changed.',
    )
  }
  if (protocol === 'legacy' && cursorIsV2) {
    throw syncUpgradeRequired(
      'This client declares sync protocol 1 but sent a protocol-2 cursor. Upgrade the client before syncing again; no data was changed.',
    )
  }
  // A composite cursor proves the client understands protocol 2 even when it
  // forgot the header; an undeclared, cursor-less request does not.
  return { protocol2: protocol === '2' || cursorIsV2 }
}
