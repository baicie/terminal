import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AUDIT_COMMAND,
  CRATE_DIR,
  collectTrees,
  runCargo,
  verifyAbsent,
} from './security-ledger-cargo.mjs'

// A stub cargo: records the argv it was handed and replies from a table, so the
// command construction is asserted without a toolchain.
function fakeCargo(replies) {
  const calls = []
  const exec = (args, cwd) => {
    calls.push({ args, cwd })
    const key = args.join(' ')
    const reply = replies[key]
    if (reply === undefined) throw new Error(`unexpected cargo invocation: ${key}`)
    if (reply instanceof Error) throw reply
    return reply
  }
  return { exec, calls }
}

const NORMAL = 'tree --prefix none --edges normal --target all'
const ALL = 'tree --prefix none --edges all --target all'

test('both dumps are taken with --target all', () => {
  const { exec, calls } = fakeCargo({ [NORMAL]: 'a v1.0.0\n', [ALL]: 'a v1.0.0\n' })
  const trees = collectTrees('/crate', exec)

  assert.equal(trees.normalTree, 'a v1.0.0\n')
  assert.equal(trees.allTree, 'a v1.0.0\n')
  // Without --target all, cargo tree hides crates that only build elsewhere and
  // a Windows-only dependency would be scored absent on a macOS run.
  for (const call of calls) {
    assert.ok(call.args.includes('--target'))
    assert.ok(call.args.includes('all'))
    assert.equal(call.cwd, '/crate')
  }
})

test('a cargo failure propagates instead of becoming an empty tree', () => {
  const boom = new Error('error: failed to load Cargo.lock')
  boom.stdout = ''
  const { exec } = fakeCargo({ [NORMAL]: boom, [ALL]: '' })

  // The old sh() returned error.stdout ?? '', so this path produced '' and every
  // advisory was then classified absent-from-build-graph.
  assert.throws(() => collectTrees('/crate', exec), /failed to load Cargo\.lock/)
})

test('the absent probe asks about one exact name@version', () => {
  const key = 'tree --invert quinn-proto@0.11.14 --target all --prefix none'
  const { exec, calls } = fakeCargo({ [key]: '' })

  // Empty stdout means no dependency path: cargo writes its "nothing to print"
  // notice to stderr, which this probe does not read.
  assert.equal(verifyAbsent('quinn-proto', '0.11.14', '/crate', exec), true)
  // Versioned, because a bare name is ambiguous when the lockfile holds two
  // versions and cargo then exits non-zero rather than guessing.
  assert.deepEqual(calls[0].args[2], 'quinn-proto@0.11.14')
})

test('a dependency path found by the probe refutes the absent verdict', () => {
  const key = 'tree --invert russh@0.60.2 --target all --prefix none'
  const { exec } = fakeCargo({
    [key]: 'russh v0.60.2\n└── terminal v0.0.1-dev.2 (/repo/src-tauri)\n',
  })

  assert.equal(verifyAbsent('russh', '0.60.2', '/crate', exec), false)
})

test('the crate directory and audit command are the documented ones', () => {
  assert.ok(CRATE_DIR.endsWith('/src-tauri'))
  // The message the CLI prints when no --input is given has to name a command
  // that actually produces the snapshot.
  assert.match(AUDIT_COMMAND, /cargo audit --json/)
  assert.equal(typeof runCargo, 'function')
})
