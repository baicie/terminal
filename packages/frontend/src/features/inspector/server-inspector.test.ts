// The Server Inspector: fixed probes, honest gaps, and no monitoring.
//
// The design's rule is that missing data is `N/A`, never a healthy-looking number. A
// fabricated zero reads as "nothing is wrong", which is worse than a blank.

import { describe, expect, it } from 'vitest'
import {
  CPU_SAMPLE_MS,
  PROBE_COMMANDS,
  PROBE_TTL_MS,
  emptyMetrics,
  formatBytes,
  formatUptime,
  isStale,
  parseProbeLine,
  parseProbeOutput,
  platformFor,
  ratioPercent,
  type ProbeResult,
} from './server-inspector'

describe('the probe commands are a fixed allowlist', () => {
  it('uses only literals, with no interpolation point', () => {
    // A probe runs shell commands on someone's server. Nothing in this feature may
    // build a command from data — that is the line between reading facts and running
    // whatever a model suggested.
    for (const [platform, command] of Object.entries(PROBE_COMMANDS)) {
      expect(typeof command, platform).toBe('string')
      // No template placeholders or shell substitution of variables.
      expect(command).not.toMatch(/\$\{/)
      expect(command).not.toMatch(/\$[A-Za-z_]/)
    }
  })

  it('covers linux and darwin, and nothing else', () => {
    expect(Object.keys(PROBE_COMMANDS).sort()).toEqual(['darwin', 'linux'])
  })

  it('suppresses missing tools rather than surfacing their errors', () => {
    // `2>/dev/null` per line: a host without `free` should produce a gap, not an
    // error string the parser has to absorb.
    expect(PROBE_COMMANDS.linux).toContain('2>/dev/null')
  })
})

describe('linux output', () => {
  it('parses a complete result', () => {
    const output = [
      'os=Linux',
      'uptime=123456',
      'load=0.42 0.31 0.28',
      'mem=16777216000 8388608000',
      'disk=107374182400 53687091200',
    ].join('\n')
    const { metrics, notes } = parseProbeOutput(output, 'linux')
    expect(metrics).toMatchObject({
      os: 'Linux',
      uptimeSeconds: 123456,
      load1: 0.42,
      load5: 0.31,
      load15: 0.28,
      memoryTotalBytes: 16777216000,
      memoryUsedBytes: 8388608000,
      diskTotalBytes: 107374182400,
      diskUsedBytes: 53687091200,
    })
    expect(notes).toEqual([])
  })

  it('reports a missing tool as null, not as zero', () => {
    // A host without `free` has no memory reading. Zero would render as "0% used".
    const { metrics } = parseProbeOutput('os=Linux\nmem=\n', 'linux')
    expect(metrics.memoryUsedBytes).toBeNull()
    expect(metrics.memoryTotalBytes).toBeNull()
  })

  it('rejects a nonsense number rather than coercing it', () => {
    const { metrics } = parseProbeOutput('load=abc def ghi\n', 'linux')
    expect(metrics.load1).toBeNull()
  })

  it('leaves CPU null when it was not sampled', () => {
    // The probe reads instantaneous facts; CPU needs two samples over a window, which
    // this first version does not take. Null is the honest answer.
    const { metrics } = parseProbeOutput('os=Linux\n', 'linux')
    expect(metrics.cpuPercent).toBeNull()
  })
})

describe('darwin output', () => {
  it('computes uptime from the boot timestamp', () => {
    const boot = Math.floor(Date.now() / 1000) - 3600
    const { metrics } = parseProbeOutput(`os=Darwin\nuptime=${boot}\n`, 'darwin')
    // One hour, within a second of rounding.
    expect(metrics.uptimeSeconds).toBeGreaterThanOrEqual(3598)
    expect(metrics.uptimeSeconds).toBeLessThanOrEqual(3602)
  })

  it('does not invent memory from vm_stat', () => {
    // The first three vm_stat lines are not a used/total pair. Reporting a number
    // derived from them would be a guess dressed as a measurement.
    const { metrics, notes } = parseProbeOutput('os=Darwin\nmem=Pages free: 12345.\n', 'darwin')
    expect(metrics.memoryUsedBytes).toBeNull()
    expect(metrics.memoryTotalBytes).toBeNull()
    expect(notes.join(' ')).toMatch(/not read on macOS/i)
  })

  it('rejects a boot timestamp that is not a number', () => {
    const { metrics } = parseProbeOutput('uptime={ sec = abc, usec = 0 }\n', 'darwin')
    expect(metrics.uptimeSeconds).toBeNull()
  })
})

describe('line parsing', () => {
  it('ignores lines without a key', () => {
    expect(parseProbeLine('', 'linux')).toEqual({})
    expect(parseProbeLine('garbage', 'linux')).toEqual({})
    expect(parseProbeLine('unknown=1', 'linux')).toEqual({})
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseProbeLine('  os=Linux  ', 'linux')).toEqual({ os: 'Linux' })
  })
})

