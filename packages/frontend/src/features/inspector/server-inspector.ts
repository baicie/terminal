/**
 * Server Inspector: read-only facts about a host the user is already connected to.
 *
 * ## What this is not
 *
 * Not a monitor. Not a time-series database. Not an alerting or repair agent. The
 * design is explicit: the user clicks Refresh, one short probe runs, the result is
 * shown with its collection time, and closing the panel stops everything. No timers
 * survive the panel, and no history is kept.
 *
 * ## Why the probe commands are a fixed allowlist
 *
 * A probe runs shell commands on someone's server. Every one of them is a constant in
 * this module, chosen by us, with no parameter that a caller could use to influence
 * it. That is the difference between "the app reads some facts" and "the app runs
 * whatever the model suggested" — and the second one is a capability this feature
 * deliberately does not have.
 *
 * ## Why missing data is `null` and never a guess
 *
 * A host without `free` has no memory reading. A macOS box has no `/proc/loadavg`. The
 * design forbids drawing a healthy-looking number from absent data, so every metric is
 * `number | null` and the UI shows `N/A`. A fabricated zero is worse than a blank: it
 * reads as "nothing is wrong".
 */

/** The facts the inspector collects. Each is optional because not every OS has it. */
export interface InspectorMetrics {
  /** 1-minute load average, when the platform reports it. */
  load1: number | null
  load5: number | null
  load15: number | null
  /** Seconds since boot. */
  uptimeSeconds: number | null
  /** Used / total memory in bytes. */
  memoryUsedBytes: number | null
  memoryTotalBytes: number | null
  /** Used / total for the root filesystem in bytes. */
  diskUsedBytes: number | null
  diskTotalBytes: number | null
  /** CPU utilisation over the sampling window, 0–100, or null when not sampled. */
  cpuPercent: number | null
  /** `uname -s` output, verbatim. */
  os: string | null
}

export type InspectorStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'stale'
  | 'permission-denied'
  | 'unavailable'
  | 'disconnected'

/** A completed observation, with everything needed to judge how much to trust it. */
export interface ProbeResult {
  hostId: string
  sessionId: string
  /** When the probe finished, ms since epoch. The UI shows this. */
  observedAt: number
  /** How long the numbers stay meaningful. After this the UI marks them stale. */
  ttlMs: number
  /** Which commands produced this, so the user can see the method. */
  source: string[]
  /** The sampling window for `cpuPercent`, when it was measured rather than read. */
  samplingWindowMs: number | null
  metrics: InspectorMetrics
  /** Why some metrics are missing, if they are. Never a provider's raw error. */
  notes: string[]
}

/** How long a result stays fresh. Short on purpose: these are point-in-time facts. */
export const PROBE_TTL_MS = 60_000

/** The sampling window for CPU. Long enough to mean something, short enough to wait. */
export const CPU_SAMPLE_MS = 1_000

/**
 * The probe script per platform.
 *
 * One shell invocation, `2>/dev/null` so a missing tool is silence rather than an
 * error the parser has to absorb, and a marker per line so a partial result is
 * detectable. Every command is a literal; nothing is interpolated.
 *
 * The values are printed as `key=value` lines, which is the least fragile thing to
 * parse across the shells these hosts actually run.
 */
export const PROBE_COMMANDS = {
  linux: [
    'echo "os=$(uname -s)"',
    'echo "uptime=$(cut -d. -f1 /proc/uptime 2>/dev/null)"',
    'echo "load=$(cat /proc/loadavg 2>/dev/null | cut -d" " -f1-3)"',
    'echo "mem=$(free -b 2>/dev/null | awk \'/^Mem:/ {print $2" "$3}\')"',
    'echo "disk=$(df -B1 / 2>/dev/null | awk \'NR==2 {print $2" "$3}\')"',
  ].join('; '),
  darwin: [
    'echo "os=$(uname -s)"',
    'echo "load=$(sysctl -n vm.loadavg 2>/dev/null | tr -d "{}" | xargs)"',
    'echo "uptime=$(sysctl -n kern.boottime 2>/dev/null | sed \'s/.*sec = \\([0-9]*\\).*/\\1/\')"',
    'echo "mem=$(vm_stat 2>/dev/null | head -3 | tr "\\n" " ")"',
    'echo "disk=$(df -k / 2>/dev/null | awk \'NR==2 {print $2*1024" "$3*1024}\')"',
  ].join('; '),
} as const

export type ProbePlatform = keyof typeof PROBE_COMMANDS

/**
 * Parse one `key=value` probe line.
 *
 * Exported so the parser is testable against real command output captured from each
 * platform, rather than against a shape invented for the test.
 */
