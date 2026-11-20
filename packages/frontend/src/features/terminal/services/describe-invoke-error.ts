/**
 * Turn whatever `invoke` rejected with into something a user can read.
 *
 * Extracted from `session.ts` for two reasons: the formatter is not session-specific
 * (the SFTP dock and the AI runner use it too), and the rules it accumulates are worth
 * more than the 300-line file limit allows when they sit inside a service.
 *
 * Prefers the shapes Rust actually sends — a string, an `Error`, or a tagged object
 * such as `{ kind, message }` — and falls back to a JSON rendering rather than
 * `"[object Object]"`, which is indistinguishable from "no reason given".
 *
 * ## Every branch is scrubbed, not just the fallback
 *
 * Field-name redaction in the JSON fallback was the first fix and it was not enough:
 * a secret inside a *string* is not a field. `new Error('bad passphrase: hunter2')`,
 * `'token sk-live-… rejected'` and `{ message: 'auth failed for password hunter2' }`
 * all returned the secret verbatim, because those branches return `error.message` or
 * `error` unchanged.
 *
 * Measured before this change: 6 of 7 cases carrying a password, passphrase, token or
 * private key printed it in full. So `scrubSecrets` runs on the value every branch is
 * about to return — the only place that covers all of them at once.
 *
 * ## What this still cannot do
 *
 * It recognises *shapes* (PEM blocks, `key=value`, provider token prefixes), not the
 * concept of a secret. An all-lowercase password in prose, or one sitting in a field
 * whose name says nothing and whose text carries no keyword, survives — both are
 * asserted as known limits in `session-error-message.test.ts` rather than left implied.
 *
 * The real fix is at the source: Rust sends a stable `type` (`SessionErrorDto`) so a
 * message can be rendered without ever containing the secret. This is the last line,
 * not the first.
 */
import { redactSecrets, scrubSecrets } from './redact-secrets'

export function describeInvokeError(error: unknown): string {
  if (typeof error === 'string') return scrubSecrets(error)
  if (error instanceof Error) return scrubSecrets(error.message)
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>
    for (const key of ['message', 'error', 'reason', 'detail']) {
      const value = record[key]
      if (typeof value === 'string' && value.length > 0) return scrubSecrets(value)
    }
    try {
      const json = JSON.stringify(redactSecrets(error))
      // Scrubbed after serialising, because a secret may sit inside a non-secret field.
      if (json && json !== '{}') return scrubSecrets(json)
    } catch {
      // A circular or otherwise unserialisable error: fall through.
    }
    // An object with no usable field at all. Naming the situation beats `[object
    // Object]`, which reads as if the failure had no cause.
    return 'the connection failed without reporting a reason'
  }
  return scrubSecrets(String(error))
}
