// T07 — the CLI against a fake `${PATH}/gh`, so the real orchestration is exercised.
//
// The previous tests were pure-function only: they proved `classifyFailure` worked on
// a string. Nothing proved that a real log ever arrived. That is exactly the gap the
// `job.id` bug lived in — every unit test passed while the deployed tool classified
// from job names alone.
//
// These run `attribute-ci-failure.mjs` as a subprocess with a stub `gh` that serves
// fixture JSON. The stub is a real executable, so `execFileSync` and argument handling
// are part of what is tested.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts/attribute-ci-failure.mjs')

/**
 * Build a temporary bin directory holding a `gh` stub.
 *
 * `responses` maps a **plain substring** of the joined argv to `{ stdout, exit, stderr }`.
 * Substrings, not regexes: an earlier version handed regex sources through a
 * template-literal-then-`JSON.stringify` path, and each layer of escaping had to be
 * counted correctly for `?` in a query string to mean a literal question mark. One
 * miscount and the stub silently never matched, which made a correct test look like a
 * broken product. A substring has no escaping at all.
 *
 * First match wins, so longer/specific entries must come before shorter ones.
 */
function makeGhStub(responses) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gh-stub-'))
  const bin = path.join(dir, 'bin')
  mkdirSync(bin)

  const table = responses.map(([match, response]) => ({
    match,
    stdout: response.stdout ?? '',
    stderr: response.stderr ?? '',
    exit: response.exit ?? 0,
  }))

  const stubSource = `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ')
const table = ${JSON.stringify(table)}
const entry = table.find(candidate => args.includes(candidate.match))
if (!entry) {
  process.stderr.write('no stub response for: ' + args)
  process.exit(1)
}
if (entry.stderr) process.stderr.write(entry.stderr)
if (entry.stdout) {
  // Never process.exit() straight after a write: stdout to a pipe is asynchronous and
  // exiting truncates at the 8 KiB pipe buffer. That cut a 100-job page to 8192 bytes,
  // which surfaced as MALFORMED_RESPONSE and looked like a product bug.
  process.stdout.write(entry.stdout, () => process.exit(entry.exit))
} else {
  process.exit(entry.exit)
}
`
  const stubPath = path.join(bin, 'gh')
  writeFileSync(stubPath, stubSource)
  chmodSync(stubPath, 0o755)
  return { dir, bin, stubPath }
}

function runCli({ args, bin }) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, REPO: 'baicie/terminal' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

function writeJobs(dir, jobs) {
  const file = path.join(dir, 'jobs.json')
  writeFileSync(file, JSON.stringify(jobs))
  return file
}

/** The API shape of a job, with the field the old `jq` projection dropped. */
function apiJob({ id, name, conclusion, steps = [] }) {
  return {
    id,
    run_id: 9001,
    run_attempt: 1,
    name,
    conclusion,
    status: 'completed',
    html_url: `https://github.com/baicie/terminal/runs/${id}`,
    steps,
  }
}

test('a Rust compile failure is attributed from its real log', () => {
  const log = [
    '2026-11-15T13:09:19Z    Compiling thiserror v1.0.69',
    "2026-11-15T13:10:37Z error[E0433]: cannot find `unix` in `os`",
    '2026-11-15T13:10:52Z error: could not compile `terminal` (lib test) due to 2 previous errors',
    '2026-11-15T13:10:53Z ##[error]Process completed with exit code 1.',
  ].join('\n')
  const stub = makeGhStub([['actions/jobs/111/logs', { stdout: log }]])
  const file = writeJobs(stub.dir, [
    apiJob({ id: 111, name: 'Rust quality', conclusion: 'failure', steps: [{ name: 'cargo test', conclusion: 'failure' }] }),
  ])
  const result = runCli({ args: ['--jobs', file, '--run-conclusion', 'failure'], bin: stub.bin })
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /PRODUCT_REGRESSION/)
  assert.match(result.stdout, /Rust quality/)
})

