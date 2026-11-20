/**
 * Handing out request ids that no other run — in this runner *or any other* — has used.
 *
 * ## Round one: within a runner (PR #128)
 *
 * `requestId` is the run id. `cancel(requestId)` addresses whichever backend request
 * holds that id, so two runs sharing one id means the Cancel button hits the wrong
 * request. The caller mints ids from a counter (`use-ai-runtime.ts`), so a counter
 * reset or a restored id produced a duplicate inside one runner's lifetime. The first
 * fix kept a `Set` of issued ids on the runner instance.
 *
 * ## Round two: what a per-instance `Set` cannot cover
 *
 * Two cases, and it is worth being precise about which are real, because overstating
 * this would be the same error as understating it:
 *
 * **Runner rebuild — NOT a production path.** `use-ai-runtime.ts` resets the runner and
 * the counter together, but only inside `__resetAiRunnerForTests`, which production
 * never calls. There is no code path that drops the singleton at runtime, so "a
 * rebuilt runner re-issues `ai-run-1`" is a test-suite hazard, not a product defect.
 * The existing comment claiming otherwise has been corrected rather than left to imply
 * a bug that is not there.
 *
 * **A second window — real, and reachable.** Every window is its own JavaScript realm
 * with its own module scope and its own `runCounter`. Two windows mint `ai-run-1` at
 * the same time, and both reach the same Rust process: `AiRuns` is one `HashMap` in
 * `lib.rs:235`, app-wide. The backend refuses the duplicate (`register` returns `None`
 * rather than overwriting the flag), which is why no cancel has ever been misrouted —
 * but the second window shows `Busy`, "AI is already answering", for a run that is not
 * its own, and its request never starts.
 *
 * ## What this module now does about it
 *
 * The issued set is module-scope (so a rebuild cannot forget it) and every id carries a
 * per-realm prefix. Two realms have different prefixes, so they cannot mint the same id
 * no matter what their counters do.
 *
 * ## What is still not covered, stated plainly
 *
 * A **full page reload** starts a new realm: the `Set` is gone and a new prefix is
 * minted. That is fine for minting — a new prefix cannot collide with an old one — and
 * the backend remains the authority for anything in flight across the reload. Nothing
 * in the renderer can enforce that, and it does not need to.
 */

/**
 * A per-realm prefix.
 *
 * Time plus randomness, in that order, so two realms started in the same millisecond
 * still differ. Not a UUID because the id appears in logs and a short prefix is easier
 * to read; not a bare counter because a counter is exactly what two realms share.
 *
 * `crypto.randomUUID` exists in every WebView this app targets, but the fallback keeps
 * a test environment without it from throwing at import time.
 */
function realmPrefix(): string {
  const stamp = Date.now().toString(36)
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${stamp}-${random}`
}

/**
 * Ids issued anywhere in this realm.
 *
 * Module scope on purpose: a per-instance `Set` is reset whenever the instance is,
 * which is one of the two ways a duplicate gets minted.
 */
const issued = new Set<string>()

const PREFIX = realmPrefix()

export class RunIdIssuer {
  /**
   * A request id no earlier run has used.
   *
   * Keeps the caller's value so logs still correlate with `nextRunId`'s counter, and
   * adds the realm prefix plus a suffix so it is unique regardless.
   */
  next(minted: string): string {
    const base = `${PREFIX}:${minted}`
    let id = base
    for (let suffix = 2; issued.has(id); suffix += 1) {
      id = `${base}#${suffix}`
    }
    issued.add(id)
    return id
  }

  /** How many ids this realm has issued. For diagnostics and tests. */
  size(): number {
    return issued.size
  }
}

/**
 * Test-only: forget every issued id.
 *
 * Exists so a suite that asserts on id shape is not order-dependent. Production code
 * must never call it — doing so would reintroduce the within-realm collision.
 */
export function __resetRunIdsForTests(): void {
  issued.clear()
}
