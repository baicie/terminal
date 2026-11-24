/**
 * 同一把 SSH Key 的凭据写入串行化。
 *
 * ## 为什么 SSH Key 需要与 Host 相同的东西
 *
 * RC03 用真实 SQLite 测出 `createSSHKey` 与 `createHost` 是**同形**缺陷：
 * `persistKeySecrets(id, …, null)` 从 `nextKeyVersion(null) === 1` 起算，而已经存在的
 * Key 也住在 version 1。重复 ID 的创建写进原 Key 正在读的键，INSERT 冲突后
 * `discardKeyVersion` 又删掉那一代：
 *
 *     rowSurvived: true, refUnchanged: true
 *     privateKeyStillReadable: undefined
 *     vaultAfter: {}
 *
 * 而且 Key 侧比 Host 侧更靠前：`ssh-keys.ts` 的三个写路径（create / update / delete）
 * **一个都没有**写锁 —— Host 侧至少有 `updateHost`。所以这里是三处，不是一处。
 *
 * ## 为什么不复用 `withHostWriteLock`
 *
 * 那把锁的键是 `host:<id>`，语义属于 Host。Key 与 Host 可以共用同一个 id 字符串，
 * 共用键会让「编辑 host-1」与「编辑 key-1」互相等待 —— 虽不出错，但把两件无关的
 * 事情绑在一起。Key 用自己的前缀 `ssh-key:<id>`，两条路径各自串行、互不阻塞。
 *
 * ## 边界
 *
 * 进程内、按 id。跨进程由单实例锁与 SQLite 事务保证，不是这个模块的职责。
 */
import { select } from './connection'

const locks = new Map<string, Promise<unknown>>()

export async function withKeyWriteLock<T>(
  id: string,
  run: () => Promise<T>,
): Promise<T> {
  const key = `ssh-key:${id}`
  const previous = locks.get(key)
  const current = (async () => {
    // A failed save must not poison later saves of the same key: order, not failure,
    // is what this queue carries.
    if (previous) await previous.catch(() => undefined)
    return run()
  })()
  locks.set(key, current)
  try {
    return await current
  } finally {
    // Only the last queued writer clears the entry; an earlier one deleting it would
    // let a third writer start while the second is still running.
    if (locks.get(key) === current) locks.delete(key)
  }
}

/** Test-only: how many keys currently have a writer queued or running. */
export function __pendingKeyWrites(): number {
  return locks.size
}

/**
 * Does an SSH key row already use this id?
 *
 * A missing answer (a loosely mocked `select`) counts as "no row", same as an empty
 * table. The INSERT's primary key remains the authority.
 */
export async function keyIdExists(id: string): Promise<boolean> {
  const rows = await select('SELECT id FROM ssh_keys WHERE id = ?', [id])
  return Array.isArray(rows) && rows.length > 0
}

/**
 * May a failed create remove the generation it wrote?
 *
 * Only when no row owns the id — a racing create that won the INSERT reads this very
 * version, so deleting it by version alone is the same loss through a narrower door.
 */
export async function keyOwnsNoRow(id: string): Promise<boolean> {
  const rows = await select('SELECT credential_ref FROM ssh_keys WHERE id = ?', [id])
  return !(Array.isArray(rows) && rows.length > 0)
}
