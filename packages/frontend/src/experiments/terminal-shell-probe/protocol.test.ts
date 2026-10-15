import { describe, expect, it, vi } from 'vitest'
import { casesForDialect, CAT_EOF_DELAY_MS, readySteps } from './dialect'
import {
  createShellProbeInterruptCommand,
  createShellProbeInterruptPassCommand,
  createShellProbeSetupCommand,
  createShellProbeHistoryCommand,
  createShellProbeTabStepCommand,
  createShellProbeVimVerifyCommand,
  createShellProbeVimEditSteps,
  createShellProbeNanoEditSteps,
  createShellProbeNanoVerifyCommand,
  createShellProbeResizeProbeCommand,
  createShellProbeResizeVerdictProbeCommand,
  parseResizeObservation,
  PTY_RESIZE_SEQUENCE,
  loadShellProbeConfig,
  parseShellProbeConfig,
  parseShellProbeResult,
  shellProbeMarkers,
  ShellProbeParser,
  type ShellProbeConfig,
  VIM_PROBE_TEXT,
  NANO_PROBE_TEXT,
} from './protocol'
import { SHELL_PROBE_CASES } from './result'

// A syntactically complete OpenSSH private key: the shared smoke parser
// requires the real envelope, so a placeholder string would be rejected
// for the wrong reason.
const OPENSSH_KEY =
  '-----BEGIN OPENSSH PRIVATE KEY-----\n' +
  'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQyNTUxOQAAACB' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAtzc2gtZWQyNTUxOQAAACBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAA==\n' +
  '-----END OPENSSH PRIVATE KEY-----\n'

const CONFIG: ShellProbeConfig = {
  resultPath: '/tmp/shell-probe-result.json',
  caseName: 'cat-eof',
  dialect: 'posix',
  timeoutMs: 20_000,
  ssh: null,
}

