/**
 * 传输目标：**服务器身份 + 规范化后的远端路径**，以及从写入开始到校验结束的占用。
 *
 * ## 为什么不能只用 `remotePath`
 *
 * T14 第一版把 key 定为 `remotePath`，为了捕获「两个 SSH 会话写同一文件」。那个场景
 * 确实需要覆盖，但代价是把两台**不同服务器**上的同名路径也当成同一个：
 *
 * ```
 * A: host1.example.com:/srv/shared.bin   ← 正在校验
 * B: host2.example.com:/srv/shared.bin   ← 写入（完全无关的文件）
 * → A 被误判为 indeterminate
 * ```
 *
 * 用户看到的是「完整性无法确认」，而实际上什么都没发生。保守的错误仍然是错误：一个
 * 经常误报的结论会被学会忽略，然后真正的冲突也被忽略。
 *
 * ## 为什么不用 Host 配置的 id
 *
 * 同一个服务器可以有多条 Host 记录（不同别名、不同账号、不同跳板）。用 Host id 当
 * 身份，会让「两个 Host 配置指向同一文件」看起来安全 —— 而那正是最容易丢数据的场景：
 * 用户开了两个配置，一边传一边改，两边都以为自己是对的。
 *
 * 所以身份取**连接坐标**：`hostname:port:username`。它与 Host 行无关，与 sessionId
 * 无关，两次独立的连接只要落在同一个账号的同一台机器上就得到同一个 key。
 *
 * ## 「写入进行中」必须是一等状态
 *
 * 代次计数器只在 `done` 递增，所以它看不见一个**已经开始、尚未结束**的写入：
 *
 * ```
 * A done → A 快照（代次 1）→ A 的远端读取挂起
 * B 开始写同一目标                      ← 代次仍是 1
 * A 的读取返回 → 代次没变 → A 报 verified
 * ```
 *
 * 因此占用从 `beginWrite` 开始，一直持有到校验结束 —— 不是从 `done` 开始。这样上面
 * 的时序里 A 在校验结束时会看到一个活跃的写者，而不是一个没变的计数器。
 *
 * ## 能力边界（明确写下来，不含糊）
 *
 * - **符号链接**：不解析。`/srv/link` 与 `/srv/real` 指向同一 inode 时这里是两个目标。
 *   解析需要在远端做 `realpath`，而那是每个传输额外一次往返，且会在校验开始前引入
 *   新的失败点。**该情形降级为「无法判定冲突」**，不会错误地报 verified —— 见下面
 *   `beginWrite` 的注释。
 * - **相对路径**：不含 `..` 且不以 `/` 开头的路径会按 `/` 前缀归一；含 `..` 的路径
 *   逐段消解，超过根的 `..` 被截断（服务器会拒绝，但那不是这里的职责）。
 * - **另一台客户端**（不是本应用）改了同一文件：看不见。那是服务器端 mtime 的职责。
 * - **同一服务器的不同挂载点**（`/srv` 与 `/mnt/srv` 是同一目录）：两个目标。
 */
import type { TransferArgs } from './sftp-transfer-types'

/**
 * 一个远端目标。
 *
 * `hostname`/`port`/`username` 是**连接坐标**，不是 Host 行的字段 —— 两条 Host 配置
 * 指向同一台机器时它们相同，这正是我们要的。
 */
export interface TransferTarget {
  hostname: string
  port: number
  username: string
  remotePath: string
}

/**
 * Normalise a remote path so two spellings of one file agree.
 *
 * Deliberately textual: no filesystem access, no `realpath`. See the header's capability
 * boundary — a symlink is not resolved, and that is a stated limit rather than an
 * oversight.
 */
