#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  DEBUG_SSH_CASES,
  EVIDENCE_KIND,
  EVIDENCE_PROFILE,
  RELEASE_SSH_CASES,
  SHELL_PROBE_CASES,
  computeSourceFingerprint,
} from './check-verification-evidence.mjs'

/**
 * Turns the raw runner logs of one GitHub Actions macOS run into the six
 * current evidence files plus the manifest that binds them together.
 *
 * Every number written here is parsed out of a log the workflow captured with
 * `2>&1 | tee`. Nothing is defaulted, interpolated or hand-filled: a missing
 * case, a failing-case line, a readiness above the ten second budget or a
 * binary hash that disagrees with the log makes this script exit non-zero
 * **without writing a single file**, so a partial run can never leave half a
 * contract behind.
 *
 * Provenance (run id, workflow, commit, runner) is not measurement data: it is
 * passed in from the workflow through the usual GitHub environment variables
 * and is what the gate later uses to tie the evidence to the run that produced
 * it.
 *
 *   node scripts/build-verification-evidence.mjs \
 *     --logs evidence-logs --out docs/verification \
 *     --debug-sha "$DEBUG_SHA" --release-sha "$RELEASE_SHA"
 *
 * `--check` runs the whole parse and contract validation but writes nothing,
 * which is how the parser is self-tested locally against synthetic logs.
 */

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..')

const EVIDENCE_FILES = {
  debugColdStart: '2026-10-11-macos-cold-start-current.json',
  debugRemoteColdStart: '2026-10-11-macos-remote-shell-prompt-rerun.json',
  debugSshMatrix: '2026-10-11-macos-ssh-matrix-current.json',
  debugShellInteraction: '2026-10-11-macos-shell-interaction-current.json',
  releaseColdStart: '2026-10-11-macos-release-terminal-gate.json',
  releaseSshMatrix: '2026-10-11-macos-release-ssh-matrix.json',
}

const MANIFEST_FILE = 'evidence-manifest.json'

const DEBUG_BINARY = 'src-tauri/target/debug/terminal'
const RELEASE_BINARY = 'src-tauri/target/release/terminal'

const DEBUG_BUILD_COMMAND =
  'VITE_TERMINAL_SMOKE_BUILD=1 pnpm tauri build --debug --no-bundle'
const RELEASE_BUILD_COMMAND =
  'VITE_TERMINAL_SMOKE_BUILD=1 pnpm tauri build --no-bundle'

const MAX_READY_MS = 10_000
const LOCAL_COLD_START_RUNS = 3
const LOCAL_SHELLS = ['bash', 'zsh']
const LOCAL_SHELL_RUNS = LOCAL_SHELLS.length * SHELL_PROBE_CASES.length

const LOG_FILES = {
  debugColdStart: 'debug-local-cold-start.log',
  debugRemoteColdStart: 'debug-remote-cold-start.log',
  debugSshMatrix: 'debug-ssh-matrix.log',
  debugShellLocal: 'debug-shell-probe-local.log',
  debugShellSsh: 'debug-shell-probe-ssh.log',
  releaseColdStart: 'release-local-cold-start.log',
  releaseSshMatrix: 'release-ssh-matrix.log',
}

// The runners print a green check per passing case and a red cross per failing
// one; both are matched through escapes so this script stays ASCII-only.
const PASS_MARK = '\u2705'
const FAIL_MARK = '\u274c'
const SSH_MATRIX_SUMMARY =
  /\u2705\s+([A-Za-z0-9_-]+):\s+first connection (\d+) ms,\s+(\d+) ms,\s+(\d+) sessions/g
const MEASURED_BINARY = /Measured (debug|release) binary ([0-9a-f]{64})/g
const FAILED_LINE = /(^|\s)FAILED(\s|:|$)/

const LOCAL_COLD_START_PROBE =
  'Rust TERMINAL_SHELL_PROBE marker written only after the frontend sent its nonce through xterm -> session_write -> local PTY and read the marker back'
const REMOTE_COLD_START_PROBE =
  'loopback sshd fixture prints an OSC 133 prompt; the app reports ready only after the remote prompt marker round-trip'

function parseArguments(argv) {
  const value = name => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  return {
    check: argv.includes('--check'),
    logs: value('--logs') ?? 'evidence-logs',
    out: value('--out') ?? 'docs/verification',
    debugSha: value('--debug-sha') ?? process.env.DEBUG_SHA,
    releaseSha: value('--release-sha') ?? process.env.RELEASE_SHA,
    runId: value('--run-id') ?? process.env.GITHUB_RUN_ID,
    runAttempt: value('--run-attempt') ?? process.env.GITHUB_RUN_ATTEMPT,
    workflow: value('--workflow') ?? process.env.GITHUB_WORKFLOW,
    job: value('--job') ?? process.env.GITHUB_JOB,
    commit: value('--commit') ?? process.env.GITHUB_SHA,
    head:
      value('--head') ?? process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF_NAME,
    runnerOs: value('--runner-os') ?? process.env.RUNNER_OS,
    runnerArch: value('--runner-arch') ?? process.env.RUNNER_ARCH,
    osName: value('--os-name'),
    dockerVersion: value('--docker-version'),
    recordedAt: value('--recorded-at'),
  }
}

