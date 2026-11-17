/**
 * A 128-bit digest of a string, for diagnostics.
 *
 * Hand-written rather than pulled from a dependency: this does not authorise
 * anything, so it needs no cryptographic strength — but it does need to be wide
 * enough that two different texts are not plausibly equal, because a log line saying
 * "approval for 3f2a1b…" should identify one text.
 *
 * The authorisation path compares the strings in full; see `approval-book.ts`. Its
 * first version compared a 32-bit FNV-1a digest and argued that was sufficient
 * "because the text never leaves the process" — but the caller supplies the text on
 * both sides, so a fixed-width digest is a collision away from useless.
 *
 * Four 32-bit lanes over the input at two strides, mixed, giving 32 hex characters.
 * Not SHA, and not claimed to be.
 */

const PRIME = 0x01000193

function lane(text: string, seed: number, stride: number, offset: number): number {
  let hash = seed >>> 0
  for (let index = offset; index < text.length; index += stride) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, PRIME) >>> 0
  }
  // Fold the length in, so a truncation is not invisible.
  hash ^= text.length
  return Math.imul(hash, PRIME) >>> 0
}

export function createHash(text: string): string {
  return [
    lane(text, 0x811c9dc5, 1, 0),
    lane(text, 0x7f4a7c15, 1, 1),
    lane(text, 0x2545f491, 2, 0),
    lane(text, 0x9e3779b9, 2, 1),
  ]
    .map(value => value.toString(16).padStart(8, '0'))
    .join('')
}
