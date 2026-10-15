import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import path from 'node:path'

const workflowPath = path.resolve(
  import.meta.dirname,
  '../.github/workflows/real-machine-matrix.yml',
)

async function readWorkflow() {
  return readFile(workflowPath, 'utf8')
}

test('real-machine jobs pin Node and do not depend on a version file', async () => {
  const workflow = await readWorkflow()
  const setupNodeBlocks = workflow.match(
    /- uses: actions\/setup-node@v4[\s\S]*?(?=\n      - uses:|\n      - run:|\n\s*$)/g,
  )

  // One per job: macOS, Linux and Windows.
  assert.equal(setupNodeBlocks?.length, 3)
  for (const block of setupNodeBlocks) {
    assert.match(block, /node-version:\s*24\.16\.0/)
    assert.doesNotMatch(block, /node-version-file:/)
  }
})

test('real-machine workflow keeps the complete SSH matrix split by fixture', async () => {
  const workflow = await readWorkflow()
  assert.match(
    workflow,
    /run: node scripts\/run-terminal-smoke-matrix\.mjs key,key-reconnect,key-outage-reconnect,key-outage-wake-reconnect,agent,agent-reconnect,cert,cert-reconnect,jump,jump-reconnect/,
  )
  assert.match(
    workflow,
    /xvfb-run -a node scripts\/run-terminal-smoke-matrix\.mjs password,password-reconnect/,
  )
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /schedule:/)
})

test('macOS real-machine job runs the shell interaction matrix', async () => {
  const workflow = await readWorkflow()
  assert.match(
    workflow,
    /run: pnpm smoke:shell-probe:matrix -- cat-eof,readline-history,readline-tab,vim-edit,nano-edit,pty-resize,ctrl-c-interrupt/,
  )
  // The same cases over a real sshd: a PTY-only matrix would leave PTY
  // request, window-size propagation and signal delivery unproven.
  assert.match(
    workflow,
    /run: pnpm smoke:shell-probe:matrix -- --transport ssh cat-eof,readline-history,readline-tab,vim-edit,nano-edit,pty-resize,ctrl-c-interrupt/,
  )
})

test('macOS real-machine job measures remote prompt cold-start', async () => {
  const workflow = await readWorkflow()
  assert.match(workflow, /name: Measure remote SSH cold-start to prompt marker/)
  assert.match(
    workflow,
    /pnpm smoke:remote-cold-start -- \\\s+--app-path "\$GITHUB_WORKSPACE\/src-tauri\/target\/debug\/terminal"/,
  )
})

test('Linux real-machine job runs the daily shell matrix and remote prompt probe', async () => {
  const workflow = await readWorkflow()
  assert.match(
    workflow,
    /apt-get install -y --no-install-recommends[\s\S]*openssh-server[\s\\]*\\\n\s+bash[\s\\]*\\\n\s+zsh[\s\\]*\\\n\s+vim[\s\\]*\\\n\s+nano/,
    'every shell and interactive editor used by the Linux matrix must be installed first',
  )
  assert.match(
    workflow,
    /xvfb-run -a pnpm smoke:shell-probe:matrix -- --shells bash,zsh cat-eof,readline-history,readline-tab,vim-edit,nano-edit,pty-resize,ctrl-c-interrupt/,
  )
  assert.match(workflow, /name: Measure Linux remote SSH cold-start to prompt marker/)
  assert.match(
    workflow,
    /xvfb-run -a pnpm smoke:remote-cold-start -- \\\s+--app-path "\$GITHUB_WORKSPACE\/src-tauri\/target\/debug\/terminal"/,
  )
})

test('Windows real-machine job runs the PowerShell and cmd dialects', async () => {
  const workflow = await readWorkflow()
  assert.match(workflow, /windows-shell-matrix:[\s\S]*runs-on: windows-latest/)
  // Both Windows dialects need a real ConPTY: neither command language can be
  // exercised on a POSIX runner, so without this job they would ship untested.
  assert.match(
    workflow,
    /--shells powershell cat-eof,pty-resize,ctrl-c-interrupt/,
  )
  assert.match(workflow, /--shells cmd cat-eof,ctrl-c-interrupt/)
  // The job has to install dependencies and get a Rust toolchain, otherwise it
  // fails at the first matrix step for reasons that have nothing to do with
  // the dialects it exists to prove.
  assert.match(workflow, /windows-shell-matrix:[\s\S]*pnpm install --frozen-lockfile/)
  assert.match(workflow, /windows-shell-matrix:[\s\S]*dtolnay\/rust-toolchain@stable/)
})

test('Windows job case filters are derived from the dialect table, not restated', async () => {
  // The workflow can only pass a case the dialect claims; the runner rejects
  // anything else rather than quietly reporting a smaller run. That makes the
  // workflow's filters a mirror of DIALECT_CASES, and a mirror restated by hand
  // drifts the moment someone adds a case to one dialect and not the other --
  // the job would then fail on a runner instead of here. Deriving the
  // expectation from the source of truth keeps the two from diverging.
  const dialectCases = await readFile(
    path.resolve(
      import.meta.dirname,
      '../packages/frontend/src/experiments/terminal-shell-probe/dialect-cases.ts',
    ),
    'utf8',
  )
  const claimed = name => {
    const block = dialectCases.match(new RegExp(`${name}:\\s*\\[([^\\]]*)\\]`))
    assert.ok(block, `${name} dialect cases should be declared`)
    return block[1]
      .split(',')
      .map(entry => entry.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
  }

  const workflow = await readWorkflow()
  for (const [shell, dialect] of [
    ['powershell', 'powershell'],
    ['cmd', 'cmd'],
  ]) {
    const expected = claimed(dialect).join(',')
    assert.ok(
      workflow.includes(`--shells ${shell} ${expected}`),
      `workflow should request exactly the cases ${dialect} claims: ${expected}`,
    )
  }

  // The POSIX list is restated a third time by the matrix runner's own CASES
  // constant, which is what a workflow step without an explicit case list
  // falls back to. Three copies of one list is two chances to drift silently,
  // so the POSIX dialect is checked against the runner as well.
  const matrixRunner = await readFile(
    path.resolve(import.meta.dirname, 'run-terminal-shell-probe-matrix.mjs'),
    'utf8',
  )
  const runnerCases = matrixRunner
    .match(/const CASES = \[([^\]]*)\]/)?.[1]
    ?.split(',')
    .map(entry => entry.trim().replace(/^'|'$/g, ''))
    .filter(Boolean)
  assert.deepEqual(
    runnerCases,
    claimed('posix'),
    'the runner default case list should match the POSIX dialect cases',
  )
})
