const DIAGNOSTIC_PREFIX = '[parseHostIds]'
const MAX_SAMPLE_LENGTH = 80

function sampleOf(raw: string): string {
  return raw.length > MAX_SAMPLE_LENGTH ? `${raw.slice(0, MAX_SAMPLE_LENGTH)}…` : raw
}

function reportUnusable(raw: string, reason: string): void {
  console.warn(
    `${DIAGNOSTIC_PREFIX} ignoring unusable host_ids (${reason}); sample=${JSON.stringify(sampleOf(raw))}`,
  )
}

/**
 * Parse the `host_ids` column (JSON text) into a host id list.
 *
 * Rows written by older builds can hold malformed JSON or a non-array payload.
 * Those return an empty list instead of throwing inside render, so the UI
 * degrades to "0 hosts" (Run disabled) rather than a blank view. The degraded
 * result is never silent: every unusable payload emits one console.warn that
 * carries the failure reason and a sample of the original value.
 */
export function parseHostIds(raw: string | null | undefined): string[] {
  if (!raw) return []

  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as string[]

    reportUnusable(raw, `decoded to ${typeof parsed}, not an array`)
    return []
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    reportUnusable(raw, `invalid JSON: ${reason}`)
    return []
  }
}
