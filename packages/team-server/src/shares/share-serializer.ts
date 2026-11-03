// P9.3.1 P0-2：Share 的 wire 表示。
//
// Prisma 的 `Share.version` 是 BigInt，而 Node 的原生 `JSON.stringify` 不能
// 序列化 bigint（`TypeError: Do not know how to serialize a BigInt`）。只要
// controller 直接返回 Prisma 行，`GET /teams/:teamId/shares/:shareId` 与列表
// 接口就会 500——同步接口没这个问题，因为它一直走 `toShareSnapshot`。
//
// 所以 REST 也走同一个映射：`version` 是 JSON number，与 `ShareSnapshot`
// 完全一致。客户端 DTO 早已声明 `version: number`，改字符串会是一次跨栈契约
// 变更，而同步接口仍发 number——两套接口给出两种类型只会制造新的漂移。

import type { ShareSnapshot } from '../sync/sync-results'
import { parseVersion } from '../sync/sync-protocol'

/** The Prisma row shape this module consumes; only the columns it maps. */
export interface ShareRow {
  id: string
  teamId: string
  type: string
  data: unknown
  encryptedData: string | null
  isSensitive: boolean
  sharedBy: string
  permission: string
  createdAt: Date
  updatedAt: Date
  version: bigint | number
}

/**
 * Converts one stored share to the JSON shape the API promises.
 *
 * Throws rather than silently losing precision: a version beyond
 * `Number.MAX_SAFE_INTEGER` cannot be represented as a JSON number, and
 * emitting a rounded one would make two different versions indistinguishable to
 * the client's conditional writes.
 */
export function toShareSnapshot(row: ShareRow): ShareSnapshot {
  const version = parseVersion(row.version)
  if (!Number.isSafeInteger(version)) {
    throw new RangeError(
      `share ${row.id} has version ${String(row.version)}, which cannot be sent as a JSON number`,
    )
  }
  return {
    id: row.id,
    teamId: row.teamId,
    type: row.type,
    data: row.data,
    encryptedData: row.encryptedData,
    isSensitive: row.isSensitive,
    sharedBy: row.sharedBy,
    permission: row.permission,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version,
  }
}

export function toShareSnapshots(rows: ShareRow[]): ShareSnapshot[] {
  return rows.map(row => toShareSnapshot(row))
}