describe('terminal shell probe protocol', () => {
  it('keeps the three cases and their required trace shape stable', () => {
    expect(shellProbeMarkers('probe_1').ready).toContain('READY')
    expect(shellProbeMarkers('probe_1').step).toContain('STEP')
    expect(shellProbeMarkers('probe_1').pass).toContain('PASS')
    expect(createShellProbeSetupCommand('probe_1', 'cat-eof')).toContain(
      'captured=$(cat)',
    )
    expect(createShellProbeHistoryCommand('probe_1')).toContain(
      'SHELL_PROBE_HISTORY_SEEN',
    )
    expect(createShellProbeTabStepCommand('probe_1')).toContain(
      'printf',
    )
    expect(createShellProbeSetupCommand('probe_1', 'readline-tab')).toContain(
      'alpha_probe',
    )
    expect(createShellProbeSetupCommand('probe_1', 'vim-edit')).toContain(
      'original_probe_line',
    )
    expect(createShellProbeVimVerifyCommand('probe_1')).toContain('grep -q')
    expect(createShellProbeInterruptCommand('probe_1')).toContain('sleep 20')
    expect(createShellProbeInterruptPassCommand('probe_1')).toContain('printf')
  })

  it('does not place a complete marker in the shell command source', () => {
    const commands = [
      createShellProbeSetupCommand('probe_1', 'cat-eof'),
      createShellProbeSetupCommand('probe_1', 'readline-history'),
      createShellProbeSetupCommand('probe_1', 'readline-tab'),
      createShellProbeSetupCommand('probe_1', 'vim-edit'),
      createShellProbeSetupCommand('probe_1', 'ctrl-c-interrupt'),
      createShellProbeTabStepCommand('probe_1'),
      createShellProbeHistoryCommand('probe_1'),
      createShellProbeVimVerifyCommand('probe_1'),
      createShellProbeInterruptCommand('probe_1'),
      createShellProbeInterruptPassCommand('probe_1'),
    ]
    for (const command of commands) {
      const markers = shellProbeMarkers('probe_1')
      expect(command).not.toContain(markers.ready)
      expect(command).not.toContain(markers.step)
      expect(command).not.toContain(markers.pass)
      expect(command).not.toContain(markers.fail)
    }
  })

  it('keeps the interrupt case free of trailing shell-side verdicts', () => {
    // bash resumes the rest of a `;` list after a foreground SIGINT while zsh
    // abandons it, so any marker printed after `sleep` would report the
    // shell's list semantics instead of whether the interrupt was delivered.
    // A swallowed interrupt has to fail on the probe deadline instead.
    const markers = shellProbeMarkers('probe_1')
    const command = createShellProbeInterruptCommand('probe_1')
    expect(command).not.toContain(markers.fail)
    expect(command.split(';')).toHaveLength(2)
    expect(createShellProbeInterruptPassCommand('probe_1')).not.toContain(
      markers.fail,
    )
  })

  it('drives the vim edit from ready without waiting for a step marker', () => {
    const steps = createShellProbeVimEditSteps()
    expect(steps.map(step => step.data)).toEqual([
      'i',
      VIM_PROBE_TEXT,
      '\x1b',
      ':wq\r',
    ])
    const delays = steps.map(step => step.delayMs)
    expect([...delays].sort((a, b) => a - b)).toEqual(delays)
    // The verification command carries both step and pass, so the case still
    // has to run after the last keystroke.
    expect(createShellProbeVimVerifyCommand('probe_1')).toContain('grep -q')
  })

  it('drives the nano write-out so the on-disk check is meaningful', () => {
    expect(createShellProbeNanoEditSteps().map(step => step.data)).toEqual([
      NANO_PROBE_TEXT,
      '\x0f',
      '\r',
      '\x18',
    ])
    expect(createShellProbeNanoVerifyCommand('probe_1')).toContain('grep -q')
  })

  it('reads PTY sizes back through stty and keeps trace markers out of it', () => {
    const nonce = 'probe_1'
    const markers = shellProbeMarkers(nonce)
    const probe = createShellProbeResizeProbeCommand(nonce)
    expect(probe).toContain('stty size')
    // A resize observation must not reuse a trace marker: the parser advances
    // its trace on those, which would consume `step` before the sequence ends.
    expect(probe).not.toContain(markers.step)
    expect(probe).not.toContain(markers.pass)
    const observation = `noise ${shellProbeMarkers(nonce).ready.replace(
      /READY__$/,
      'SIZE__',
    )}:31_97`
    const parsed = parseResizeObservation(observation, nonce)
    expect({ observation, parsed }).toEqual({
      observation: expect.any(String),
      parsed: { rows: 31, cols: 97 },
    })
    expect(parseResizeObservation('nothing here', nonce)).toBeNull()
  })

  it('makes the final resize probe emit the step and pass verdict', () => {
    const nonce = 'probe_1'
    const last = PTY_RESIZE_SEQUENCE.at(-1)!
    const command = createShellProbeResizeVerdictProbeCommand(nonce, last)
    expect(command).toContain(`"$1" = '${last.rows}'`)
    expect(command).toContain(`"$2" = '${last.cols}'`)
    // The verdict command prints each marker split across two arguments, so a
    // complete marker never appears in the shell command source.
    const markers = shellProbeMarkers(nonce)
    expect(command).not.toContain(markers.step)
    expect(command).not.toContain(markers.pass)
    expect(command).not.toContain(markers.fail)
  })

  it.each(SHELL_PROBE_CASES)('accepts the %s case in the result parser', name => {
    // A case the result parser rejects never reaches the PTY, so the probe can
    // only time out. These two lists have to stay in step.
    expect(parseShellProbeConfig({
      caseName: name,
      resultPath: '/tmp/shell-probe-result.json',
      timeoutMs: 30_000,
      dialect: 'posix',
      ssh: null,
    }).caseName).toBe(name)
  })

  it.each([
    ['powershell', 'vim-edit'],
    ['cmd', 'pty-resize'],
  ] as const)(
    'rejects a %s config claiming the %s case it cannot drive',
    (dialect, caseName) => {
      // Accepting the pair would send POSIX stty/editor commands to a shell
      // that cannot parse them and report the syntax error as an interaction
      // failure, so the config has to fail before any PTY is created.
      expect(() =>
        parseShellProbeConfig({
          caseName,
          resultPath: '/tmp/shell-probe-result.json',
          timeoutMs: 30_000,
          dialect,
          ssh: null,
        }),
      ).toThrow('Invalid shell probe config')
    },
  )

  it.each(['powershell', 'cmd'] as const)(
    'accepts every case the %s dialect claims',
    dialect => {
      for (const caseName of casesForDialect(dialect)) {
        expect(
          parseShellProbeConfig({
            caseName,
            resultPath: '/tmp/shell-probe-result.json',
            timeoutMs: 30_000,
            dialect,
            ssh: null,
          }).caseName,
        ).toBe(caseName)
      }
    },
  )

  it('closes stdin with Ctrl+D for the POSIX cat-eof capture', () => {
    // The POSIX setup captures with `captured=$(cat)`, which returns only at
    // EOF. A regression here does not fail loudly: the case just blocks in cat
    // and the probe reports a timeout on its deadline instead of a pass.
    const steps = readySteps('posix', 'cat-eof', 'probe_1')
    expect(steps.map(step => step.data)).toEqual([
      'cat-eof-probe' + String.fromCharCode(13),
      String.fromCharCode(4),
    ])
    expect(steps[1].delayMs).toBe(CAT_EOF_DELAY_MS)
  })

  it.each(['powershell', 'cmd'] as const)(
    'does not send Ctrl+D for the line-reading %s cat-eof setup',
    dialect => {
      // These read exactly one line, so a Ctrl+D would be swallowed as an
      // empty extra line instead of closing the capture.
      expect(readySteps(dialect, 'cat-eof', 'probe_1').map(step => step.data)).toEqual([
        'cat-eof-probe' + String.fromCharCode(13),
      ])
    },
  )

  it('parses markers split across PTY output chunks in case order', () => {
    const parser = new ShellProbeParser('probe_1', 'readline-tab')
    const markers = shellProbeMarkers('probe_1')
    expect(parser.push(`noise\r\n${markers.ready.slice(0, 7)}`)).toEqual([])
    expect(parser.push(`${markers.ready.slice(7)}\r\n`)).toEqual([
      { kind: 'ready' },
    ])
    expect(parser.push(`${markers.step.slice(0, 4)}`)).toEqual([])
    expect(parser.push(`${markers.step.slice(4)}\r\n`)).toEqual([
      { kind: 'step' },
    ])
    expect(parser.push(`${markers.pass.slice(0, 5)}`)).toEqual([])
    expect(parser.push(`${markers.pass.slice(5)}\r\n`)).toEqual([
      { kind: 'pass' },
    ])
  })

  it('reports an explicit shell-side failure marker', () => {
    const parser = new ShellProbeParser('probe_1', 'cat-eof')
    const markers = shellProbeMarkers('probe_1')
    expect(parser.push(markers.ready)).toEqual([{ kind: 'ready' }])
    expect(parser.push(`noise${markers.fail}`)).toEqual([{ kind: 'fail' }])
  })

  it('parses and rejects the strict config contract', () => {
    expect(parseShellProbeConfig(CONFIG)).toEqual(CONFIG)
    expect(() => parseShellProbeConfig({ ...CONFIG, timeoutMs: 0 })).toThrow(
      'Invalid shell probe config',
    )
    expect(() =>
      parseShellProbeConfig({ ...CONFIG, extra: true }),
    ).toThrow('Invalid shell probe config')
  })

  it('accepts an SSH transport target and keeps the local transport null', () => {
    const ssh = {
      host: '127.0.0.1',
      port: 22_222,
      username: 'probe',
      authMode: 'key' as const,
      expectedHostKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIProbe',
      privateKey: OPENSSH_KEY,
      password: null,
      certificate: null,
      jump: null,
    }
    expect(parseShellProbeConfig({ ...CONFIG, ssh })).toEqual({ ...CONFIG, ssh })
    expect(parseShellProbeConfig(CONFIG).ssh).toBeNull()
  })

  it('rejects an SSH target the shared smoke parser refuses', () => {
    const base = {
      host: '127.0.0.1',
      port: 22_222,
      username: 'probe',
      authMode: 'key' as const,
      expectedHostKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIProbe',
      privateKey: OPENSSH_KEY,
      password: null,
      certificate: null,
    }
    // A key mode with no key looks configured but can only fail later, after a
    // silent fallback to a different auth path.
    expect(() =>
      parseShellProbeConfig({ ...CONFIG, ssh: { ...base, privateKey: null } }),
    ).toThrow()
    // Agent mode is the one shape that legitimately carries no credential.
    expect(
      parseShellProbeConfig({
        ...CONFIG,
        ssh: { ...base, authMode: 'agent', privateKey: null },
      }).ssh,
    ).toEqual({ ...base, authMode: 'agent', privateKey: null, jump: null })
    // ...and it must not carry local credentials either.
    expect(() =>
      parseShellProbeConfig({
        ...CONFIG,
        ssh: { ...base, authMode: 'agent' },
      }),
    ).toThrow()
    expect(() =>
      parseShellProbeConfig({ ...CONFIG, ssh: { ...base, certificate: 'x' } }),
    ).toThrow()
    expect(() =>
      parseShellProbeConfig({ ...CONFIG, ssh: { ...base, port: 0 } }),
    ).toThrow()
    expect(() =>
      parseShellProbeConfig({ ...CONFIG, ssh: { ...base, extra: 1 } }),
    ).toThrow()
  })

  it('validates result traces and input diagnostics', () => {
    const result = {
      caseName: 'cat-eof' as const,
      durationMs: 42,
      error: null,
      inputEvents: [
        { kind: 'text' as const, bytes: 3, dataHex: '616263' },
        { kind: 'text' as const, bytes: 1, dataHex: '04' },
      ],
      ok: true,
      trace: ['ready', 'pass'] as const,
    }
    expect(parseShellProbeResult(result, CONFIG)).toEqual(result)
    expect(() =>
      parseShellProbeResult(
        { ...result, trace: ['ready', 'step', 'pass'] },
        CONFIG,
      ),
    ).toThrow('Invalid shell probe result')
    expect(() =>
      parseShellProbeResult(
        { ...result, inputEvents: [{ kind: 'raw', bytes: 1, dataHex: 'ff' }] },
        CONFIG,
      ),
    ).toThrow('Invalid shell probe result')
    expect(
      parseShellProbeResult(
        {
          ...result,
          error: 'PTY unavailable',
          inputEvents: [],
          ok: false,
        },
        CONFIG,
      ).ok,
    ).toBe(false)
    expect(() =>
      parseShellProbeResult({ ...result, inputEvents: [] }, CONFIG),
    ).toThrow('Invalid shell probe result')
  })

  it('loads a config only in a Tauri runtime', async () => {
    const invoke = vi.fn().mockResolvedValue(CONFIG)
    const ipc = { isTauri: () => true, invoke }
    await expect(loadShellProbeConfig(ipc)).resolves.toEqual(CONFIG)
    expect(invoke).toHaveBeenCalledWith('shell_probe_config')
  })
})
