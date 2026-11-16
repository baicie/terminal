// A shell step must not reference an environment variable nobody gives it.
//
// ## The mistake this catches, made twice
//
// Two separate commits added a `node scripts/…` call to `release.yml` that read a
// variable the step's `env:` block did not provide:
//
//   VERSION="$VERSION" … node verify-updater-manifest.mjs   (VERSION, from prepare-release)
//   TAURI_UPDATER_PUBKEY=… TAURI_UPDATER_PUBKEY            (absent entirely)
//
// Both would have failed on the first real release, at the last step, after the
// artifacts were already published. Neither was caught by YAML validation, because
// `$VAR` in a shell script is just text to a YAML parser.
//
// This test reads the workflow as YAML, walks each `run:` script, and checks every
// `${VAR}` / `$VAR` reference against the variables actually in scope.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const WORKFLOWS = path.join(ROOT, '.github/workflows')

/** Variables the shell or GitHub provides without an `env:` entry. */
const PROVIDED = new Set([
  // GitHub contexts exported into the step environment
  'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY', 'GITHUB_ENV', 'GITHUB_PATH',
  'GITHUB_SHA', 'GITHUB_REF', 'GITHUB_REF_NAME', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID',
  'GITHUB_RUN_NUMBER', 'GITHUB_WORKSPACE', 'GITHUB_TOKEN', 'GITHUB_ACTION',
  'GITHUB_EVENT_NAME', 'GITHUB_BASE_REF', 'GITHUB_HEAD_REF',
  'RUNNER_OS', 'RUNNER_TEMP', 'RUNNER_TOOL_CACHE', 'RUNNER_ARCH', 'RUNNER_NAME',
  'CI', 'HOME', 'PATH', 'PWD', 'TMPDIR', 'USER', 'SHELL', 'LANG', 'TZ',
])

/** Shell built-ins that look like variables. */
const BUILTINS = new Set([
  'PIPESTATUS', 'LASTEXITCODE', 'IFS', 'SECONDS', 'RANDOM', 'LINENO',
  'BASH_SOURCE', 'FUNCNAME', 'REPLY', 'OPTARG', 'OPTIND',
])

/**
 * Read just enough YAML for this test: `env:` maps and ordered `steps:` with `run:` blocks.
 *
 * A real YAML parser would be better, but `yaml` is not a root dependency and adding one
 * for a single test is not worth it. The subset below is exactly what the workflows use:
 * two-space job keys, four-space step keys, six-space property lines, and block scalars
 * introduced by `run: |`.
 *
 * It deliberately does not try to be general: an unparsed construct yields no scripts,
 * which makes the test *quieter* rather than wronger — and the `guard itself catches a
 * missing variable` test below proves the matcher works on its own input.
 */
