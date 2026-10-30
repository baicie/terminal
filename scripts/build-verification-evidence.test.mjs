import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { promisify } from 'node:util'

import { SHELL_PROBE_CASES } from './check-verification-evidence.mjs'
import { parseShellProbeLog, stripLogNoise } from './build-verification-evidence.mjs'

/**
 * Offline proof for the shell-probe parser.
 *
 * The two fixtures are the macOS runner steps of GitHub run 41060385490,
 * copied out of the job log with only the console's per-line
 * `2026-10-30T13:16:38.5365320Z ` timestamp column removed, because that column
 * is added by the log viewer and never reaches the `2>&1 | tee` artifact this
 * parser actually reads. The ANSI colouring is kept in the form the downloaded
 * log renders it (`^[[2m`), and the workflow's `##[group]` markers are kept
 * too: those were present when the run reported 0 of 14 and 0 of 7 cases.
 *
 * The fixtures end in `.txt` only because this repository ignores `*.log`; the
 * test that drives the generator copies them back to the names the evidence
 * contract uses before running it.
 */
const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/shell-probe')
const LOCAL_LOG = path.join(FIXTURES, 'debug-shell-probe-local.txt')
const SSH_LOG = path.join(FIXTURES, 'debug-shell-probe-ssh.txt')
const BINARY_SHA256 =
  'ef6d7453ffc11cb76d6bac35da29c9a53aec915c1a524a177f4c6ed34b319f4d'

// Verbatim runner lines: the case header, one application log line that the
// runner interleaves, and the outcome line. The header and the outcome are
// never on the same line, which is the defect this parser has to survive.
const LOCAL_PROGRESS_LINES = [
  '[local/bash/cat-eof] running...^[[2m2026-10-30T13:16:38.536017Z^[[0m ^[[32m INFO^[[0m ^[[2mterminal_lib^[[0m^[[2m:^[[0m tauri app starting up',
  '^[[2m2026-10-30T13:16:40.098136Z^[[0m ^[[32m INFO^[[0m ^[[2mterminal_lib::input_probe^[[0m^[[2m:^[[0m input_probe_config invoked',
  ' ok (504 ms)',
  '[local/zsh/vim-edit] running...^[[2m2026-10-30T13:17:33.371873Z^[[0m ^[[32m INFO^[[0m ^[[2mterminal_lib^[[0m^[[2m:^[[0m tauri app starting up',
  '^[[2m2026-10-30T13:17:35.137741Z^[[0m ^[[32m INFO^[[0m ^[[2mterminal_lib::input_probe^[[0m^[[2m:^[[0m input_probe_config invoked',
  ' ok (5368 ms)',
].join('\n')

const SSH_PROGRESS_LINES = [
  '[ssh/default/cat-eof] running...^[[2m2026-10-30T13:18:09.391677Z^[[0m ^[[32m INFO^[[0m ^[[2mterminal_lib^[[0m^[[2m:^[[0m tauri app starting up',
  '^[[2m2026-10-30T13:18:11.095250Z^[[0m ^[[32m INFO^[[0m ^[[2mterminal_lib::input_probe^[[0m^[[2m:^[[0m input_probe_config invoked',
  ' ok (745 ms)',
  '[ssh/default/readline-history] running...^[[2m2026-10-30T13:18:14.279548Z^[[0m ^[[32m INFO^[[0m ^[[2mterminal_lib^[[0m^[[2m:^[[0m tauri app starting up',
  ' FAILED — expected process 21013 to be frontmost, got 351 after 8 attempts',
].join('\n')

test('the real macOS local probe log parses into the fourteen contract cases', async () => {
  const parsed = parseShellProbeLog(await readFile(LOCAL_LOG, 'utf8'))

  assert.equal(parsed.source, 'json-summary')
  assert.equal(parsed.cases.length, SHELL_PROBE_CASES.length * 2)
  assert.ok(parsed.cases.every(entry => entry.transport === 'local'))
  assert.ok(parsed.cases.every(entry => entry.ok === true))
  for (const shell of ['bash', 'zsh']) {
    assert.deepEqual(
      parsed.cases.filter(entry => entry.shell === shell).map(entry => entry.caseName),
      SHELL_PROBE_CASES,
    )
  }
  assert.deepEqual(
    parsed.cases.filter(entry => entry.shell === 'bash').map(entry => entry.durationMs),
    [504, 405, 550, 5312, 4758, 1580, 1146],
  )
  assert.deepEqual(
    parsed.cases.filter(entry => entry.shell === 'zsh').map(entry => entry.durationMs),
    [614, 564, 559, 5368, 4771, 1460, 1245],
  )
})

test('the real macOS SSH probe log parses into the seven contract cases', async () => {
  const parsed = parseShellProbeLog(await readFile(SSH_LOG, 'utf8'))

  assert.equal(parsed.source, 'json-summary')
  assert.equal(parsed.cases.length, SHELL_PROBE_CASES.length)
  assert.ok(parsed.cases.every(entry => entry.transport === 'ssh'))
  assert.ok(parsed.cases.every(entry => entry.ok === true))
  assert.deepEqual(
    parsed.cases.map(entry => entry.caseName),
    SHELL_PROBE_CASES,
  )
  assert.deepEqual(
    parsed.cases.map(entry => entry.durationMs),
    [745, 641, 754, 5391, 4856, 1553, 1427],
  )
})