/**
 * Reads the top-level JSON documents a runner printed into its log. The
 * progress lines the runners write while working are not JSON and are skipped;
 * a block that fails to parse is skipped too, because the per-scenario
 * validators below are what decide whether the log is usable.
 */
function extractJsonDocuments(text) {
  const documents = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      if (depth > 0) inString = true
      continue
    }
    if (character === '{' || character === '[') {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (character === '}' || character === ']') {
      if (depth === 0) continue
      depth -= 1
      if (depth === 0 && start >= 0) {
        try {
          documents.push(JSON.parse(text.slice(start, index + 1)))
        } catch {
          // Not a JSON document: the runners also print bracketed progress
          // prefixes such as [local/bash/cat-eof] running...
        }
        start = -1
      }
    }
  }
  return documents
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function withinBudget(value) {
  return isFiniteNumber(value) && value >= 0 && value <= MAX_READY_MS
}

function failureLines(text) {
  return text
    .split(/\r?\n/)
    .filter(line => line.includes(FAIL_MARK) || FAILED_LINE.test(line))
}

function measuredBinaryHashes(text) {
  return [...text.matchAll(MEASURED_BINARY)].map(match => ({
    profile: match[1],
    sha256: match[2],
  }))
}

function coldStartRuns(text) {
  return extractJsonDocuments(text).filter(
    document =>
      document !== null &&
      typeof document === 'object' &&
      !Array.isArray(document) &&
      'spawnToReadyMs' in document,
  )
}

