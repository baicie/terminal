/**
 * A content digest for approval binding.
 *
 * Used for one job: proving that the text a user approved is the text about to be
 * sent. It is not a security boundary against an attacker who controls both sides —
 * nothing short of not trusting either side would be — it is a guard against the
 * text drifting between the preview and the request, which is the realistic failure.
 *
 * Implemented over four 32-bit lanes rather than pulled from a dependency: this
 * repository already vendors no hashing library, and a 128-bit digest is wide enough
 * that an accidental collision is not a concern. Not SHA-256, and the name says so.
 */

const PRIME = 0x01000193

function lane(text: string, seed: number, stride: number, offset: number): number {
  let hash = seed >>> 0
  for (let index = offset; index < text.length; index += stride) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, PRIME) >>> 0
  }
  hash ^= text.length
  return Math.imul(hash, PRIME) >>> 0
}

/** A 128-bit hex digest of the text. */
export function createHashOf(text: string): string {
  return [
    lane(text, 0x811c9dc5, 1, 0),
    lane(text, 0x7f4a7c15, 1, 1),
    lane(text, 0x2545f491, 2, 0),
    lane(text, 0x9e3779b9, 2, 1),
  ]
    .map(value => value.toString(16).padStart(8, '0'))
    .join('')
}