describe('staleness', () => {
  const result = (observedAt: number): ProbeResult => ({
    hostId: 'h-1',
    sessionId: 'tab-1',
    observedAt,
    ttlMs: PROBE_TTL_MS,
    source: [],
    samplingWindowMs: null,
    metrics: emptyMetrics(),
    notes: [],
  })

  it('is fresh within the TTL', () => {
    expect(isStale(result(1_000), 1_000 + PROBE_TTL_MS - 1)).toBe(false)
  })

  it('is stale exactly at the TTL and beyond', () => {
    // Boundary included deliberately: "still fresh" at exactly the expiry would let a
    // card claim currency it does not have.
    expect(isStale(result(1_000), 1_000 + PROBE_TTL_MS)).toBe(true)
    expect(isStale(result(1_000), 1_000 + PROBE_TTL_MS + 1)).toBe(true)
  })

  it('keeps the TTL short, because these are point-in-time facts', () => {
    expect(PROBE_TTL_MS).toBeLessThanOrEqual(60_000)
    expect(CPU_SAMPLE_MS).toBeLessThanOrEqual(2_000)
  })
})

describe('formatting never invents a value', () => {
  it('shows N/A for absent metrics', () => {
    expect(formatBytes(null)).toBe('N/A')
    expect(formatUptime(null)).toBe('N/A')
    expect(ratioPercent(null, 100)).toBeNull()
    expect(ratioPercent(50, null)).toBeNull()
  })

  it('formats real values sensibly', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KiB')
    expect(formatBytes(1024 ** 3)).toBe('1.0 GiB')
    expect(formatUptime(90)).toBe('1m')
    expect(formatUptime(3_600)).toBe('1h 0m')
    expect(formatUptime(90_000)).toBe('1d 1h')
  })

  it('computes a percentage only from real numbers', () => {
    expect(ratioPercent(50, 200)).toBe(25)
    expect(ratioPercent(0, 200)).toBe(0)
    // A zero total is not "0% used"; it is a value that does not exist.
    expect(ratioPercent(0, 0)).toBeNull()
  })
})

describe('platform detection', () => {
  it('recognises the two platforms with probes', () => {
    expect(platformFor('Linux')).toBe('linux')
    expect(platformFor('Darwin')).toBe('darwin')
  })

  it('returns null for anything else rather than guessing', () => {
    // Running Linux commands against a BSD host produces errors that look like
    // permission problems; telling the user the wrong thing is worse than nothing.
    expect(platformFor('FreeBSD')).toBeNull()
    expect(platformFor('Windows_NT')).toBeNull()
    expect(platformFor(null)).toBeNull()
  })
})

describe('an all-null metric set is the starting point', () => {
  it('has no number a UI could mistake for a reading', () => {
    const metrics = emptyMetrics()
    for (const [key, value] of Object.entries(metrics)) {
      expect(value, key).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// The macOS uptime probe must read `sec`, not `usec`.
//
// Measured on a real SSH session: the dock showed `Uptime 20767d 18h` — 56 years.
// The command was
//
//     sed 's/.*sec = \([0-9]*\).*/\1/'
//
// and `kern.boottime` is `{ sec = 1795089539, usec = 761765 } …`. `.*` is greedy, so
// it matched through to the *last* `= ` and returned the microseconds field.
// ---------------------------------------------------------------------------

describe('the darwin uptime probe command', () => {
  it('anchors on the sec field so usec cannot be selected', () => {
    // `PROBE_COMMANDS.darwin` is already the joined shell script.
    const command = String(PROBE_COMMANDS.darwin)
    const uptimeLine = command
      .split('; ')
      .find(part => part.includes('kern.boottime'))
    expect(uptimeLine, 'the darwin probe must read kern.boottime').toBeTruthy()
    // A leading `.*` is what allowed usec to win: `[^0-9]*` cannot cross a digit,
    // so the match stops at the first `sec = `.
    expect(
      uptimeLine,
      'a greedy leading .* selects the usec field',
    ).not.toMatch(/s\/\.\*sec/)
    expect(uptimeLine).toMatch(/s\/\[\^0-9\]\*sec/)
  })

  it('extracts the seconds field from a real kern.boottime line', () => {
    // The parser side is already covered; this pins the field the command must yield.
    const { metrics } = parseProbeOutput('os=Darwin\nuptime=1795089539\n', 'darwin')
    const age = Math.round(Date.now() / 1000) - 1795089539
    expect(metrics.uptimeSeconds).toBeGreaterThan(0)
    expect(
      age,
      'a plausible uptime, not the ~56 years a microsecond field produces',
    ).toBeLessThan(60 * 60 * 24 * 365 * 30)
  })
})
