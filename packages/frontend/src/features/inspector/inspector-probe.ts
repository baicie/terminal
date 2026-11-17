/**
 * Running one Inspector probe over a real SSH session.
 *
 * ## Why this goes through `session_exec` and what that guarantees
 *
 * The design requires that a probe must not pollute the interactive shell or the
 * OUTPUT ACK stream. `session_exec` opens a **separate exec channel** on the same
 * connection, so the probe's bytes never enter the shell the user is typing into and
 * never touch the ack accounting for the terminal's own output.
 *
 * ## The three rules this enforces
 *
 * 1. **One probe per host.** A second refresh while one is running is refused rather
 *    than queued: two probes would double the load on a server the user may be
 *    debugging, and their results would interleave.
 * 2. **A host switch cancels the old probe, and the old result is dropped.** A result
 *    that lands after the user moved to another host describes the wrong machine;
 *    storing it against the new one is the failure the design names.
 * 3. **Closing the panel stops everything.** There is no timer, no interval and no
 *    background re-probe; the only thing that starts a probe is a user action.
 *
 * ## Why detection is a separate step
 *
 * The probe command differs per platform, and running the Linux command against a BSD
 * host produces errors that look like permission problems. `uname -s` is read first
 * (a command that exists everywhere), and an unknown platform produces a result with
 * `platform: 'unknown'` and no metrics rather than a guess.
 */

import type { ProbePlatform, ProbeResult } from './server-inspector'
import {
  PROBE_COMMANDS,
  PROBE_TTL_MS,
  emptyMetrics,
  parseProbeOutput,
  platformFor,
} from './server-inspector'

/** What one probe attempt produced, including why it produced nothing. */
export type InspectorOutcome =
  | { ok: true; result: ProbeResult }
  | {
      ok: false
      reason: 'unsupported-platform' | 'disconnected' | 'timeout' | 'denied' | 'failed'
      message: string
      /** Set when the platform was identified but the probe still produced nothing. */
      platform?: string
    }

/** The slice of the exec command this module needs, injected so it is testable. */
export interface InspectorExec {
  exec(
    sessionId: string,
    command: string,
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }>
}

export interface ProbeOptions {
  hostId: string
  sessionId: string
  /** Injected clock, so a test can assert `observedAt` without waiting. */
  now?: () => number
  /** How long the platform detection gets before the probe is abandoned. */
  detectTimeoutMs?: number
  /** How long the probe itself gets. */
  probeTimeoutMs?: number
}

const DEFAULT_DETECT_TIMEOUT_MS = 4_000
const DEFAULT_PROBE_TIMEOUT_MS = 8_000

/**
 * Recognise the failure shapes a probe actually produces.
 *
 * A missing `uname` is impossible on any Unix host, so a failure there means the
 * session is gone. A `Permission denied` from a probe command is the server refusing,
 * which the UI shows differently from a network drop.
 */
/** The failure branch only — a classification never succeeds. */
type ProbeFailure = Extract<InspectorOutcome, { ok: false }>

function classifyFailure(stderr: string, exitCode: number | null): ProbeFailure {
  const text = stderr.toLowerCase()
  if (text.includes('permission denied') || text.includes('operation not permitted')) {
    return {
      ok: false,
      reason: 'denied',
      message: 'The server denied the probe commands for this account.',
    }
  }
  if (exitCode === 127 || text.includes('command not found') || text.includes('not found')) {
    // Some tools are genuinely absent (`free` on a minimal image); that is a gap in
    // the data, not a failed probe, and the parser already reports it as nulls. Only a
    // *completely* empty result reaches here.
    return {
      ok: false,
      reason: 'failed',
      message: 'The probe commands are not available on this server.',
    }
  }
  return { ok: false, reason: 'failed', message: 'The probe did not produce output.' }
}

/**
 * Run one probe.
 *
 * Two exec calls: `uname -s` to pick the command set, then the probe itself. Two round
 * trips rather than one because running the wrong platform's commands is worse than an
 * extra hop — it produces errors that read like permission problems.
 */
export async function runInspectorProbe(
  exec: InspectorExec,
  options: ProbeOptions,
): Promise<InspectorOutcome> {
  const now = options.now ?? (() => Date.now())
  const detectTimeout = options.detectTimeoutMs ?? DEFAULT_DETECT_TIMEOUT_MS
  const probeTimeout = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS

  let detected: { stdout: string, stderr: string, exitCode: number | null }
  try {
    detected = await exec.exec(options.sessionId, 'uname -s', detectTimeout)
  } catch (error) {
    return {
      ok: false,
      reason: 'disconnected',
      message: error instanceof Error ? error.message : String(error),
    }
  }

  const platform: ProbePlatform | null = platformFor(detected.stdout.trim())
  if (platform === null) {
    const os = detected.stdout.trim()
    // An unknown OS is reported, not guessed at. Running Linux commands against a BSD
    // host produces errors that look like permission problems, and telling the user
    // the wrong thing is worse than telling them nothing.
    return {
      ok: false,
      reason: os ? 'unsupported-platform' : 'disconnected',
      message: os
        ? `The inspector has no probe for "${os}".`
        : 'The session did not answer.',
      platform: os || undefined,
    }
  }

  let probed: { stdout: string, stderr: string, exitCode: number | null }
  try {
    probed = await exec.exec(options.sessionId, PROBE_COMMANDS[platform], probeTimeout)
  } catch (error) {
    return {
      ok: false,
      reason: 'timeout',
      message: error instanceof Error ? error.message : String(error),
      platform,
    }
  }

  const { metrics, notes } = parseProbeOutput(probed.stdout, platform)
  const producedAnything = probed.stdout.trim().length > 0
  if (!producedAnything) {
    const classified = classifyFailure(probed.stderr, probed.exitCode)
    // `classifyFailure` always returns a failure branch, so the spread cannot produce
    // a success here; the explicit shape keeps the union honest for the compiler.
    return {
      ok: false,
      reason: classified.reason,
      message: classified.message,
      platform,
    }
  }

  return {
    ok: true,
    result: {
      hostId: options.hostId,
      sessionId: options.sessionId,
      observedAt: now(),
      ttlMs: PROBE_TTL_MS,
      // Which commands produced this, so the user can see the method rather than
      // trusting a number with no provenance.
      source: ['uname -s', PROBE_COMMANDS[platform]],
      // This version reads instantaneous counters; CPU utilisation would need two
      // samples over a window, so it stays null rather than being invented.
      samplingWindowMs: null,
      metrics: { ...emptyMetrics(), ...metrics },
      notes,
    },
  }
}