test('a case head and its outcome on separate lines are joined across the noise', () => {
  const parsed = parseShellProbeLog(LOCAL_PROGRESS_LINES)

  assert.equal(parsed.source, 'progress-lines')
  assert.deepEqual(
    parsed.cases.map(entry => [entry.transport, entry.shell, entry.caseName, entry.ok, entry.durationMs]),
    [
      ['local', 'bash', 'cat-eof', true, 504],
      ['local', 'zsh', 'vim-edit', true, 5368],
    ],
  )
})

test('an SSH probe keeps a FAILED outcome instead of reporting it as absent', () => {
  const parsed = parseShellProbeLog(SSH_PROGRESS_LINES)

  assert.equal(parsed.source, 'progress-lines')
  assert.deepEqual(
    parsed.cases.map(entry => [entry.shell, entry.caseName, entry.ok, entry.durationMs]),
    [
      ['default', 'cat-eof', true, 745],
      ['default', 'readline-history', false, undefined],
    ],
  )
})

test('the progress scan still reports every case when the JSON summary is absent', async () => {
  const text = await readFile(LOCAL_LOG, 'utf8')
  const killed = text.slice(0, text.indexOf('\n[\n'))

  const parsed = parseShellProbeLog(killed)

  assert.equal(parsed.source, 'progress-lines')
  assert.equal(parsed.cases.length, SHELL_PROBE_CASES.length * 2)
  assert.ok(parsed.cases.every(entry => entry.ok === true))
  assert.deepEqual(
    parsed.cases.filter(entry => entry.shell === 'bash').map(entry => entry.caseName),
    SHELL_PROBE_CASES,
  )
})

test('ANSI escapes in the log no longer hide the JSON summary', () => {
  // The shape that produced "recorded 0 case(s)": a coloured pnpm banner whose
  // escape sequences carry unbalanced "[" characters, followed by the summary.
  const summary = JSON.stringify(
    [
      {
        transport: 'local',
        shell: 'bash',
        caseName: 'cat-eof',
        durationMs: 504,
        ok: true,
        binarySha256: BINARY_SHA256,
      },
      {
        transport: 'local',
        shell: 'bash',
        caseName: 'readline-history',
        durationMs: 405,
        ok: true,
        binarySha256: BINARY_SHA256,
      },
    ],
    null,
    2,
  )
  const text = [
    '##[group]Run pnpm smoke:shell-probe:matrix -- --shells bash,zsh 2>&1 | tee evidence-logs/debug-shell-probe-local.log',
    '^[[36;1mpnpm smoke:shell-probe:matrix --reuse-binary^[[0m',
    '##[endgroup]',
    summary,
  ].join('\n')

  const parsed = parseShellProbeLog(text)

  assert.equal(parsed.source, 'json-summary')
  assert.deepEqual(
    parsed.cases.map(entry => [entry.caseName, entry.durationMs, entry.binarySha256]),
    [
      ['cat-eof', 504, BINARY_SHA256],
      ['readline-history', 405, BINARY_SHA256],
    ],
  )
})

test('stripLogNoise drops colour, the caret form and the group markers', () => {
  const cleaned = stripLogNoise(
    '\ufeff##[group]Run pnpm smoke:shell-probe:matrix 2>&1 | tee log\n' +
      '^[[36;1mpnpm^[[0m\n' +
      '\u001b[2m2026-10-30T13:16:38.536017Z\u001b[0m \u001b[32m INFO\u001b[0m tauri app starting up\n' +
      '##[endgroup]\n',
  )

  assert.doesNotMatch(cleaned, /\u001b/)
  assert.doesNotMatch(cleaned, /\^\[\[/)
  assert.doesNotMatch(cleaned, /##\[(?:group|endgroup)\]/)
  assert.match(cleaned, /pnpm/)
  assert.match(cleaned, /tauri app starting up/)
})

test('the generator itself reports 14 and 7 cases for the two real step outputs', async () => {
  // The evidence contract reads the logs under their workflow names, and this
  // repository ignores *.log, so the fixtures are copied back before the check.
  const directory = await mkdtemp(path.join(os.tmpdir(), 'shell-probe-evidence-'))
  try {
    await copyFile(LOCAL_LOG, path.join(directory, 'debug-shell-probe-local.log'))
    await copyFile(SSH_LOG, path.join(directory, 'debug-shell-probe-ssh.log'))
    const outcome = await promisify(execFile)(
      process.execPath,
      [
        path.join(import.meta.dirname, 'build-verification-evidence.mjs'),
        '--check',
        '--logs',
        directory,
        '--out',
        path.join(directory, 'out'),
        '--debug-sha',
        BINARY_SHA256,
        '--release-sha',
        BINARY_SHA256,
        '--run-id',
        '41060385490',
        '--run-attempt',
        '2',
        '--commit',
        '50b51b6',
      ],
      { cwd: path.resolve(import.meta.dirname, '..'), maxBuffer: 8 * 1024 * 1024 },
    ).catch(error => ({ stderr: error.stderr ?? '', stdout: error.stdout ?? '' }))

    assert.match(
      outcome.stdout,
      /shell probe parse: debug-shell-probe-local\.log: parsed 14 case\(s\) from json-summary/,
    )
    assert.match(
      outcome.stdout,
      /shell probe parse: debug-shell-probe-ssh\.log: parsed 7 case\(s\) from json-summary/,
    )
    // The check still refuses — a real run also produces the four other logs —
    // but it must not complain about these two.
    assert.doesNotMatch(outcome.stderr, /debug-shell-probe/)
    assert.match(outcome.stderr, /debug-ssh-matrix\.log is missing/)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
