/**
 * 同一台主机的凭据写入串行化。
 *
 * ## 为什么需要
 *
 * `nextVersion(current) = 行上引用 + 1` 保证「新版本不覆盖旧版本」。它不保证并发：
 * 两个 `updateHost` 都读到 version 2，都会算出 version 3，第二个写覆盖第一个写的
 * 密文，然后各自按自己以为的 `previousVersion`（都是 2）去退休。结果是：
 *
 *   - 两个调用都可能报告成功，但只有一次值留下；
 *   - 或者后一个在「结转未重输的 kind」时读不到已退休的版本而失败；
 *   - 任何一个交错下，用户按了两次保存，只得到一次效果，且没有任何提示。
 *
 * `hosts-concurrent-update.test.ts` 用确定性的 barrier 复现了它（修复前 2 红）。
 *
 * ## 为什么是串行化而不是 CAS
 *
 * 版本比较需要在 SQL 里做「UPDATE … WHERE credential_ref 仍是读到的那个值」，而
 * `credential_ref` 是 JSON 文本、格式随版本演进；把比较塞进 SQL 会把版本语义复制
 * 一份到 SQL 文本里，两份迟早不一致。串行化把「读 → 算版本 → 写 → 退休」放回一个
 * 不可分割的段落，与 `host-credentials.ts` 头部描述的排序保证是同一件事。
 *
 * ## 边界
 *
 * 只串行化**同一台主机**的写入：不同主机互不相干，全局锁会让两台主机的保存互相等。
 * 锁在进程内，所以它约束的是本应用；跨进程并发由单实例锁 + SQLite 事务保证，不是
 * 这个模块的职责。
 *
 * 锁本身不吞错：`run` 的 rejection 照常向调用方传播，且锁一定释放。
 */
const locks = new Map<string, Promise<unknown>>()

/**
 * 串行执行 `run`，按 `key` 排队。
 *
 * 返回 `run` 自己的结果或错误。前一个调用抛错不阻塞后一个 —— 队列只保证顺序，不
 * 传播失败。
 */
export async function withHostWriteLock<T>(
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(key)
  const current = (async () => {
    // Await the predecessor, but never let its failure become ours: a failed save
    // must not poison every later save of the same host.
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

/** Test-only: how many hosts currently have a writer queued or running. */
export function __pendingHostWrites(): number {
  return locks.size
}
