// Running one Inspector probe, without a server.
//
// The exec layer is injected, so every rule the design names is testable here: the
// platform is detected before the probe, an unknown platform is reported rather than
// guessed, and a failure is classified instead of becoming an empty metric set.

import { describe, expect, it, vi } from 'vitest'
import { runInspectorProbe, type InspectorExec } from './inspector-probe'
import { PROBE_COMMANDS, parseProbeOutput } from './server-inspector'

/** An exec double that answers per command. */
function exec(answer: (command: string) => { stdout: string, stderr?: string, exitCode?: number | null }): InspectorExec {
  return {
    exec: vi.fn(async (_sessionId: string, command: string) => {
      const result = answer(command)
      return {
        stdout: result.stdout,
        stderr: result.stderr ?? '',
        exitCode: result.exitCode === undefined ? 0 : result.exitCode,
      }
    }),
  }
}

const options = { hostId: 'h-1', sessionId: 'tab-1', now: () => 1_000_000 }

describe('platform detection comes first', () => {
  it('runs the Linux probe after seeing Linux', async () => {
    const subject = exec(command =>
      command === 'uname -s'
        ? { stdout: 'Linux\n' }
        : {
            stdout: [
              'os=Linux',
              'uptime=1000',
              'load=0.1 0.2 0.3',
              'mem=1000 250',
              'disk=2000 500',
            ].join('\n'),
          },
    )
    const outcome = await runInspectorProbe(subject, options)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.metrics).toMatchObject({
      uptimeSeconds: 1000,
      load1: 0.1,
      memoryTotalBytes: 1000,
      memoryUsedBytes: 250,
      diskTotalBytes: 2000,
      diskUsedBytes: 500,
    })
    // Two exec calls: detection, then probe.
    expect(subject.exec).toHaveBeenCalledTimes(2)
  })

  it('runs the Darwin probe after seeing Darwin', async () => {
    const subject = exec(command =>
      command === 'uname -s' ? { stdout: 'Darwin\n' } : { stdout: 'os=Darwin\nload=1.0 2.0 3.0\n' },
    )
    const outcome = await runInspectorProbe(subject, options)
    expect(outcome.ok && outcome.result.metrics.load1).toBe(1.0)
    expect(subject.exec).toHaveBeenLastCalledWith('tab-1', PROBE_COMMANDS.darwin, expect.any(Number))
  })

  it('refuses an unknown platform instead of guessing', async () => {
    // Running Linux commands against a BSD host produces errors that read like
    // permission problems.
    const subject = exec(command => (command === 'uname -s' ? { stdout: 'FreeBSD\n' } : { stdout: '' }))
    const outcome = await runInspectorProbe(subject, options)
    expect(outcome).toMatchObject({ ok: false, reason: 'unsupported-platform', platform: 'FreeBSD' })
    expect(subject.exec).toHaveBeenCalledTimes(1)
  })

  it('reports a session that does not answer detection as disconnected', async () => {
    const subject = exec(() => ({ stdout: '' }))
    const outcome = await runInspectorProbe(subject, options)
    expect(outcome).toMatchObject({ ok: false, reason: 'disconnected' })
  })

  it('reports a throwing exec as disconnected', async () => {
    const subject: InspectorExec = {
      exec: vi.fn(async () => {
        throw new Error('session is closed')
      }),
    }
    const outcome = await runInspectorProbe(subject, options)
    expect(outcome).toMatchObject({ ok: false, reason: 'disconnected' })
    expect(outcome.ok === false && outcome.message).toMatch(/closed/)
  })
})

describe('failures are classified, not blank', () => {
  it('reports a permission denial as denied', async () => {
    const subject = exec(command =>
      command === 'uname -s'
        ? { stdout: 'Linux' }
        : { stdout: '', stderr: 'Permission denied', exitCode: 1 },
    )
    const outcome = await runInspectorProbe(subject, options)
    expect(outcome).toMatchObject({ ok: false, reason: 'denied', platform: 'linux' })
  })

  it('reports missing tools as failed rather than as zeros', async () => {
    const subject = exec(command =>
      command === 'uname -s'
        ? { stdout: 'Linux' }
        : { stdout: '', stderr: 'sh: free: not found', exitCode: 127 },
    )
    const outcome = await runInspectorProbe(subject, options)
    expect(outcome).toMatchObject({ ok: false, reason: 'failed' })
    // Nothing was produced, so no metric set is offered at all.
    expect(outcome.ok).toBe(false)
  })

  it('reports a throwing probe as a timeout', async () => {
    const subject: InspectorExec = {
      exec: vi.fn(async (_sessionId: string, command: string) => {
        if (command === 'uname -s') return { stdout: 'Linux', stderr: '', exitCode: 0 }
        throw new Error('deadline exceeded')
      }),
    }
    const outcome = await runInspectorProbe(subject, options)
    expect(outcome).toMatchObject({ ok: false, reason: 'timeout', platform: 'linux' })
  })
})