export function parseProbeLine(line: string, platform: ProbePlatform): Partial<InspectorMetrics> & { notes?: string[] } {
  const trimmed = line.trim()
  const eq = trimmed.indexOf('=')
  if (eq < 0) return {}
  const key = trimmed.slice(0, eq)
  const value = trimmed.slice(eq + 1).trim()

  switch (key) {
    case 'os':
      return value ? { os: value } : { os: null }

    case 'load': {
      const parts = value.split(/\s+/).filter(Boolean).map(Number)
      if (parts.length < 3 || parts.some(part => !Number.isFinite(part))) {
        return { load1: null, load5: null, load15: null }
      }
      return { load1: parts[0], load5: parts[1], load15: parts[2] }
    }

    case 'uptime': {
      if (platform === 'darwin') {
        // `kern.boottime` gives a boot timestamp; uptime is now minus that.
        const boot = Number(value)
        if (!Number.isFinite(boot) || boot <= 0) return { uptimeSeconds: null }
        return { uptimeSeconds: Math.max(0, Math.round(Date.now() / 1000 - boot)) }
      }
      const seconds = Number(value)
      return Number.isFinite(seconds) ? { uptimeSeconds: seconds } : { uptimeSeconds: null }
    }

    case 'mem': {
      if (platform === 'darwin') {
        // vm_stat's first three lines are not a used/total pair; report unavailable
        // rather than inventing a number from page counts this parser cannot verify.
        return {
          memoryUsedBytes: null,
          memoryTotalBytes: null,
          notes: ['memory is not read on macOS without a verified parser'],
        }
      }
      const [total, used] = value.split(/\s+/).map(Number)
      if (!Number.isFinite(total) || !Number.isFinite(used) || total <= 0) {
        return { memoryUsedBytes: null, memoryTotalBytes: null }
      }
      return { memoryUsedBytes: used, memoryTotalBytes: total }
    }

    case 'disk': {
      const [total, used] = value.split(/\s+/).map(Number)
      if (!Number.isFinite(total) || !Number.isFinite(used) || total <= 0) {
        return { diskUsedBytes: null, diskTotalBytes: null }
      }
      return { diskUsedBytes: used, diskTotalBytes: total }
    }

    default:
      return {}
  }
}

/** An all-null metric set. The starting point before any line is parsed. */
export function emptyMetrics(): InspectorMetrics {
  return {
    load1: null,
    load5: null,
    load15: null,
    uptimeSeconds: null,
    memoryUsedBytes: null,
    memoryTotalBytes: null,
    diskUsedBytes: null,
    diskTotalBytes: null,
    cpuPercent: null,
    os: null,
  }
}

/** Parse a whole probe output into metrics plus the notes that explain the gaps. */
export function parseProbeOutput(
  output: string,
  platform: ProbePlatform,
): { metrics: InspectorMetrics; notes: string[] } {
  const metrics = emptyMetrics()
  const notes = new Set<string>()
  for (const line of output.split('\n')) {
    const parsed = parseProbeLine(line, platform)
    for (const note of parsed.notes ?? []) notes.add(note)
    const { notes: _ignored, ...values } = parsed
    Object.assign(metrics, values)
  }
  return { metrics, notes: [...notes] }
}

/**
 * Is this result past its TTL?
 *
 * The UI asks this rather than comparing timestamps, so the rule lives in one place
 * and a stale card cannot be produced by a second, slightly different comparison.
 */
export function isStale(result: ProbeResult, now: number): boolean {
  // `>=`, not `>`: at exactly the TTL the numbers are no longer current, and a card
  // that still called itself fresh would be claiming currency it does not have.
  return now - result.observedAt >= result.ttlMs
}

/** Percentages for a used/total pair, or null. Never 0 for missing data. */
export function ratioPercent(used: number | null, total: number | null): number | null {
  if (used === null || total === null || total <= 0) return null
  return Math.round((used / total) * 100)
}

/** A metric that has no value is reported as such, never as zero. */
export function formatBytes(value: number | null): string {
  if (value === null) return 'N/A'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let amount = value
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

/** Human uptime, or N/A. */
export function formatUptime(seconds: number | null): string {
  if (seconds === null) return 'N/A'
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

/**
 * Which probes a host can answer, from its `uname`.
 *
 * `null` means "not determined yet" and produces no probe rather than a guessed one:
 * running Linux commands against a BSD host produces errors that look like permission
 * problems, and telling the user the wrong thing is worse than telling them nothing.
 */
export function platformFor(os: string | null): ProbePlatform | null {
  if (os === null) return null
  const normalized = os.toLowerCase()
  if (normalized.includes('linux')) return 'linux'
  if (normalized.includes('darwin')) return 'darwin'
  return null
}