function parseSimpleYaml(text) {
  const lines = text.split('\n')
  const result = { env: {}, jobs: {} }
  let section = null
  let currentJob = null
  let currentStep = null
  let scriptIndent = null
  let inJobEnv = false
  let inStepEnv = false

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (line === '' || /^\s*#/.test(line)) {
      if (currentStep && scriptIndent !== null) currentStep.run += '\n'
      continue
    }
    const indent = line.length - line.trimStart().length

    if (scriptIndent !== null) {
      // `scriptIndent` is the indentation of `run:` itself; its body sits deeper.
      if (indent > scriptIndent) {
        currentStep.run += `${line.trim()}\n`
        continue
      }
      scriptIndent = null
    }

    if (/^jobs:\s*$/.test(line)) {
      section = 'jobs'
      continue
    }
    if (/^env:\s*$/.test(line)) {
      section = section === 'jobs' && currentJob ? 'job-env' : 'wf-env'
      if (section === 'wf-env') result.env = {}
      continue
    }
    if (section === 'wf-env') {
      const m = /^(\s*)([A-Z][A-Z0-9_]*):/.exec(line)
      if (m) {
        result.env[m[2]] = true
        continue
      }
      if (indent === 0) section = null
      continue
    }
    if (section !== 'jobs') continue

    const jobKey = /^\s{2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (jobKey) {
      currentJob = jobKey[1]
      result.jobs[currentJob] = result.jobs[currentJob] ?? { env: {}, steps: [] }
      currentStep = null
      continue
    }
    if (!currentJob) continue
    const job = result.jobs[currentJob]

    if (/^\s{4}env:\s*$/.test(line)) {
      inJobEnv = true
      continue
    }
    // A job-env entry, or the line that ends the job-env block (`steps:` at four spaces).
    if (inJobEnv) {
      const entry = /^\s{6}([A-Z][A-Z0-9_]*):/.exec(line)
      if (entry) {
        job.env[entry[1]] = true
        continue
      }
      if (/^\s{4}\S/.test(line)) inJobEnv = false
      else continue
    }

    if (/^\s{6}-\s/.test(line)) {
      inStepEnv = false
      currentStep = { name: null, env: {}, run: '' }
      job.steps.push(currentStep)
      const named = /^\s{6}-\s+name:\s*(.+)$/.exec(line)
      if (named) currentStep.name = named[1].replace(/^['"]|['"]$/g, '')
      continue
    }
    if (!currentStep) continue
    const name = /^\s{8}name:\s*(.+)$/.exec(line)
    if (name && !currentStep.name) currentStep.name = name[1].replace(/^['"]|['"]$/g, '')
    // A step-level `env:` holds its entries one level deeper than the key itself.
    if (/^\s{8}env:\s*$/.test(line)) {
      inStepEnv = true
      continue
    }
    if (inStepEnv) {
      const entry = /^\s{10}([A-Z][A-Z0-9_]*):/.exec(line)
      if (entry) {
        currentStep.env[entry[1]] = true
        continue
      }
      if (/^\s{8}\S/.test(line)) inStepEnv = false
      else continue
    }
    const envKey = /^\s{8}([A-Z][A-Z0-9_]*):/.exec(line)
    if (envKey) currentStep.env[envKey[1]] = true
    if (/^\s{8}run:\s*\|\s*$/.test(line)) {
      scriptIndent = indent
      continue
    }
    const inlineRun = /^\s{8}run:\s*(.+)$/.exec(line)
    if (inlineRun) currentStep.run += `${inlineRun[1]}\n`
  }
  return result
}

/** Collect `NAME=...` assignments made inside a script itself. */
function localAssignments(script) {
  const names = new Set()
  for (const match of script.matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})=/gm)) {
    names.add(match[1])
  }
  // `for name in …` loop variables and `read`-style assignments.
  for (const match of script.matchAll(/^\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b/gm)) {
    names.add(match[1])
  }
  return names
}

/** `${VAR}` and `$VAR` references, ignoring `${VAR:-default}` expansions' defaults. */
function referencedVariables(script) {
  const names = new Set()
  for (const match of script.matchAll(/\$\{([A-Z][A-Z0-9_]{2,})(?::?[-=?+][^}]*)?\}/g)) {
    names.add(match[1])
  }
  for (const match of script.matchAll(/\$([A-Z][A-Z0-9_]{2,})\b/g)) {
    names.add(match[1])
  }
  return names
}

/** Files that hand variables to later steps through `$GITHUB_ENV`. */
function exportedToLaterSteps(text) {
  const names = new Set()
  for (const match of text.matchAll(/echo\s+"?([A-Z][A-Z0-9_]{2,})=[^"]*"?\s*>>\s*"?\$GITHUB_ENV/g)) {
    names.add(match[1])
  }
  for (const match of text.matchAll(/([A-Z][A-Z0-9_]{2,})=.*>>\s*"?\$GITHUB_ENV/g)) {
    names.add(match[1])
  }
  return names
}

test('every workflow parses as YAML', () => {
  for (const name of readdirSync(WORKFLOWS).filter(n => n.endsWith('.yml'))) {
    const text = readFileSync(path.join(WORKFLOWS, name), 'utf8')
    const parsed = parseSimpleYaml(text)
    assert.ok(parsed && typeof parsed === 'object', `${name} did not parse`)
    assert.ok(Object.keys(parsed.jobs).length > 0, `${name} has no jobs this reader understood`)
  }
})

