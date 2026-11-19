/**
 * Running out an activation's disposables.
 *
 * ## Why this is its own module
 *
 * It is the one place that decides what "settled" means, and both the successful
 * deactivation and the failed-activation rollback go through it. Keeping it here makes
 * that a single rule instead of two copies that can drift.
 *
 * ## Two properties it exists to guarantee
 *
 * **One failed cleanup does not stop the rest.** The extension is going down either
 * way; an early return would leave the remaining disposables unrun, leaking more than
 * the one that threw.
 *
 * **A failure is recorded, not swallowed.** A silent `catch` made "released everything"
 * and "one disposer threw and was ignored" indistinguishable — including from tests,
 * which is how the gap survived as long as it did. Only the error's `message` is kept:
 * a disposable is extension code, and its error text is not trusted beyond that.
 */
import type { Disposable } from './extension-types'

export interface DisposeOutcome {
  /** Messages from disposers that threw, in the order they were attempted. */
  problems: string[]
  /** How many disposables were attempted. */
  attempted: number
}

/**
 * Dispose every entry, in reverse registration order.
 *
 * Reverse order because a later registration may depend on an earlier one: the menu
 * that points at a command must go before the command it points at.
 *
 * Never throws. A caller that needs to know whether anything went wrong reads
 * `problems`.
 */
export async function disposeAll(bucket: readonly Disposable[]): Promise<DisposeOutcome> {
  const problems: string[] = []
  const ordered = [...bucket].reverse()
  for (const disposable of ordered) {
    try {
      await disposable.dispose()
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { problems, attempted: ordered.length }
}
