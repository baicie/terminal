/**
 * 单行主机的读取与删除。
 *
 * 拆出 `hosts.ts` 是因为那个文件是**写入路径**（合并、版本、退休顺序），而这两个
 * 函数是**读取与生命周期**，共享的只有「严格读」这一条规则。
 *
 * 两条规则在这里汇合：
 *
 * - **读失败不是「没有」**：`selectStrict` 把「查不出来」与「查出一行都没有」分开。
 *   用宽松的 `select()`，数据库锁住时 `getHostById` 会回答 `null`，连接路径把它当成
 *   「没有凭据」——最危险的降级方向。
 * - **先删行，再删密文**：中间失败留下的是无人引用的密文（浪费），而不是一台秘密
 *   已经消失、行却仍指向它的主机（不能用）。
 */
import type { Host } from '@/types'
import { refVersion } from '@/service/credential-boundary'
import { hostRowToHost } from '@/store/host-mappers'
import { vaultSecretProvider } from '@/service/vault-secret-provider'
import { executeQuery, selectStrict } from './connection'
import type { HostRecord } from './types'

export async function getHostById(id: string): Promise<Host | null> {
  // Strict: this answer decides which credential a connection uses, and "the database
  // could not answer" must not read as "no credential".
  const rows = await selectStrict<HostRecord>('SELECT * FROM hosts WHERE id = ?', [
    id,
  ])
  if (rows.length === 0) return null
  return hostRowToHost(rows[0])
}

export async function deleteHost(id: string): Promise<void> {
  // Row first, then the vault: a failure between the two leaves an unreferenced
  // secret (wasteful) rather than a host whose secret is already gone (broken).
  // The reverse order would make the host unrecoverable if the delete failed.
  //
  // Strict read: if learning *which* credential to retire fails, the delete must not
  // run. Removing the row while leaving the ciphertext behind loses the only record
  // that the secret ever existed.
  const rows = await selectStrict<HostRecord>(
    'SELECT credential_ref FROM hosts WHERE id = ?',
    [id],
  )
  const ref = rows.length > 0 ? hostRowToHost(rows[0]).credentialRef : null
  await executeQuery('DELETE FROM hosts WHERE id = ?', [id])
  if (!ref) return
  try {
    await vaultSecretProvider.removeVersion(
      { type: 'host', id },
      refVersion(ref),
      ref.kinds,
    )
  } catch {
    // A vault that is locked must not make the delete look failed — the row is
    // already gone, so reporting an error here would push the caller into retrying
    // a delete that already happened.
  }
}
