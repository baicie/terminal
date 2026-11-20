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
 * ## What it does not attempt
 *
 * It matches field *names*, not values. A secret in a field called `note` still prints;
 * catching that would need the caller to say which strings are secret, and this is the
 * last-resort formatter for errors whose shape is not known. Redaction at the source —
 * never putting the secret in the error — remains the real fix.
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
