/**
 * Running one activation to completion, or to its failure.
 *
 * ## Why this is a separate module
 *
 * It holds the part of `enable` that has to reason about time: the budget, the
 * retirement of a generation that overran it, and the two race outcomes (a factory that
 * finishes after being abandoned, and a deactivate that lands while it is running).
 * Keeping it out of the registry leaves the registry as the ledger owner, which is a
 * different job.
 *
 * ## The two windows this closes
 *
 * **A factory that overran keeps running.** `withBudget` rejects the await; it cannot
 * cancel the promise. Such a factory can still reach `context.commands.register(...)`,
 * so the generation is retired *before* the rollback, which closes the context's
 * `isCurrent()` gate first and leaves no window between the two.
 *
 * **A deactivate that lands mid-activation.** Its generation bump is what the check
 * after the budget reads; this module reports that outcome instead of deciding it, so
 * the registry keeps a single place where status transitions live.
 */
import type { Disposable } from './extension-types'
import type { ExtensionContext } from './extension-registry-types'

export type ActivationOutcome =
  /** The factory finished and this activation is still the current one. */
  | { kind: 'activated', returned: Disposable | null }
  /** The factory threw, or it exceeded its budget. */
  | { kind: 'failed', error: unknown }
  /** A deactivate replaced this activation while it was running. */
  | { kind: 'superseded' }

export interface RunActivationInput {
  factory: (context: ExtensionContext) => Disposable | void
  context: ExtensionContext
  budgetMs: number
  /** The generation this activation owns. */
  generation: number
  /** The generation the record currently holds. */
  currentGeneration: () => number
  /** Retire this generation, called only when the activation failed. */
  retire: () => void
}

/**
 * Run the factory under its budget and report what happened.
 *
 * Never throws: a timeout, a factory error and a lost race are all outcomes the caller
 * has to settle, and an exception here would strand the ledger.
 */
export async function runActivation(
  input: RunActivationInput,
): Promise<ActivationOutcome> {
  let returned: Disposable | null
  try {
    const value = await withBudgetMs(
      Promise.resolve().then(() => input.factory(input.context)),
      input.budgetMs,
    )
    returned = (value ?? null) as Disposable | null
  } catch (error) {
    // Close the context gate before anything settles, so an overrunning factory cannot
    // register into a bucket that is about to be emptied.
    input.retire()
    return { kind: 'failed', error }
  }

  // A deactivate that landed while the factory was awaiting wins.
  if (input.currentGeneration() !== input.generation) return { kind: 'superseded' }
  return { kind: 'activated', returned }
}

/** `Promise.race` with a deadline, matching the registry's own budget semantics. */
function withBudgetMs<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`activation exceeded its ${ms}ms budget`)),
      ms,
    )
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