test('a job list without ids reports LOG_UNAVAILABLE instead of guessing', () => {
  // This is the exact regression: the workflow's jq projection dropped `id`. The
  // report must say the log was unavailable rather than classify from the name.
  const stub = makeGhStub([])
  const file = writeJobs(stub.dir, [
    { name: 'Rust quality', conclusion: 'failure', informational: false },
  ])
  const result = runCli({ args: ['--jobs', file, '--run-conclusion', 'failure'], bin: stub.bin })
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /LOG_UNAVAILABLE/)
  assert.match(result.stdout, /no id/)
  assert.match(result.stdout, /UNKNOWN/)
})

test('an invalid job id is reported, not requested', () => {
  const stub = makeGhStub([])
  const file = writeJobs(stub.dir, [
    apiJob({ id: 'not-a-number', name: 'Rust quality', conclusion: 'failure' }),
  ])
  const result = runCli({ args: ['--jobs', file, '--run-conclusion', 'failure'], bin: stub.bin })
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /not a positive integer|no id/)
})

test('a 403 on the log is LOG_UNAVAILABLE with the permission reason', () => {
  const stub = makeGhStub([
    ['actions/jobs/222/logs', { exit: 1, stderr: 'gh: Resource not accessible (HTTP 403)' }],
  ])
  const file = writeJobs(stub.dir, [
    apiJob({ id: 222, name: 'Rust quality', conclusion: 'failure' }),
  ])
  const result = runCli({ args: ['--jobs', file, '--run-conclusion', 'failure'], bin: stub.bin })
  assert.match(result.stdout, /LOG_UNAVAILABLE/)
  assert.match(result.stdout, /actions:read/)
})

test('an expired log is distinguished from a missing one', () => {
  const stub = makeGhStub([['actions/jobs/333/logs', { exit: 1, stderr: 'gh: Gone (HTTP 410)' }]])
  const file = writeJobs(stub.dir, [apiJob({ id: 333, name: 'Frontend quality', conclusion: 'failure' })])
  const result = runCli({ args: ['--jobs', file, '--run-conclusion', 'failure'], bin: stub.bin })
  assert.match(result.stdout, /retention/)
})

test('multiple failing jobs are all reported, most specific wins', () => {
  const stub = makeGhStub([
    ['actions/jobs/401/logs', { stdout: 'SSL_ERROR_SYSCALL while downloading moxcms' }],
    ['actions/jobs/402/logs', { stdout: 'error[E0433]: cannot find `unix` in `os`' }],
  ])
  const file = writeJobs(stub.dir, [
    apiJob({ id: 401, name: 'Tauri build (ubuntu-latest)', conclusion: 'failure' }),
    apiJob({ id: 402, name: 'Rust quality', conclusion: 'failure' }),
  ])
  const result = runCli({ args: ['--jobs', file, '--run-conclusion', 'failure'], bin: stub.bin })
  assert.match(result.stdout, /PRODUCT_REGRESSION/)
  assert.match(result.stdout, /Tauri build \(ubuntu-latest\)/)
  assert.match(result.stdout, /Rust quality/)
  assert.match(result.stdout, /2 non-success job\(s\), 1 blocking/)
})

test('a matrix job on several platforms each keeps its own conclusion', () => {
  const stub = makeGhStub([['actions/jobs/501/logs', { stdout: 'error[E0599]: no method' }]])
  const file = writeJobs(stub.dir, [
    apiJob({ id: 500, name: 'Tauri build (macos-latest)', conclusion: 'success' }),
    apiJob({ id: 501, name: 'Tauri build (windows-latest)', conclusion: 'failure' }),
    apiJob({ id: 502, name: 'Tauri build (ubuntu-latest)', conclusion: 'success' }),
  ])
  const result = runCli({ args: ['--jobs', file, '--run-conclusion', 'failure'], bin: stub.bin })
  assert.match(result.stdout, /Tauri build \(windows-latest\)/)
  // The successes must not appear as failures.
  const tableRows = result.stdout.split('\n').filter(line => line.startsWith('| Tauri build'))
  assert.equal(tableRows.length, 1, result.stdout)
})

