/**
 * Removing credentials from an error before it is shown.
 *
 * ## Why this exists
 *
 * `describeInvokeError` falls back to `JSON.stringify(error)` so a rejection without a
 * `message` still says something rather than `[object Object]`. A Rust command that
 * serialises its argument struct into the error would then put the password or private
 * key into a toast, a log line, and the GUI E2E evidence file.
 *
 * Measured: `{ kind: 'AuthFailed', password: '…' }` printed the password verbatim, and
 * `{ kind: 'KeyRejected', privateKey: '-----BEGIN …' }` printed the whole key.
 *
 * ## Two layers, because the first one is not enough
 *
 * `redactSecrets` (layer 1) matches **field names**. It works when the secret sits in
 * a field called `password`, and does nothing when it sits inside prose:
 *
 *   { message: 'auth failed for password hunter2' }   ← field is `message`
 *   new Error('bad passphrase: hunter2')              ← no fields at all
 *   'token sk-live-… rejected'                        ← a bare string
 *
 * The second and third are the shapes `describeInvokeError` actually returns, so
 * field-name redaction alone left every one of them printing the secret. Layer 2
 * (`scrubSecrets`) matches **values**: known key shapes, `key=value` pairs, and the
 * `BEGIN … PRIVATE KEY` block. It cannot be exhaustive — nothing can prove a given
 * string is not a secret — but it removes the shapes this product can produce.
 *
 * **Redaction at the source remains the real fix.** The Rust side already sends a
 * stable `type` alongside `message` (`SessionErrorDto`), which is the right basis for
 * a message that never contains the secret in the first place. This file is the last
 * line, not the first.
 */

/** Field names whose values must never reach a message, at any depth. */
const SECRET_FIELDS = [
  'password',
  'passphrase',
  'privatekey',
  'secret',
  'token',
  'apikey',
  'credential',
  'authorization',
]

function isSecretField(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, '')
  return SECRET_FIELDS.some(field => normalized.includes(field))
}

/**
 * A copy of `value` with secret-looking fields replaced.
 *
 * Depth-limited rather than unbounded: an error nested deeper than a few levels is not
 * a shape this codebase produces, and recursing forever on a hostile object is worse
 * than truncating.
 */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[nested]'
  if (Array.isArray(value)) return value.map(item => redactSecrets(item, depth + 1))
  if (typeof value !== 'object' || value === null) return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretField(key) ? '[redacted]' : redactSecrets(entry, depth + 1)
  }
  return out
}

/** What replaces a scrubbed value. Deliberately not empty, so the reader sees a gap. */
const MASK = '[redacted]'

/*
 * ## The value patterns
 *
 * Each one is a shape that appears in real error text from this product or from a
 * library it calls. They are ordered most-specific first so a private key is consumed
 * whole rather than being half-matched by a later rule.
 */
const VALUE_PATTERNS = [
  /*
   * A PEM/OpenSSH private key, whole.
   *
   * Not line-anchored and not `s`-flagged in the naive way: error text may have the
   * key embedded mid-sentence with escaped newlines (JSON transport), so `[\s\S]` is
   * what actually spans it. Non-greedy, so two keys in one message are two matches.
   */
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  // A `key=value` / `key: value` pair whose key names a secret.
  /\b(password|passphrase|secret|token|api[_-]?key|authorization)\s*[=:]\s*\S+/gi,
  /*
   * The same key naming a secret in prose: `auth failed for password hunter2`.
   *
   * This is the shape the original leak actually took, so it is not an edge case — it
   * is the main one.
   *
   * ## Why the token is inspected instead of skipped by a word list
   *
   * Two earlier attempts failed in opposite directions, and both are worth recording
   * because the second looked like a fix:
   *
   *   1. Redact the word after the keyword unconditionally — `Jump host password
   *      required` became `Jump host password [redacted]`, and `Password
   *      authentication is disabled` became `[redacted] is disabled`. Both are real
   *      `SessionError` strings, and both lost the part that says what happened.
   *   2. Skip redaction when the next word is a connective (`is`, `required`, …) —
   *      that fixed the messages and let `passphrase hunter2 is wrong` through, since
   *      the *secret* was followed by `is`.
   *
   * A word list cannot tell "the word after the keyword describes it" from "the word
   * after the secret is a connective". What can is the token itself: an English word
   * in a message is lowercase letters; a secret carries a digit, a symbol, or mixed
   * case, because that is what makes it a secret. `secretLooksLikeValue` encodes
   * exactly that and nothing more.
   *
   * ## The hole this leaves, stated plainly
   *
   * An all-lowercase-letters password in prose (`password springfield`) is not
   * redacted, because it is indistinguishable from the English word in `password
   * required` by this rule. Closing it needs the source of the message, not a regex —
   * which is why Rust sends a stable `type` alongside `message`.
   */
  /\b(password|passphrase|secret|token|api[_-]?key)\s+\S+/gi,
  // Provider-shaped API tokens. Long enough that a false positive is implausible.
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
]

/**
 * Strip secret *values* out of free text.
 *
 * Applied to every string `describeInvokeError` is about to return, which is the only
 * place that can cover the `string`, `Error.message` and `message`-field branches.
 * The trailing match is re-checked once so an overlap (a key inside a `key=…` pair)
 * cannot leave a fragment behind.
 */
export function scrubSecrets(text: string): string {
  if (text.length === 0) return text
  let out = text
  for (const pattern of VALUE_PATTERNS) {
    // `replace` with a global regex resets `lastIndex` itself, so the shared constant
    // is safe to reuse across calls.
    out = out.replace(pattern, match => {
      /*
       * The prose rule matched `password hunter2`. Whether the second word is a value
       * or just the next word of a sentence is the question the comment above
       * describes — decided here, per match, by what the token looks like.
       */
      const prose = /^([A-Za-z_-]+)\s+(\S+)$/.exec(match)
      if (prose && !secretLooksLikeValue(prose[2])) return match
      // Keep the field name so the reason stays readable: `password=[redacted]`.
      return /^[A-Za-z_]+\s*[=:]/.test(match) ? `${match.split(/[=:]/)[0]}=${MASK}` : MASK
    })
  }
  return out
}

/**
 * Does this token look like a secret rather than a word?
 *
 * The distinction the prose rule needs, and the only one available without knowing
 * which strings are secret. A password carries a digit, a symbol or mixed case,
 * because a value the user had to choose is rarely a plain lowercase English word; the
 * word in `password required` is exactly that.
 *
 * Errs toward "not a secret" on purpose: a false positive turns a readable message
 * into `[redacted]`, which sends the user to the logs with nothing, while a false
 * negative leaves the last-line formatter doing what a last line can.
 */
function secretLooksLikeValue(token: string): boolean {
  // Strip trailing punctuation a sentence would put there (`hunter2.`, `hunter2,`).
  const bare = token.replace(/[.,;:!?)\]}'"]+$/, '')
  if (bare.length === 0) return false
  if (/\d/.test(bare)) return true
  if (/[^\w.-]/.test(bare)) return true
  // Mixed case inside a word: `SuperSecret`, `pAssword`.
  if (/[a-z]/.test(bare) && /[A-Z]/.test(bare)) return true
  return false
}