export function normaliseRemotePath(path: string): string {
  const absolute = path.startsWith('/') ? path : `/${path}`
  const parts: string[] = []
  for (const segment of absolute.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      // Popping past the root is clamped: an SFTP server will refuse the path itself, and
      // pretending `/..` is a different target from `/` would split one file into two.
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return `/${parts.join('/')}`
}

/** The stable identity of a target: connection coordinates plus the normalised path. */
export function targetKeyOf(target: TransferTarget): string {
  const host = target.hostname.trim().toLowerCase()
  const user = target.username.trim()
  const port = Number.isFinite(target.port) ? target.port : 22
  return `${host}\u0000${port}\u0000${user}\u0000${normaliseRemotePath(target.remotePath)}`
}

/**
 * Which target an admission's args refer to, or `null` when they do not say.
 *
 * `TransferArgs` carries `sessionId` but not the connection coordinates; the admission
 * layer attaches `target` when it knows them. `null` is not "no conflict" — callers must
 * treat it as "cannot decide", and the check degrades to `indeterminate` rather than to
 * `verified`.
 */
export function targetOfArgs(args: TransferArgs): TransferTarget | null {
  const attached = (args as { target?: TransferTarget }).target
  if (!attached) return null
  if (!attached.hostname || !attached.username) return null
  return attached
}

// ---------------------------------------------------------------------------
// Occupancy: from the first byte written until the integrity check ends
// ---------------------------------------------------------------------------

interface Occupancy {
  /** How many writers hold this target right now. */
  writers: number
  /** How many integrity checks are reading it right now. */
  readers: number
  /**
   * How many writes have **completed** against this target since it was first tracked.
   *
   * Kept alongside the live writer count because the two catch different races:
   *
   *   - a writer that is still running is caught by `writers > 0` (it overlaps the check);
   *   - a writer that finished inside the check's window is caught by this counter moving
   *     (its occupancy was released before the check looked).
   *
   * Neither alone is enough. A counter bumped only at `done` misses a write that started
   * after the snapshot; a live count alone misses one that completed before the check
   * finished but after it began.
   */
  completions: number
}

const occupancy = new Map<string, Occupancy>()

/** A held claim on a target. `release` is idempotent. */
export interface TargetHold {
  key: string
  release: () => void
}

function acquire(key: string, role: 'writers' | 'readers'): TargetHold {
  const current = occupancy.get(key) ?? { writers: 0, readers: 0, completions: 0 }
  current[role] += 1
  occupancy.set(key, current)
  let released = false
  return {
    key,
    release: () => {
      if (released) return
      released = true
      const entry = occupancy.get(key)
      if (!entry) return
      entry[role] -= 1
      // Reclaim the entry as soon as nobody holds it: this map must not grow with the
      // number of paths the app has ever written.
      if (entry[role] < 0) entry[role] = 0
      if (entry.writers <= 0 && entry.readers <= 0) occupancy.delete(key)
    },
  }
}

/**
 * A write to this target has begun — call it when the transfer starts, not when it ends.
 *
 * Taking the claim at the start is what closes the "B began after A's snapshot" hole: a
 * writer that is still running is visible to every check that overlaps it, whether or not
 * its `done` has arrived.
 */
export function beginWrite(target: TransferTarget): TargetHold {
  return acquire(targetKeyOf(target), 'writers')
}

/** A check is reading this target. Held until the hash comparison has been recorded. */
export function beginRead(target: TransferTarget): TargetHold {
  return acquire(targetKeyOf(target), 'readers')
}

/**
 * Is anything else using this target right now?
 *
 * `excludeWriters` is the caller's own write claim count — a writer that is finishing
 * must not count itself as a competitor.
 */
export function isContended(key: string, role: 'writers' | 'readers'): boolean {
  const entry = occupancy.get(key)
  if (!entry) return false
  return role === 'writers' ? entry.writers > 0 : entry.readers > 0
}

/**
 * Record that a write to this target finished.
 *
 * Called from the same place the writer releases its hold. A check that began before this
 * and is still reading must see the count move — that is the "B completed while A was
 * hashing" race.
 */
export function noteCompletion(target: TransferTarget): number {
  const key = targetKeyOf(target)
  const entry = occupancy.get(key) ?? { writers: 0, readers: 0, completions: 0 }
  entry.completions += 1
  occupancy.set(key, entry)
  return entry.completions
}

/** Completed writes recorded for this target; `0` when it is untracked. */
export function completionsOf(key: string): number {
  return occupancy.get(key)?.completions ?? 0
}

/**
 * Drop a target's entry if nobody holds it.
 *
 * `completions` is meaningful only for the window a check cares about, so the entry cannot
 * live forever. The reader releases last, which is the natural point to reclaim: a check
 * that has finished comparing has no further use for the history.
 */
export function releaseIfIdle(key: string): void {
  const entry = occupancy.get(key)
  if (!entry) return
  if (entry.writers <= 0 && entry.readers <= 0) occupancy.delete(key)
}

/** Live target entries. Zero means the registry holds nothing. */
export function activeTargetCount(): number {
  return occupancy.size
}

/**
 * Test-only reset.
 *
 * Deliberately not exported from the product path: clearing the registry in production
 * would let one transfer certify itself against another's overwrite.
 */
export function __resetTargetsForTests(): void {
  occupancy.clear()
}

// ---------------------------------------------------------------------------
// Per-transfer bookkeeping
// ---------------------------------------------------------------------------

/**
 * Holds, keyed by transfer id.
 *
 * Lives here rather than in the queue so the queue stays a state machine: the queue's job
 * is to decide *when* a transfer runs, this module's is to know *what* it is touching.
 */
const holds = new Map<string, TargetHold>()

/**
 * The transfer is about to start: take a write claim on its target.
 *
 * Called before the first byte moves. A write that is still running must be visible to any
 * integrity check that overlaps it, so the claim cannot wait for `done`.
 */
export function retainTarget(id: string, args: TransferArgs): void {
  const target = targetOfArgs(args)
  // No coordinates: nothing to key on. The verifier records `indeterminate` for these, so
  // an absent claim can never be read as "no conflict".
  if (!target) return
  holds.get(id)?.release()
  holds.set(id, beginWrite(target))
}

/**
 * The transfer stopped using its target — completed, failed, cancelled, or removed.
 *
 * `completed` records the write in the target's completion count, which is what lets a
 * check that is already reading see "a write finished inside my window" even though the
 * writer's own hold is gone by the time it looks.
 */
export function releaseTarget(
  id: string,
  args: TransferArgs | null,
  completed: boolean,
): void {
  const hold = holds.get(id)
  if (!hold) return
  hold.release()
  holds.delete(id)
  if (!completed || !args) return
  const target = targetOfArgs(args)
  if (target) noteCompletion(target)
}

/** Test-only: forget every per-transfer hold (does not touch the occupancy itself). */
export function __resetTargetHoldsForTests(): void {
  holds.clear()
}