test('same-named jobs keep separate ids and separate verdicts', () => {
  // A sharded matrix can repeat a display name; the id is what disambiguates.
  const stub = makeGhStub([
    ['actions/jobs/601/logs', { stdout: 'test result: FAILED. 1 failed' }],
    ['actions/jobs/602/logs', { stdout: 'error[E0433]: nope' }],
  ])
  const file = writeJobs(stub.dir, [
    apiJob({ id: 601, name: 'Shard', conclusion: 'failure' }),
    apiJob({ id: 602, name: 'Shard', conclusion: 'failure' }),
  ])
  const result = runCli({ args: ['--jobs', file, '--run-conclusion', 'failure'], bin: stub.bin })
  const rows = result.stdout.split('\n').filter(line => line.startsWith('| Shard'))
  assert.equal(rows.length, 2, result.stdout)
})

test('an informational job is non-blocking and says so', () => {
  const stub = makeGhStub([['actions/jobs/701/logs', { stdout: 'error[E0433]: cannot find unix' }]])
  const file = writeJobs(stub.dir, [
    apiJob({ id: 701, name: 'Windows GUI E2E (informational)', conclusion: 'failure' }),
  ])
  const result = runCli({
    args: ['--jobs', file, '--run-conclusion', 'failure', '--workflow-file', '.github/workflows/native-gui-e2e.yml'],
    bin: stub.bin,
  })
  assert.match(result.stdout, /PRODUCT_REGRESSION/)
  assert.match(result.stdout, /\| yes \|$|\| yes \|/m)
})

test('a cancelled run reports superseded and never "no job failed"', () => {
  const stub = makeGhStub([])
  const file = writeJobs(stub.dir, [apiJob({ id: 800, name: 'Rust quality', conclusion: 'cancelled' })])
  const result = runCli({ args: ['--jobs', file, '--run-conclusion', 'cancelled'], bin: stub.bin })
  assert.match(result.stdout, /INFRA_FAILURE/)
  assert.doesNotMatch(result.stdout, /No job failed/)
})

test('a timed-out job is a failure, not a clean run', () => {
  const stub = makeGhStub([['actions/jobs/801/logs', { stdout: 'The action has timed out' }]])
  const file = writeJobs(stub.dir, [apiJob({ id: 801, name: 'Tauri build (macos-latest)', conclusion: 'timed_out' })])
  const result = runCli({ args: ['--jobs', file, '--run-conclusion', 'timed_out'], bin: stub.bin })
  assert.doesNotMatch(result.stdout, /No job failed/)
  assert.match(result.stdout, /timed_out/)
})

test('a required-check failure is shown as blocking merge even when the cause is non-blocking', () => {
  // INFRA_FAILURE has `blocking: false` because no code change is needed — but the
  // required check still failed, and the report must not imply the PR can merge.
  const stub = makeGhStub([['actions/jobs/900/logs', { stdout: 'SSL_ERROR_SYSCALL' }]])
  const file = writeJobs(stub.dir, [apiJob({ id: 900, name: 'Rust quality', conclusion: 'failure' })])
  const result = runCli({
    args: ['--jobs', file, '--run-conclusion', 'failure', '--required-failed', 'true'],
    bin: stub.bin,
  })
  assert.match(result.stdout, /INFRA_FAILURE/)
  assert.match(result.stdout, /Required check result \| \*\*failed\*\*/)
  assert.match(result.stdout, /Merge eligibility \| blocked/)
})

test('a stale-evidence failure is non-blocking but still lists its job', () => {
  const stub = makeGhStub([
    ['actions/jobs/950/logs', { stdout: 'x.json was recorded against source fingerprint aaa, but the terminal sources now fingerprint as bbb' }],
  ])
  const file = writeJobs(stub.dir, [
    apiJob({ id: 950, name: 'Repository gates (source size, evidence, script tests)', conclusion: 'failure' }),
  ])
  const result = runCli({ args: ['--jobs', file, '--run-conclusion', 'failure'], bin: stub.bin })
  assert.match(result.stdout, /EVIDENCE_STALE/)
  assert.match(result.stdout, /Repository gates/)
})

