/**
 * Settling one activation without touching its successor.
 *
 * ## Why ownership is by generation, not by extension id
 *
 * Cleanup suspends inside the disposal loop. A new activation can land during that
 * suspension, and clearing the ledger by extension id would then remove the *live*
 * activation's contributions.
 *
 * Measured before this existed: after such a race the record read `active` with
 * `commands()` empty — alive by status, unreachable in practice, and the only symptom
 * was a command missing from a palette.
 *
 * So the ledger is cleared only when the record still points at the generation being
 * settled. Otherwise this cleanup belongs to a retired activation and touches nothing
 * that is still current.
 */
import { disposeAll } from './dispose-all'
import type { Disposable } from './extension-types'

export interface SettleOwnedInput {
  bucket: Disposable[]
  extensionId: string
  /** The generation whose registrations are being settled. */
  generation: number
  /** The generation the registry currently holds for this extension. */
  currentGeneration: () => number | undefined
  /** Remove the extension's ledger entries — only called when it is still current. */
  clear: () => void
}

/**
 * Dispose this activation's bucket and clear the ledger if it still owns it.
 *
 * Returns the disposers that threw, so the caller can record them. Never throws.
 */
export async function settleOwnedContributions(
  input: SettleOwnedInput,
): Promise<{ problems: string[] }> {
  const { problems } = await disposeAll(input.bucket)
  input.bucket.length = 0
  if (input.currentGeneration() === input.generation) input.clear()
  return { problems }
}