describe('a partial result is still a result', () => {
  it('returns what it got and records the gaps', async () => {
    // A host without `free` still has uptime and load. Reporting the whole probe as
    // failed because one tool is missing would throw away good data.
    const subject = exec(command =>
      command === 'uname -s'
        ? { stdout: 'Linux' }
        : { stdout: 'os=Linux\nuptime=500\nload=0.5 0.4 0.3\nmem=\n' },
    )
    const outcome = await runInspectorProbe(subject, options)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.metrics.uptimeSeconds).toBe(500)
    expect(outcome.result.metrics.memoryUsedBytes).toBeNull()
  })

  it('records the time it was observed', async () => {
    const subject = exec(command => (command === 'uname -s' ? { stdout: 'Linux' } : { stdout: 'os=Linux\n' }))
    const outcome = await runInspectorProbe(subject, { ...options, now: () => 42_000 })
    expect(outcome.ok && outcome.result.observedAt).toBe(42_000)
  })

  it('records which commands produced it', async () => {
    // A number with no provenance is a number the user cannot judge.
    const subject = exec(command => (command === 'uname -s' ? { stdout: 'Linux' } : { stdout: 'os=Linux\n' }))
    const outcome = await runInspectorProbe(subject, options)
    expect(outcome.ok && outcome.result.source).toEqual(['uname -s', PROBE_COMMANDS.linux])
  })

  it('never claims a CPU reading it did not sample', async () => {
    const subject = exec(command => (command === 'uname -s' ? { stdout: 'Linux' } : { stdout: 'os=Linux\n' }))
    const outcome = await runInspectorProbe(subject, options)
    expect(outcome.ok && outcome.result.metrics.cpuPercent).toBeNull()
    expect(outcome.ok && outcome.result.samplingWindowMs).toBeNull()
  })
})

describe('the probe is one command string with no interpolation', () => {
  it('passes a constant, never a value derived from input', async () => {
    const seen: string[] = []
    const subject: InspectorExec = {
      exec: vi.fn(async (_sessionId: string, command: string) => {
        seen.push(command)
        return command === 'uname -s'
          ? { stdout: 'Linux', stderr: '', exitCode: 0 }
          : { stdout: 'os=Linux\n', stderr: '', exitCode: 0 }
      }),
    }
    await runInspectorProbe(subject, { ...options, hostId: 'host-with-quotes\'; rm -rf /' })
    expect(seen).toEqual(['uname -s', PROBE_COMMANDS.linux])
  })
})

// ---------------------------------------------------------------------------
// Platforms the inspector does not support must say so, not guess.
//
// The task asked for "Windows uptime semantics". The product answer is that Windows
// remote hosts are **not** probed: `platformFor` recognises Linux and Darwin only, and
// anything else is reported as `unsupported-platform`.
//
// That is the right shape — running Linux commands against a Windows host produces
// errors that read like permission problems — but it means the honest answer to
// "what is uptime on Windows?" is "there is none, and the panel says so".
// ---------------------------------------------------------------------------

describe('an unsupported remote platform', () => {
  it('reports Windows as unsupported rather than probing it', async () => {
    const subject = exec(command => {
      if (command === 'uname -s') return { stdout: 'MINGW64_NT-10.0-19045\n' }
      // Reaching here would mean a command set was guessed for Windows.
      return { stdout: '', stderr: 'must not run', exitCode: 1 }
    })
    const outcome = await runInspectorProbe(subject, options)

    expect(outcome).toMatchObject({
      ok: false,
      reason: 'unsupported-platform',
      platform: 'MINGW64_NT-10.0-19045',
    })
    // The call count is the assertion: a guessed-at command would have run.
    expect(subject.exec).toHaveBeenCalledTimes(1)
  })
})

describe('the linux uptime field', () => {
  it('reads seconds from /proc/uptime, not the idle field', () => {
    /*
     * `/proc/uptime` is two numbers: `12345.67 89012.34` — uptime then total idle.
     * `cut -d. -f1` splits on the dot and takes the first field, which is the uptime's
     * integer part. If the command were `awk '{print $2}'` the panel would show idle
     * time as uptime, which drifts toward the machine's age and looks plausible.
     */
    const command = String(PROBE_COMMANDS.linux)
    const uptimeLine = command.split('; ').find(part => part.includes('/proc/uptime'))
    expect(uptimeLine).toBeTruthy()
    expect(uptimeLine).toMatch(/cut -d\. -f1/)
    expect(uptimeLine).not.toMatch(/\$2/)
  })

  it('parses the integer into seconds', () => {
    const { metrics } = parseProbeOutput('os=Linux\nuptime=12345\n', 'linux')
    expect(metrics.uptimeSeconds).toBe(12345)
  })
})
