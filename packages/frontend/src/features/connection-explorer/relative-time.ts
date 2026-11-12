/**
 * "3 minutes ago" from a timestamp the connection log actually recorded.
 *
 * Pure and locale-aware rather than a hand-rolled English string: it takes the
 * active locale and formats with `Intl.RelativeTimeFormat`, so Chinese, French and
 * English each get their own grammar for free. `numeric: 'auto'` lets English say
 * "yesterday" instead of "1 day ago".
 *
 * A clock skew that puts the timestamp slightly in the future is clamped to zero
 * rather than printing a negative duration.
 */

/** Above this age the exact minutes stop mattering. */
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatRelative(
  timestamp: number,
  locale = 'en',
  now = Date.now(),
): string {
  const deltaMs = now - timestamp
  if (!Number.isFinite(deltaMs) || deltaMs < MINUTE) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second')
  }
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (deltaMs < HOUR) {
    return formatter.format(-Math.round(deltaMs / MINUTE), 'minute')
  }
  if (deltaMs < DAY) {
    return formatter.format(-Math.round(deltaMs / HOUR), 'hour')
  }
  return formatter.format(-Math.round(deltaMs / DAY), 'day')
}
