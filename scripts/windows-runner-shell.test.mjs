// A `run:` script in a Windows job must be written in PowerShell, not POSIX shell.
//
// ## The failure this catches, measured
//
// `Native GUI E2E` ran a summarise step on `windows-latest` written as:
//
//   run: |
//     mkdir -p test-results
//     node scripts/gui-e2e-report.mjs \
//       --artifacts e2e/gui/artifacts \
//       --out test-results/gui-e2e.json \
//       --platform "$RUNNER_OS"
//
// GitHub's default shell on Windows is `pwsh`, which has no `\` line continuation.
// The step died before running node at all:
//
//   ParserError: D:\a\_temp\….ps1:4
//     4 |    --artifacts e2e/gui/artifacts \
//       |      ~
//       | Missing expression after unary operator '--'.
//
// The GUI cases themselves had passed (6 + 5 + 8). The job still went red, and the
// Windows layer never produced `test-results/gui-e2e.json`, so the aggregated test
// report had no Windows GUI row at all — the failure replaced a silence with a red
// X, and both were wrong for different reasons.
//
// A second, quieter defect sat in the same step: `$RUNNER_OS` is a GitHub expression
// variable, but in PowerShell a bare `$NAME` is an *unset PowerShell variable* that
// expands to the empty string. It would have silently written `--platform ""` even
// if the continuation had parsed. Environment variables in PowerShell are `$env:NAME`.
//
// The guard below reads every workflow, finds the jobs that run on Windows, and
// rejects the POSIX-only constructs in their scripts unless the job sets
// `shell: bash` (in which case Git for Windows provides the real bash).
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const WORKFLOWS = path.join(ROOT, '.github/workflows')

/** Commands that exist on a POSIX shell but not in PowerShell. */
const POSIX_ONLY = [
  /^mkdir\s+-p\b/,
  /^rm\s+-[rf]/,
  /^cp\s+-[rR]/,
  /^chmod\b/,
  /^chown\b/,
  /^sudo\b/,
  /^export\s+[A-Z_]/,
  /^set\s+-[eux]/,
  /^shasum\b/,
  /^xvfb-run\b/,
  /^apt-get\b/,
  /^hdiutil\b/,
]

/**
 * PowerShell automatic variables. These are *correctly* bare `$NAME` — they are set by
 * the shell itself, not by the environment, so `$env:LASTEXITCODE` would be wrong.
 */
const PS_AUTOMATIC = new Set([
  'LASTEXITCODE', 'ERRORLEVEL', 'PSNativeCommandArgumentPassing',
  'PSNativeCommandUseErrorActionPreference',
  'PWD', 'HOME', 'Error', 'Matches', 'Args', 'Input', 'PSItem',
  'MyInvocation', 'PSCommandPath', 'PSScriptRoot', 'PSVersionTable',
  'ExecutionContext', 'Host', 'PID', 'True', 'False', 'Null',
])

/**
 * Read the `jobs:` section well enough to know, for each job, its `runs-on`, whether
 * it overrides `shell:`, and the bodies of its `run:` blocks.
 *
 * This is a deliberately small reader for the shape these workflows actually use
 * (two-space job keys, four-space step keys, block scalars after `run: |`). It fails
 * loudly — an unparseable workflow yields zero jobs, and the "the reader finds the
 * Windows GUI job" test below proves it sees the real thing rather than nothing.
 */
