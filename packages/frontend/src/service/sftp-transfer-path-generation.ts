/**
 * 同一远端路径的写入代次。
 *
 * ## 缺陷
 *
 * 校验读的是**远端路径**，不是「我写进去的那些字节」。两个传输指向同一路径时：
 *
 * ```
 * A 写完 → A 开始读远端算 hash
 *                      B 覆盖同一路径
 * A 的读取返回 B 的字节
 * ```
 *
 * A 的 `remoteHash` 于是是 B 的内容。若它恰好等于 A 的本地哈希（或任何相等的情形），
 * A 会显示 **verified** —— 用一个已经不存在于任何地方的文件去证明自己的完整性。
 * 实测复现：`A reported verified after its path was overwritten by <B>`。
 *
 * ## 为什么是「代次」而不是互斥
 *
 * 按路径互斥会把「两个传输写同一文件」变成排队，而用户并没有要求这样；它还会在 A 的
 * 校验期间挡住 B 的**传输**，把一次哈希的延迟加到一次真实的数据写入上。
 *
 * 代次只记录一件事实：**这个路径被写过几次**。校验开始时取一个快照，读完之后再取
 * 一次；两次不同就说明「我读到的可能不是我的字节」。这时结论降为
 * `indeterminate` —— 应用不再拥有判断依据，而不是替用户断言文件损坏。
 *
 * ## 边界
 *
 * 这是**进程内**的记账，和 `sftp-session-claim` 一样：它约束的是本应用发起的传输。
 * 另一个客户端改了同一个文件，这里看不到 —— 那种情况本来也只有服务器端的 mtime
 * 才能发现，不在这一层的职责里。
 */
import type { TransferArgs } from './sftp-transfer-types'

/** `remotePath` → 该路径被写入的次数。 */
const generations = new Map<string, number>()

/**
 * 监视中的 key：**只有远端路径**。
 *
 * 第一版把 `sessionId` 也算进去，理由是「同一个路径在不同会话上可能是不同的服务器」。
 * 实测否掉了它：A 走 `s1`、B 走 `s2` 写同一个 `/srv/shared.bin` 时，两个 key 不同，
 * 代次互不影响，A 照样报 `verified`。而那个场景恰恰是这个模块要防的 —— 用户打开两个
 * 到同一台机器的会话，两边各拖一次同一个文件。
 *
 * 反过来的代价是：两个**不同**服务器上的同名路径会被当成同一个。那会让校验多报一次
 * `indeterminate`（更保守的结论），而不是多报一次 `verified`（会骗人的结论）。在两者
 * 之间选保守的那个。
 */
function keyOf(args: TransferArgs): string {
  return args.remotePath
}

/**
 * 记录一次写入完成，返回该路径的新代次。
 *
 * 由队列在传输 `done` 时调用，**在**校验开始之前。
 */
export function noteWrite(args: TransferArgs): number {
  const key = keyOf(args)
  const next = (generations.get(key) ?? 0) + 1
  generations.set(key, next)
  return next
}

/** 该路径当前的代次；从未写过时为 `0`。 */
export function generationOf(args: TransferArgs): number {
  return generations.get(keyOf(args)) ?? 0
}

/**
 * 校验结束后，这个路径是否被别的传输写过？
 *
 * `true` 表示读到的字节可能属于另一个传输，调用方应把结论降为 `indeterminate`。
 */
export function changedSince(args: TransferArgs, snapshot: number): boolean {
  return generationOf(args) !== snapshot
}

/** Test-only: drop the ledger. */
export function __resetPathGenerationsForTests(): void {
  generations.clear()
}