test('a cargo audit advisory is a security finding', () => {
  const stub = makeGhStub([
    ['actions/jobs/960/logs', { stdout: 'error: RUSTSEC-2026-0486: rustix xattr zero-length buffer is unsound' }],
  ])
  const file = writeJobs(stub.dir, [apiJob({ id: 960, name: 'cargo audit (blocking)', conclusion: 'failure' })])
  const result = runCli({ args: ['--jobs', file, '--run-conclusion', 'failure'], bin: stub.bin })
  assert.match(result.stdout, /SECURITY_FINDING/)
})

test('the run URL is preserved in every report shape', () => {
  const stub = makeGhStub([])
  const file = writeJobs(stub.dir, [apiJob({ id: 1, name: 'Rust quality', conclusion: 'failure' })])
  const result = runCli({ args: ['--jobs', file, '--run-id', '43716684905', '--run-conclusion', 'failure'], bin: stub.bin })
  assert.match(result.stdout, /https:\/\/github\.com\/baicie\/terminal\/actions\/runs\/43716684905/)
})

test('a malformed job list fails loudly rather than printing a clean report', () => {
  const stub = makeGhStub([])
  const file = path.join(stub.dir, 'bad.json')
  writeFileSync(file, '{not json')
  const result = runCli({ args: ['--jobs', file], bin: stub.bin })
  assert.equal(result.code, 1)
  assert.doesNotMatch(result.stdout, /No job failed/)
})

test('a job list that is not an array or {jobs} is rejected', () => {
  const stub = makeGhStub([])
  const file = path.join(stub.dir, 'object.json')
  writeFileSync(file, JSON.stringify({ nope: true }))
  const result = runCli({ args: ['--jobs', file], bin: stub.bin })
  assert.equal(result.code, 1)
})

test('--api mode reads the run conclusion from the Runs API, not from the jobs', () => {
  // A run can be `failure` while the job list this collector sees is all green.
  const stub = makeGhStub([
    ['actions/runs/1234/jobs', {
      stdout: JSON.stringify({ total_count: 1, jobs: [apiJob({ id: 1300, name: 'Rust quality', conclusion: 'success' })] }),
    }],
    ['actions/jobs/1300/logs', { stdout: '' }],
    // Last, because it is the shortest prefix and would otherwise shadow the above.
    ['actions/runs/1234', { stdout: JSON.stringify({ id: 1234, conclusion: 'failure', status: 'completed', run_attempt: 1 }) }],
  ])
  const result = runCli({ args: ['--api', '--run-id', '1234'], bin: stub.bin })
  // Whatever the stub matched, the report must not claim "No job failed" when the
  // run itself failed and no failing job was found.
  assert.doesNotMatch(result.stdout, /No job failed/)
})

test('more than 100 jobs are read across pages', async () => {
  const firstPage = Array.from({ length: 100 }, (_, i) =>
    apiJob({ id: 2000 + i, name: `Shard ${i}`, conclusion: 'success' }),
  )
  const secondPage = [apiJob({ id: 2100, name: 'Rust quality', conclusion: 'failure' })]
  const stub = makeGhStub([
    // Specific before general: the page query strings first, the run itself last.
    ['&page=1', { stdout: JSON.stringify({ total_count: 101, jobs: firstPage }) }],
    ['&page=2', { stdout: JSON.stringify({ total_count: 101, jobs: secondPage }) }],
    ['actions/jobs/2100/logs', { stdout: 'error[E0433]: cannot find unix' }],
    ['actions/runs/5555', {
      stdout: JSON.stringify({ id: 5555, conclusion: 'failure', status: 'completed', run_attempt: 1 }),
    }],
  ])
  const { readFileSync: rf5, writeFileSync: wf5 } = await import('node:fs')
  wf5('/tmp/stubdump.mjs', rf5(stub.stubPath, 'utf8'))
  const result = runCli({ args: ['--api', '--run-id', '5555'], bin: stub.bin })

  // The 101st job exists only on page 2; if pagination stopped at one page the
  // failure would be invisible.
  assert.match(result.stdout, /PRODUCT_REGRESSION/)
  assert.match(result.stdout, /Rust quality/)
})