function parseJobs(yaml) {
  const lines = yaml.split('\n')
  const jobs = {}
  let currentJob = null
  let inJobs = false
  let runIndent = null
  let currentRun = null

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]
    const line = raw.replace(/\s+$/, '')
    const indent = line.length - line.trimStart().length

    if (runIndent !== null) {
      if (line.trim() !== '' && indent > runIndent) {
        currentRun.lines.push(line.slice(runIndent + 1))
        continue
      }
      runIndent = null
      currentRun = null
    }

    if (/^jobs:\s*$/.test(line)) {
      inJobs = true
      continue
    }
    if (!inJobs) continue
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    if (indent === 0) {
      inJobs = false
      continue
    }

    const jobKey = /^\s{2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (jobKey) {
      currentJob = { name: jobKey[1], runsOn: null, shell: null, runs: [] }
      jobs[jobKey[1]] = currentJob
      continue
    }
    if (!currentJob) continue

    const runsOn = /^\s{4}runs-on:\s*(.+?)\s*$/.exec(line)
    if (runsOn) currentJob.runsOn = runsOn[1].replace(/^['"]|['"]$/g, '')
    // `shell:` at step level (six spaces, inside a `- uses:`/`- name:` item).
    const shell = /^\s{8}shell:\s*(.+?)\s*$/.exec(line)
    if (shell) currentJob.shell = shell[1].replace(/^['"]|['"]$/g, '')

    if (/^\s{8}run:\s*\|\s*$/.test(line)) {
      currentRun = { lines: [] }
      currentJob.runs.push(currentRun)
      runIndent = indent
      continue
    }
    const inlineRun = /^\s{8}run:\s*(.+?)\s*$/.exec(line)
    if (inlineRun) currentJob.runs.push({ lines: [inlineRun[1]] })
  }

  return jobs
}

function isWindowsJob(job) {
  return /windows/i.test(job.runsOn ?? '')
}

function parseAllWorkflows() {
  const result = []
  for (const file of readdirSync(WORKFLOWS).filter(name => name.endsWith('.yml'))) {
    const text = readFileSync(path.join(WORKFLOWS, file), 'utf8')
    result.push({ file, jobs: parseJobs(text) })
  }
  return result
}

test('the reader finds the Windows GUI job it is meant to police', () => {
  const workflows = parseAllWorkflows()
  const gui = workflows.find(w => w.file === 'native-gui-e2e.yml')
  assert.ok(gui, 'native-gui-e2e.yml is missing')

  const windows = gui.jobs.windows
  assert.ok(windows, 'the GUI workflow no longer has a `windows` job')
  assert.ok(isWindowsJob(windows), `the windows job runs on ${windows.runsOn}`)
  assert.ok(windows.runs.length > 0, 'the windows job has no run blocks at all')

  const summarise = windows.runs.find(run => run.lines.some(line => line.includes('gui-e2e-report.mjs')))
  assert.ok(summarise, 'the summarise step is gone; update this guard if that is intentional')
})

test('no Windows job continues a line with a backslash', () => {
  const offenders = []
  for (const { file, jobs } of parseAllWorkflows()) {
    for (const job of Object.values(jobs)) {
      if (!isWindowsJob(job) || job.shell === 'bash') continue
      for (const run of job.runs) {
        run.lines.forEach((line, index) => {
          if (/\\\s*$/.test(line)) {
            offenders.push(`${file} job=${job.name} line=${index + 1}: ${line.trim()}`)
          }
        })
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `PowerShell has no backslash line continuation; put the command on one line or use a here-string:\n${offenders.join('\n')}`,
  )
})

test('no Windows job runs a POSIX-only command', () => {
  const offenders = []
  for (const { file, jobs } of parseAllWorkflows()) {
    for (const job of Object.values(jobs)) {
      if (!isWindowsJob(job) || job.shell === 'bash') continue
      for (const run of job.runs) {
        for (const line of run.lines) {
          const command = line.trim()
          if (command === '' || command.startsWith('#')) continue
          if (POSIX_ONLY.some(pattern => pattern.test(command))) {
            offenders.push(`${file} job=${job.name}: ${command}`)
          }
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `these read as POSIX sh, not PowerShell:\n${offenders.join('\n')}`)
})

test('a Windows job reads environment variables as $env:NAME, never as a bare $NAME', () => {
  // PowerShell resolves `$RUNNER_OS` to an *unset PowerShell variable*, i.e. the empty
  // string — not the GitHub expression `${{ env.RUNNER_OS }}` and not the process env.
  // It is the quietest failure in this file: no error, just a blank argument.
  const offenders = []
  for (const { file, jobs } of parseAllWorkflows()) {
    for (const job of Object.values(jobs)) {
      if (!isWindowsJob(job) || job.shell === 'bash') continue
      for (const run of job.runs) {
        for (const line of run.lines) {
          if (line.trim().startsWith('#')) continue
          // `$env:NAME` is correct; `${{ … }}` is a GitHub expression, not PowerShell.
          const bare = line.replace(/\$env:[A-Za-z_][A-Za-z0-9_]*/g, '').replace(/\$\{\{.*?\}\}/g, '')
          for (const match of bare.matchAll(/\$([A-Z][A-Z0-9_]{2,})\b/g)) {
            if (PS_AUTOMATIC.has(match[1])) continue
            offenders.push(`${file} job=${job.name}: $${match[1]} → use $env:${match[1]}`)
          }
        }
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `bare $NAME in PowerShell is an unset variable, not an environment variable:\n${offenders.join('\n')}`,
  )
})

test('the guard catches the exact step that failed on 00773fa', () => {
  // The real body of the broken step, verbatim. If the guard stops rejecting this,
  // it has stopped guarding — a green test here would then mean nothing.
  const broken = [
    'jobs:',
    '  windows:',
    '    runs-on: windows-latest',
    '    steps:',
    '      - name: Summarise the GUI layer',
    '        run: |',
    '          mkdir -p test-results',
    '          node scripts/gui-e2e-report.mjs \\',
    '            --artifacts e2e/gui/artifacts \\',
    '            --out test-results/gui-e2e.json \\',
    '            --platform "$RUNNER_OS"',
    '',
  ].join('\n')

  const job = parseJobs(broken).windows
  assert.ok(job, 'the sample did not parse as a windows job')
  const body = job.runs.flatMap(run => run.lines)

  assert.ok(body.some(line => /\\\s*$/.test(line)), 'the backslash continuation was not detected')
  assert.ok(body.some(line => POSIX_ONLY.some(p => p.test(line.trim()))), 'mkdir -p was not detected')
  assert.ok(body.some(line => /\$RUNNER_OS\b/.test(line)), 'the bare $RUNNER_OS was not detected')

  // And the fixed form must pass all three checks.
  const fixed = [
    'jobs:',
    '  windows:',
    '    runs-on: windows-latest',
    '    steps:',
    '      - name: Summarise the GUI layer',
    '        run: node scripts/gui-e2e-report.mjs --artifacts e2e/gui/artifacts --out test-results/gui-e2e.json --platform windows',
    '',
  ].join('\n')
  const fixedBody = parseJobs(fixed).windows.runs.flatMap(run => run.lines)
  assert.ok(!fixedBody.some(line => /\\\s*$/.test(line)))
  assert.ok(!fixedBody.some(line => POSIX_ONLY.some(p => p.test(line.trim()))))
  assert.ok(!fixedBody.some(line => /\$RUNNER_OS\b/.test(line)))
})

test('an explicit PowerShell shell is fine; an implicit one is what bites', () => {
  // The point is not "always use bash". It is that a Windows job must either use the
  // default PowerShell *and be written in it*, or name the shell it is speaking. Both
  // `shell: pwsh` and `shell: bash` are explicit and honest; an omitted `shell:` next
  // to POSIX syntax is the combination that failed on 00773fa.
  const allowed = new Set(['pwsh', 'powershell', 'bash'])
  for (const { file, jobs } of parseAllWorkflows()) {
    for (const job of Object.values(jobs)) {
      if (!isWindowsJob(job)) continue
      if (job.shell === null) continue
      assert.ok(
        allowed.has(job.shell),
        `${file} job=${job.name} sets shell=${job.shell}; expected one of ${[...allowed].join(', ')}`,
      )
    }
  }
})