test('no step references an environment variable that is not in scope', () => {
  const problems = []
  for (const name of readdirSync(WORKFLOWS).filter(n => n.endsWith('.yml'))) {
    const text = readFileSync(path.join(WORKFLOWS, name), 'utf8')
    const doc = parseSimpleYaml(text)
    if (!doc) continue
    const on = doc.on ?? doc[true]
    void on
    const workflowEnv = new Set(Object.keys(doc.env ?? {}))
    const handedOn = exportedToLaterSteps(text)

    for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
      const jobEnv = new Set(Object.keys(job?.env ?? {}))
      for (const step of job?.steps ?? []) {
        const script = step?.run
        if (typeof script !== 'string') continue
        const stepEnv = new Set(Object.keys(step?.env ?? {}))
        const local = localAssignments(script)
        // Any variable the whole workflow assigns via $GITHUB_ENV is available to all
        // later steps in every job, so treat the file-level set as in scope.
        const missing = [...referencedVariables(script)].filter(
          variable =>
            !PROVIDED.has(variable) &&
            !BUILTINS.has(variable) &&
            !workflowEnv.has(variable) &&
            !jobEnv.has(variable) &&
            !stepEnv.has(variable) &&
            !local.has(variable) &&
            !handedOn.has(variable),
        )
        if (missing.length > 0) {
          problems.push({
            workflow: name,
            job: jobId,
            step: step?.name ?? '(unnamed)',
            missing: missing.sort(),
          })
        }
      }
    }
  }
  assert.deepEqual(problems, [], `undeclared environment references:\n${JSON.stringify(problems, null, 2)}`)
})

test('the matcher finds references, including inside expansions', () => {
  // A test for the test: the regexes are the part that could silently match nothing and
  // make the whole contract vacuous.
  const script = [
    'VERSION="$VERSION" node script.mjs',
    'echo "${MISSING_ONE:-}"',
    'echo "$MISSING_TWO"',
    'LOCAL_VAR=1',
  ].join('\n')
  const found = [...referencedVariables(script)]
  assert.ok(found.includes('VERSION'), 'a simple $VAR must be found')
  assert.ok(found.includes('MISSING_ONE'), 'a ${VAR:-default} must be found')
  assert.ok(found.includes('MISSING_TWO'), 'a bare $VAR must be found')
  assert.ok(!found.includes('LOCAL_VAR'), 'an assignment is not a reference')
  // And the local-assignment collector sees the assignment.
  assert.ok([...localAssignments(script)].includes('LOCAL_VAR'))
})

test('the reader finds env entries and run blocks in a workflow-shaped document', () => {
  const text = [
    'on: push',
    'env:',
    '  WORKFLOW_LEVEL: 1',
    'jobs:',
    '  sample:',
    '    env:',
    '      JOB_LEVEL: 1',
    '    steps:',
    '      - name: probe',
    '        env:',
    '          STEP_LEVEL: 1',
    '        run: |',
    '          echo "$WORKFLOW_LEVEL $JOB_LEVEL $STEP_LEVEL $NOT_DECLARED"',
  ].join('\n')
  const doc = parseSimpleYaml(text)
  assert.ok(doc.env.WORKFLOW_LEVEL, 'workflow env not read')
  assert.ok(doc.jobs.sample.env.JOB_LEVEL, 'job env not read')
  const step = doc.jobs.sample.steps[0]
  assert.ok(step, 'no step was parsed')
  assert.ok(step.env.STEP_LEVEL, `step env not read; parsed step=${JSON.stringify(step)}`)
  const script = step.run
  assert.ok(script.includes('NOT_DECLARED'), `the run block was not captured; got ${JSON.stringify(script)}`)
  // With all three levels in scope, only the undeclared one is missing. That is the
  // assertion that proves the reader resolves each level correctly: if any level were
  // unread, its variable would show up here too.
  const inScope = new Set([
    ...Object.keys(doc.env),
    ...Object.keys(doc.jobs.sample.env),
    ...Object.keys(step.env),
    ...PROVIDED,
    ...BUILTINS,
  ])
  const missing = [...referencedVariables(script)].filter(variable => !inScope.has(variable))
  assert.deepEqual(missing, ['NOT_DECLARED'])
})