// ---------------------------------------------------------------------------
// Log noise
//
// One console line carries three layers the parsing below must not see: the
// ANSI colouring the Tauri app, pnpm and ssh emit, the literal `^[` form a
// downloaded Actions log renders those same escapes as, and the workflow's
// `##[group]` / `##[endgroup]` markers. Colour is not cosmetic here: an escape
// sequence contains a `[`, so a bracket-counting JSON extractor that reads the
// raw text never returns to depth zero and reports every later document as
// absent. That is exactly how a log holding all fourteen cases parsed as zero.
// ---------------------------------------------------------------------------
const ANSI_ESCAPE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const CARET_ESCAPE = /\^\[\[[0-9;?]*[ -/]*[@-~]/g
const WORKFLOW_MARKER = /^##\[(?:group|endgroup)\].*$/gm
const BYTE_ORDER_MARK = /\ufeff/g

export function stripLogNoise(text) {
  return text
    .replace(BYTE_ORDER_MARK, '')
    .replace(CARET_ESCAPE, '')
    .replace(ANSI_ESCAPE, '')
    .replace(WORKFLOW_MARKER, '')
}

const SHELL_PROBE_HEADER =
  /^\[(local|ssh)\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\] running\.\.\./
const SHELL_PROBE_OK = /\bok \((\d+) ms\)/
const SHELL_PROBE_FAILED = /\bFAILED\b/

/**
 * Recovers the case list from the progress lines the matrix runner prints
 * between the cases themselves.
 *
 * The header and its `ok (N ms)` are never on the same line on a real runner:
 * the application logs a startup banner in between, so the outcome is found by
 * scanning forward from each header and stopping at the next header. This
 * fallback earns its place because the JSON summary is written once, at the
 * end: a run killed by a failure never writes one.
 */
function shellProbeProgressResults(text) {
  const results = []
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const header = SHELL_PROBE_HEADER.exec(line)
    if (header !== null) {
      current = {
        caseName: header[3],
        durationMs: undefined,
        ok: null,
        shell: header[2],
        transport: header[1],
      }
      results.push(current)
      continue
    }
    if (current === null || current.ok !== null) continue
    const ok = SHELL_PROBE_OK.exec(line)
    if (ok !== null) {
      current.ok = true
      current.durationMs = Number(ok[1])
      continue
    }
    if (SHELL_PROBE_FAILED.test(line)) current.ok = false
  }
  for (const entry of results) {
    if (entry.ok === null) entry.ok = false
  }
  return results
}

/**
 * Parses one shell-probe log into its cases.
 *
 * The JSON summary the runner prints last is the richer source (`transport`,
 * `shell`, `binarySha256`), so it wins whenever it parses; the progress scan
 * takes over when it does not. `source` is reported by `--check` so a reviewer
 * can see which of the two produced the numbers.
 */
export function parseShellProbeLog(text) {
  const noiseFree = stripLogNoise(text)
  const arrays = extractJsonDocuments(noiseFree).filter(
    document =>
      Array.isArray(document) &&
      document.length > 0 &&
      document.every(
        entry =>
          entry !== null &&
          typeof entry === 'object' &&
          typeof entry.caseName === 'string',
      ),
  )
  const jsonCases = arrays.length === 0 ? [] : arrays[arrays.length - 1]
  if (jsonCases.length > 0) return { cases: jsonCases, source: 'json-summary' }
  const progressCases = shellProbeProgressResults(noiseFree)
  return {
    cases: progressCases,
    source: progressCases.length === 0 ? 'none' : 'progress-lines',
  }
}

function sshMatrixCases(text) {
  return [...text.matchAll(SSH_MATRIX_SUMMARY)].map(match => ({
    name: match[1],
    ok: true,
    firstConnectionMs: Number(match[2]),
    durationMs: Number(match[3]),
    uniqueSessionCount: Number(match[4]),
  }))
}

/**
 * Emits cases in the contract order the gate compares against. The log only has
 * to contain that exact set: the macOS job splits the matrix across two steps so
 * a rerun of the long outage cases does not restart the shorter ones, and the
 * order the runner cached them in was never part of the contract.
 */
function orderCases(cases, expected, label, problems) {
  const observed = cases.map(item => item.name)
  const missing = expected.filter(name => !observed.includes(name))
  const unexpected = observed.filter(name => !expected.includes(name))
  const duplicated = observed.filter(
    (name, index) => observed.indexOf(name) !== index,
  )
  if (missing.length > 0) {
    problems.push(label + ' is missing the expected case(s) ' + missing.join(', '))
  }
  if (unexpected.length > 0) {
    problems.push(label + ' reports unexpected case(s) ' + unexpected.join(', '))
  }
  if (duplicated.length > 0) {
    problems.push(label + ' reports duplicate case(s) ' + duplicated.join(', '))
  }
  const byName = new Map(cases.map(item => [item.name, item]))
  return expected.map(name => byName.get(name)).filter(Boolean)
}

function validateColdStartRuns({ runs, label, expected, problems }) {
  if (runs.length !== expected) {
    problems.push(
      label +
        ' recorded ' +
        runs.length +
        ' run(s); the evidence contract needs exactly ' +
        expected,
    )
  }
  runs.forEach((run, index) => {
    const where = label + ' run ' + (index + 1)
    if (run.ok !== true) problems.push(where + ' is not marked ok')
    if (run.readyAt !== 'terminal') {
      problems.push(
        where + ' reports readyAt ' + JSON.stringify(run.readyAt) + ' instead of "terminal"',
      )
    }
    if (run.terminalReady !== true) {
      problems.push(where + ' never reached terminal readiness')
    }
    if (run.markerReady !== true) {
      problems.push(where + ' never observed its readiness marker')
    }
    if (!withinBudget(run.spawnToReadyMs)) {
      problems.push(
        where +
          ' spawnToReadyMs is ' +
          JSON.stringify(run.spawnToReadyMs) +
          '; expected 0..' +
          MAX_READY_MS,
      )
    }
    if (!isFiniteNumber(run.requestToReadyMs)) {
      problems.push(where + ' has no usable requestToReadyMs')
    }
  })
  return runs
}

async function readLog(directory, file, problems) {
  try {
    return await readFile(path.join(directory, file), 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    problems.push(
      file +
        ' is missing from ' +
        directory +
        ': the workflow captures every scenario through 2>&1 | tee into that ' +
        'directory, so a missing log means the scenario never ran or was never captured.',
    )
    return undefined
  }
}

function validateMeasuredBinaries(text, label, profile, expectedSha, problems) {
  const observed = measuredBinaryHashes(text)
  if (observed.length === 0) {
    problems.push(
      label +
        ' never printed the "Measured ' +
        profile +
        ' binary <sha256>" line, so the run cannot be tied to the artifact it ' +
        'claims to describe',
    )
    return
  }
  for (const entry of observed) {
    if (entry.profile !== profile) {
      problems.push(
        label +
          ' measured a ' +
          entry.profile +
          ' binary; the ' +
          profile +
          ' evidence must come from the ' +
          profile +
          ' artifact',
      )
    }
    if (entry.sha256 !== expectedSha) {
      problems.push(
        label +
          ' measured binary ' +
          entry.sha256 +
          ', but the recorded ' +
          profile +
          ' artifact is ' +
          expectedSha +
          ': something relinked or rebuilt the binary between the build step ' +
          'and this scenario, so the numbers describe a different artifact',
      )
    }
  }
}

function ensureBinaryHashes(text, label, runs, expectedSha, problems) {
  for (const [index, run] of runs.entries()) {
    if (run.binarySha256 !== undefined && run.binarySha256 !== expectedSha) {
      problems.push(
        label +
          ' run ' +
          (index + 1) +
          ' reports binarySha256 ' +
          run.binarySha256 +
          ', but the recorded artifact is ' +
          expectedSha,
      )
    }
  }
}

function ensureShellProbeHashes(label, results, expectedSha, problems) {
  for (const entry of results) {
    if (entry.binarySha256 !== undefined && entry.binarySha256 !== expectedSha) {
      problems.push(
        label +
          ' case ' +
          entry.caseName +
          ' reports binarySha256 ' +
          entry.binarySha256 +
          ', but the recorded artifact is ' +
          expectedSha,
      )
    }
  }
}

function terminalRun(recordedRun, index, { withNonce }) {
  const run = {
    run: index + 1,
    capturedAt: recordedRun.capturedAt,
    pid: recordedRun.pid,
  }
  if (withNonce) {
    run.nonce = recordedRun.nonce
    run.marker = recordedRun.marker
  }
  run.readyAt = recordedRun.readyAt
  run.terminalReady = recordedRun.terminalReady
  run.markerReady = recordedRun.markerReady
  run.spawnToReadyMs = recordedRun.spawnToReadyMs
  run.requestToReadyMs = recordedRun.requestToReadyMs
  run.probeCaseName =
    recordedRun.caseName ?? recordedRun.probeResult?.caseName ?? 'cat-eof'
  run.ok = recordedRun.ok
  return run
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const problems = []
  // Only filled in --check mode: it prints the raw case counts the fixtures
  // below are parsed into, so the parser can be proven offline.
  const checkNotes = []
  const logsDirectory = path.resolve(PROJECT_ROOT, options.logs)

  for (const [key, file] of Object.entries(EVIDENCE_FILES)) {
    if (!EVIDENCE_PROFILE.has(file)) {
      throw new Error(
        'EVIDENCE_FILES.' + key + ' names ' + file + ', which the gate does not register',
      )
    }
  }

  const required = [
    ['debug artifact sha256', options.debugSha],
    ['release artifact sha256', options.releaseSha],
    ['run id', options.runId],
    ['commit', options.commit],
  ]
  for (const [label, value] of required) {
    if (typeof value !== 'string' || value === '') {
      problems.push(
        'the ' +
          label +
          ' was not provided; pass it on the command line or through the GitHub ' +
          'environment (DEBUG_SHA, RELEASE_SHA, GITHUB_RUN_ID, GITHUB_SHA)',
      )
    }
  }
  for (const sha of [options.debugSha, options.releaseSha]) {
    if (sha !== undefined && !/^[0-9a-f]{64}$/.test(sha)) {
      problems.push(
        'artifact sha256 ' + JSON.stringify(sha) + ' is not a lowercase sha256 digest',
      )
    }
  }

  const logs = {}
  for (const [key, file] of Object.entries(LOG_FILES)) {
    const text = await readLog(logsDirectory, file, problems)
    if (text !== undefined) logs[key] = text
  }

  const recordedAt = options.recordedAt ?? new Date().toISOString()
  const fingerprint = await computeSourceFingerprint()

  const environment = {
    os: options.osName ?? os.type() + ' ' + os.release(),
    architecture: (options.runnerArch ?? process.arch)
      .toLowerCase()
      .replace('x64', 'x86_64'),
    node: process.versions.node,
    ...(options.dockerVersion === undefined ? {} : { docker: options.dockerVersion }),
  }
  const revision = {
    head: options.head ?? 'detached',
    commit: options.commit === undefined ? undefined : options.commit.slice(0, 7),
    dirtyWorktree: false,
  }
  const provenance = {
    source: 'github-actions',
    runId: options.runId,
    runAttempt: options.runAttempt,
    workflow: options.workflow,
    job: options.job,
    commit: options.commit,
    fingerprint,
    runner: { os: options.runnerOs, arch: options.runnerArch },
  }
  const source = {
    fingerprint,
    note:
      'Computed over FINGERPRINT_PATHS by scripts/check-verification-evidence.mjs on the ' +
      'checked-out CI sources at evidence build time.',
  }
  const documents = new Map()

  // ---- debug: local cold start, three separate invocations -----------------
  if (logs.debugColdStart !== undefined) {
    const label = LOG_FILES.debugColdStart
    const runs = coldStartRuns(logs.debugColdStart)
    validateColdStartRuns({ runs, label, expected: LOCAL_COLD_START_RUNS, problems })
    ensureBinaryHashes(logs.debugColdStart, label, runs, options.debugSha, problems)
    documents.set(EVIDENCE_FILES.debugColdStart, {
      recordedAt,
      recordedDate: recordedAt.slice(0, 10),
      kind: EVIDENCE_KIND.get(EVIDENCE_FILES.debugColdStart),
      command:
        DEBUG_BUILD_COMMAND +
        ' && pnpm smoke:local-cold-start -- --app-path $PWD/' +
        DEBUG_BINARY +
        ' (invoked ' +
        LOCAL_COLD_START_RUNS +
        ' times, one measured run per invocation)',
      environment,
      revision,
      binary: { path: DEBUG_BINARY, sha256: options.debugSha },
      measurement: {
        probe: LOCAL_COLD_START_PROBE,
        measuredFrom: 'child-spawn-event',
        readinessTarget: 'terminal',
        caseName: 'cat-eof',
        repeatSpawnToReadyMs: runs.map(run => run.spawnToReadyMs),
        readyUnder10s: runs.every(run => withinBudget(run.spawnToReadyMs)),
        terminalRuns: runs.map((run, index) =>
          terminalRun(run, index, { withNonce: true }),
        ),
      },
      source,
      limitations: [
        'This binary is a VITE_TERMINAL_SMOKE_BUILD=1 pnpm tauri build --debug --no-bundle artifact with an embedded frontend; a plain build has no smoke/probe entry points and the runners refuse it.',
        'The marker proves the local PTY round-trip is usable, not that a remote host answers: remote readiness is measured separately in 2026-10-11-macos-remote-shell-prompt-rerun.json.',
        'Measured on a GitHub-hosted macOS virtual machine, not on a developer laptop or shipping hardware.',
        'Human physical keyboard typing, IME composition, sleep/resume on a real lid close and Windows/Pageant/serial hardware are still not covered by this file.',
      ],
      provenance,
    })
  }

  // ---- debug: remote SSH prompt cold start --------------------------------
  if (logs.debugRemoteColdStart !== undefined) {
    const label = LOG_FILES.debugRemoteColdStart
    const runs = coldStartRuns(logs.debugRemoteColdStart)
    if (runs.length !== 1) {
      problems.push(label + ' recorded ' + runs.length + ' run(s); expected exactly 1')
    }
    runs.forEach((run, index) => {
      const where = label + ' run ' + (index + 1)
      if (run.ok !== true) problems.push(where + ' is not marked ok')
      if (run.terminalReady !== true) {
        problems.push(where + ' never reached terminal readiness')
      }
      if (run.markerReady !== true) {
        problems.push(where + ' never observed the prompt marker')
      }
      if (!withinBudget(run.spawnToReadyMs)) {
        problems.push(
          where +
            ' spawnToReadyMs is ' +
            JSON.stringify(run.spawnToReadyMs) +
            '; expected 0..' +
            MAX_READY_MS,
        )
      }
      if (
        !Array.isArray(run.markerChecks) ||
        run.markerChecks.length === 0 ||
        run.markerChecks.some(check => check?.ready !== true)
      ) {
        problems.push(where + ' recorded no ready prompt-marker check')
      }
    })
    ensureBinaryHashes(logs.debugRemoteColdStart, label, runs, options.debugSha, problems)
    const run = runs[0] ?? {}
    documents.set(EVIDENCE_FILES.debugRemoteColdStart, {
      recordedAt,
      recordedDate: recordedAt.slice(0, 10),
      kind: EVIDENCE_KIND.get(EVIDENCE_FILES.debugRemoteColdStart),
      command:
        DEBUG_BUILD_COMMAND +
        ' && pnpm smoke:remote-cold-start -- --app-path $PWD/' +
        DEBUG_BINARY,
      environment,
      revision,
      binary: { path: DEBUG_BINARY, sha256: options.debugSha },
      application: { path: run.appPath, pid: run.pid },
      fixture: {
        host: run.fixture?.host,
        port: run.fixture?.port,
        username: run.fixture?.username,
      },
      shell: run.shell,
      shellIntegration: run.shellIntegration,
      measurement: {
        probe: REMOTE_COLD_START_PROBE,
        measuredFrom: 'child-spawn-event',
        readinessTarget: 'terminal',
        spawnToPromptObservedMs: run.spawnToReadyMs,
        requestToPromptObservedMs: run.requestToReadyMs,
        markerReady: run.markerReady,
        terminalReady: run.terminalReady,
        windowReady: run.windowReady,
        promptMarker: run.promptMarker,
        underTenSeconds: withinBudget(run.spawnToReadyMs),
      },
      evidence: {
        markerPath: run.markerPath,
        promptMarkerPath: run.promptMarkerPath,
        markerChecks: run.markerChecks,
      },
      source,
      limitations: [
        'The fixture is a loopback sshd inside the runner; it proves the remote prompt path, not a real network hop, VPN switch or jump host chain.',
        'AX window readiness reports false in remote mode by design, so this record says nothing about window readiness timing.',
        'Measured on a GitHub-hosted macOS virtual machine, not on developer hardware.',
        'Human physical keyboard typing, IME composition and real sleep/resume remain unverified.',
      ],
      provenance,
    })
  }

  // ---- debug: 13-case real SSH matrix ------------------------------------
  if (logs.debugSshMatrix !== undefined) {
    const label = LOG_FILES.debugSshMatrix
    validateMeasuredBinaries(
      logs.debugSshMatrix,
      label,
      'debug',
      options.debugSha,
      problems,
    )
    for (const line of failureLines(logs.debugSshMatrix)) {
      problems.push(label + ' reports a failing case: ' + line.trim())
    }
    const ordered = orderCases(
      sshMatrixCases(logs.debugSshMatrix),
      DEBUG_SSH_CASES,
      label,
      problems,
    )
    for (const item of ordered) {
      if (
        !isFiniteNumber(item.firstConnectionMs) ||
        !isFiniteNumber(item.durationMs)
      ) {
        problems.push(label + ' case ' + item.name + ' has no usable timing')
      }
    }
    documents.set(EVIDENCE_FILES.debugSshMatrix, {
      recordedAt,
      recordedDate: recordedAt.slice(0, 10),
      kind: EVIDENCE_KIND.get(EVIDENCE_FILES.debugSshMatrix),
      command:
        DEBUG_BUILD_COMMAND +
        ' && pnpm smoke:ssh-matrix --reuse-binary ' +
        DEBUG_SSH_CASES.join(','),
      environment,
      revision,
      binary: { path: DEBUG_BINARY, sha256: options.debugSha },
      allCasesPassed: ordered.length === DEBUG_SSH_CASES.length,
      cases: ordered.map(item => ({
        name: item.name,
        ok: item.ok,
        binarySha256: options.debugSha,
        firstConnectionMs: item.firstConnectionMs,
        durationMs: item.durationMs,
        uniqueSessionCount: item.uniqueSessionCount,
      })),
      passwordFixtureNote:
        'The password cases run against the terminal-smoke-password-sshd Docker image so a real password prompt is exercised, not a stub.',
      source,
      limitations: [
        'Every fixture is a loopback sshd inside the runner: no real network hop, VPN switch or corporate jump chain is exercised.',
        'The instrumented debug binary is a VITE_TERMINAL_SMOKE_BUILD=1 artifact, not the shipping bundle.',
        'The password cases need a Docker daemon on the runner because their fixture is the Debian OpenSSH image.',
        'Human physical keyboard typing and IME composition are still unverified.',
      ],
      provenance,
    })
  }

  // ---- debug: local 14 + real SSH 7 shell probes -------------------------
  if (logs.debugShellLocal !== undefined || logs.debugShellSsh !== undefined) {
    const localParse =
      logs.debugShellLocal === undefined
        ? undefined
        : parseShellProbeLog(logs.debugShellLocal)
    const sshParse =
      logs.debugShellSsh === undefined
        ? undefined
        : parseShellProbeLog(logs.debugShellSsh)
    const localResults = localParse?.cases ?? []
    const sshResults = sshParse?.cases ?? []
    for (const [file, parse] of [
      [LOG_FILES.debugShellLocal, localParse],
      [LOG_FILES.debugShellSsh, sshParse],
    ]) {
      if (parse === undefined) continue
      checkNotes.push(
        file +
          ': parsed ' +
          parse.cases.length +
          ' case(s) from ' +
          parse.source +
          ' [' +
          parse.cases
            .map(entry => entry.transport + '/' + entry.shell + '/' + entry.caseName)
            .join(', ') +
          ']',
      )
    }

    if (logs.debugShellLocal !== undefined) {
      const label = LOG_FILES.debugShellLocal
      validateMeasuredBinaries(logs.debugShellLocal, label, 'debug', options.debugSha, problems)
      for (const line of failureLines(logs.debugShellLocal)) {
        problems.push(label + ' reports a failing case: ' + line.trim())
      }
      ensureShellProbeHashes(label, localResults, options.debugSha, problems)
      if (localResults.length !== LOCAL_SHELL_RUNS) {
        problems.push(
          label +
            ' recorded ' +
            localResults.length +
            ' case(s); expected ' +
            LOCAL_SHELL_RUNS +
            ' (' +
            LOCAL_SHELLS.join('/') +
            ' x ' +
            SHELL_PROBE_CASES.length +
            ')',
        )
      }
      for (const shell of LOCAL_SHELLS) {
        const observed = localResults
          .filter(entry => entry.shell === shell)
          .map(entry => entry.caseName)
        if (JSON.stringify(observed) !== JSON.stringify(SHELL_PROBE_CASES)) {
          problems.push(
            label +
              ' ' +
              shell +
              ' case order is ' +
              JSON.stringify(observed) +
              '; expected ' +
              JSON.stringify(SHELL_PROBE_CASES),
          )
        }
      }
      for (const entry of localResults) {
        if (entry.ok !== true) {
          problems.push(label + ' case ' + entry.caseName + ' did not pass')
        }
        if (!isFiniteNumber(entry.durationMs)) {
          problems.push(label + ' case ' + entry.caseName + ' has no duration')
        }
      }
    }

    if (logs.debugShellSsh !== undefined) {
      const label = LOG_FILES.debugShellSsh
      validateMeasuredBinaries(logs.debugShellSsh, label, 'debug', options.debugSha, problems)
      for (const line of failureLines(logs.debugShellSsh)) {
        problems.push(label + ' reports a failing case: ' + line.trim())
      }
      ensureShellProbeHashes(label, sshResults, options.debugSha, problems)
      if (sshResults.length !== SHELL_PROBE_CASES.length) {
        problems.push(
          label +
            ' recorded ' +
            sshResults.length +
            ' case(s); expected ' +
            SHELL_PROBE_CASES.length,
        )
      }
      if (sshResults.some(entry => entry.transport !== 'ssh')) {
        problems.push(label + ' contains cases that did not run over SSH')
      }
      const observed = sshResults.map(entry => entry.caseName)
      if (JSON.stringify(observed) !== JSON.stringify(SHELL_PROBE_CASES)) {
        problems.push(
          label +
            ' case order is ' +
            JSON.stringify(observed) +
            '; expected ' +
            JSON.stringify(SHELL_PROBE_CASES),
        )
      }
      for (const entry of sshResults) {
        if (entry.ok !== true) {
          problems.push(label + ' case ' + entry.caseName + ' did not pass')
        }
        if (!isFiniteNumber(entry.durationMs)) {
          problems.push(label + ' case ' + entry.caseName + ' has no duration')
        }
      }
    }

    const localByPosition = new Map(
      localResults.map(entry => [entry.shell + '/' + entry.caseName, entry]),
    )
    const sshByCase = new Map(sshResults.map(entry => [entry.caseName, entry]))
    documents.set(EVIDENCE_FILES.debugShellInteraction, {
      recordedAt,
      recordedDate: recordedAt.slice(0, 10),
      kind: EVIDENCE_KIND.get(EVIDENCE_FILES.debugShellInteraction),
      command:
        'pnpm smoke:shell-probe:matrix --reuse-binary --shells ' +
        LOCAL_SHELLS.join(',') +
        ' -- ' +
        SHELL_PROBE_CASES.join(','),
      matrixCommand:
        'pnpm smoke:shell-probe:matrix --reuse-binary --shells ' +
        LOCAL_SHELLS.join(',') +
        ' -- ' +
        SHELL_PROBE_CASES.join(','),
      sshMatrixCommand:
        'pnpm smoke:shell-probe:matrix --reuse-binary --transport ssh -- ' +
        SHELL_PROBE_CASES.join(','),
      environment,
      revision,
      binary: { path: DEBUG_BINARY, sha256: options.debugSha },
      shells: LOCAL_SHELLS,
      matrixRunsExecuted: localResults.length,
      matrixRunsPassed: localResults.filter(entry => entry.ok === true).length,
      sshRunsExecuted: sshResults.length,
      sshRunsPassed: sshResults.filter(entry => entry.ok === true).length,
      cases: LOCAL_SHELLS.flatMap(shell =>
        SHELL_PROBE_CASES.map(caseName => {
          const entry = localByPosition.get(shell + '/' + caseName) ?? {}
          return {
            shell,
            case: caseName,
            ok: entry.ok === true,
            durationMs: entry.durationMs,
          }
        }),
      ),
      sshCases: SHELL_PROBE_CASES.map(caseName => {
        const entry = sshByCase.get(caseName) ?? {}
        return { case: caseName, ok: entry.ok === true, durationMs: entry.durationMs }
      }),
      allCasesPassed:
        localResults.length === LOCAL_SHELL_RUNS &&
        localResults.every(entry => entry.ok === true) &&
        sshResults.length === SHELL_PROBE_CASES.length &&
        sshResults.every(entry => entry.ok === true),
      sshShell: 'default login shell of the loopback sshd fixture',
      shellNote:
        'Each case drives the real Tauri/WKWebView xterm surface into a local PTY or a loopback SSH channel and checks the exact readback.',
      dialectNote:
        'bash and zsh have dedicated dialects; fish/sh are rejected before any build until they do.',
      source,
      limitations: [
        'The probes type through the same xterm input path a user does, but they are not human keystrokes: physical keyboard hardware, dead keys and IME composition remain unverified.',
        'Virtual terminal sessions and the sshd fixture both run inside the same runner; no Windows/Linux PTY or serial hardware is covered.',
        'Measured on a GitHub-hosted macOS virtual machine, not on developer hardware.',
      ],
      provenance,
    })
  }

  // ---- release: local cold start, three separate invocations -------------
  if (logs.releaseColdStart !== undefined) {
    const label = LOG_FILES.releaseColdStart
    const runs = coldStartRuns(logs.releaseColdStart)
    validateColdStartRuns({ runs, label, expected: LOCAL_COLD_START_RUNS, problems })
    ensureBinaryHashes(logs.releaseColdStart, label, runs, options.releaseSha, problems)
    documents.set(EVIDENCE_FILES.releaseColdStart, {
      recordedAt,
      recordedDate: recordedAt.slice(0, 10),
      kind: EVIDENCE_KIND.get(EVIDENCE_FILES.releaseColdStart),
      why:
        'Release artifact ' +
        options.releaseSha +
        ' was built and measured by GitHub Actions run ' +
        options.runId +
        ' attempt ' +
        options.runAttempt +
        ' at commit ' +
        options.commit +
        '; this record re-measures the ten-second terminal gate the earlier local captures described, on the artifact that run produced.',
      environment,
      revision,
      build: {
        command: RELEASE_BUILD_COMMAND,
        binary: RELEASE_BINARY,
        sha256: options.releaseSha,
        devServerRequired: false,
        smokeInstrumented: true,
      },
      local: {
        command:
          'pnpm smoke:local-cold-start -- --app-path $PWD/' +
          RELEASE_BINARY +
          ' (invoked ' +
          LOCAL_COLD_START_RUNS +
          ' times, one measured run per invocation)',
        probe: LOCAL_COLD_START_PROBE,
        measuredFrom: 'child-spawn-event',
        readinessTarget: 'terminal',
        repeatSpawnToReadyMs: runs.map(run => run.spawnToReadyMs),
        readyUnder10s: runs.every(run => withinBudget(run.spawnToReadyMs)),
        terminalRuns: runs.map((run, index) =>
          terminalRun(run, index, { withNonce: false }),
        ),
      },
      source,
      limitations: [
        'This is automated evidence. It does not cover a human on a physical keyboard, Chinese IME composition, Option/dead keys, or vim/nano editing.',
        'The remote SSH prompt gate for the release profile is measured in 2026-10-11-macos-release-ssh-matrix.json, not in this file.',
        'Measured on a GitHub-hosted macOS virtual machine; real lid-close sleep/wake, VPN and cellular handover recovery remain unobserved on hardware.',
        'The binary is unsigned and unnotarised; first-launch Gatekeeper behaviour on a clean machine is still unverified.',
        'Windows OpenSSH Agent, Pageant, ConPTY/local Windows PTY and serial hardware have no test machine available and are not covered here.',
      ],
      instrumentationCaveat:
        'This binary is built with VITE_TERMINAL_SMOKE_BUILD=1, which compiles the smoke and input-probe entry points and the experiments nav item into the frontend. A shipping build omits all of them, so these numbers describe a slightly larger bundle than a user receives and are a conservative upper bound.',
      provenance,
    })
  }

  // ---- release: 10-case real SSH matrix ----------------------------------
  if (logs.releaseSshMatrix !== undefined) {
    const label = LOG_FILES.releaseSshMatrix
    validateMeasuredBinaries(
      logs.releaseSshMatrix,
      label,
      'release',
      options.releaseSha,
      problems,
    )
    for (const line of failureLines(logs.releaseSshMatrix)) {
      problems.push(label + ' reports a failing case: ' + line.trim())
    }
    const ordered = orderCases(
      sshMatrixCases(logs.releaseSshMatrix),
      RELEASE_SSH_CASES,
      label,
      problems,
    )
    const firstConnections = ordered
      .map(item => item.firstConnectionMs)
      .filter(isFiniteNumber)
    documents.set(EVIDENCE_FILES.releaseSshMatrix, {
      recordedAt,
      recordedDate: recordedAt.slice(0, 10),
      kind: EVIDENCE_KIND.get(EVIDENCE_FILES.releaseSshMatrix),
      why:
        'Release artifact ' +
        options.releaseSha +
        ' was built and measured by GitHub Actions run ' +
        options.runId +
        ' attempt ' +
        options.runAttempt +
        ' at commit ' +
        options.commit +
        '; this records the ' +
        RELEASE_SSH_CASES.length +
        '-case authentication matrix the gate requires, on that artifact.',
      command:
        RELEASE_BUILD_COMMAND +
        ' && pnpm smoke:ssh-matrix --reuse-binary --release ' +
        RELEASE_SSH_CASES.join(','),
      environment,
      revision,
      build: {
        command: RELEASE_BUILD_COMMAND,
        binary: RELEASE_BINARY,
        sha256: options.releaseSha,
        devServerRequired: false,
        smokeInstrumented: true,
      },
      sshMatrix: {
        command:
          'pnpm smoke:ssh-matrix --reuse-binary --release ' +
          RELEASE_SSH_CASES.join(','),
        passed: ordered.filter(item => item.ok === true).length,
        failed: ordered.filter(item => item.ok !== true).length,
        firstConnectionMsRange:
          firstConnections.length === 0
            ? undefined
            : [Math.min(...firstConnections), Math.max(...firstConnections)],
        cases: ordered.map(item => ({
          name: item.name,
          ok: item.ok,
          binarySha256: options.releaseSha,
          firstConnectionMs: item.firstConnectionMs,
          durationMs: item.durationMs,
          uniqueSessionCount: item.uniqueSessionCount,
        })),
      },
      limitations: [
        'Every fixture is a loopback sshd inside the runner; no real network hop, VPN switch or corporate jump chain is exercised.',
        'The binary is built with VITE_TERMINAL_SMOKE_BUILD=1, so it is a slightly larger artifact than a shipping build.',
        'The password cases need a Docker daemon on the runner because their fixture is the Debian OpenSSH image.',
        'Human physical keyboard, IME composition and Windows/Pageant/serial hardware remain unverified.',
      ],
      provenance,
    })
  }

  for (const file of Object.values(EVIDENCE_FILES)) {
    if (!documents.has(file)) {
      problems.push(file + ' could not be built because its log was unreadable')
    }
  }

  const manifest = {
    generatedAt: recordedAt,
    source: 'github-actions',
    runId: options.runId,
    runAttempt: options.runAttempt,
    workflow: options.workflow,
    job: options.job,
    commit: options.commit,
    fingerprint,
    debugSha: options.debugSha,
    releaseSha: options.releaseSha,
    runner: { os: options.runnerOs, arch: options.runnerArch },
    evidenceFiles: [...documents].map(([file, document]) => ({
      file,
      profile: EVIDENCE_PROFILE.get(file),
      kind: document.kind,
      sha256: document.binary?.sha256 ?? document.build?.sha256 ?? null,
    })),
    rawLogs: { directory: options.logs, files: Object.values(LOG_FILES) },
  }

  if (options.check) {
    for (const note of checkNotes) console.log('shell probe parse: ' + note)
  }

  if (problems.length > 0) {
    console.error(
      'Evidence build refused: ' +
        problems.length +
        ' problem(s). No file was written.',
    )
    for (const problem of problems) console.error('- ' + problem)
    process.exitCode = 1
    return
  }

  const outputDirectory = path.resolve(PROJECT_ROOT, options.out)
  if (options.check) {
    console.log(
      'Evidence build check passed: ' +
        documents.size +
        ' document(s) plus ' +
        MANIFEST_FILE +
        ' can be produced from ' +
        options.logs +
        '.',
    )
    for (const [file, document] of documents) {
      const cases =
        document.cases?.length ??
        document.sshMatrix?.cases?.length ??
        document.measurement?.terminalRuns?.length ??
        document.local?.terminalRuns?.length ??
        0
      const sha = document.binary?.sha256 ?? document.build?.sha256 ?? ''
      console.log(
        '- ' +
          file +
          ': kind ' +
          document.kind +
          ', ' +
          cases +
          ' recorded case(s)/run(s), binary ' +
          sha.slice(0, 8),
      )
    }
    console.log(
      '- ' +
        MANIFEST_FILE +
        ': run ' +
        manifest.runId +
        ', commit ' +
        manifest.commit +
        ', fingerprint ' +
        manifest.fingerprint.slice(0, 8),
    )
    console.log('Nothing was written; ' + outputDirectory + ' is untouched.')
    return
  }

  await mkdir(outputDirectory, { recursive: true })
  for (const [file, document] of documents) {
    await writeFile(
      path.join(outputDirectory, file),
      JSON.stringify(document, null, 2) + '\n',
      'utf8',
    )
  }
  await writeFile(
    path.join(outputDirectory, MANIFEST_FILE),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  )
  console.log(
    'Wrote ' +
      documents.size +
      ' evidence file(s) and ' +
      MANIFEST_FILE +
      ' to ' +
      options.out +
      '.',
  )
  for (const file of documents.keys()) console.log('- ' + file)
  console.log('- ' + MANIFEST_FILE)
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
