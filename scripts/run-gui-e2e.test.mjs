// A run that cannot reach a server must not look like a run that checked one.
//
// ## The measurement this exists for
//
// `node scripts/run-gui-e2e.mjs --spec specs/e2e-03-sftp-dock.e2e.mjs` on Node 22.12.0
// reported:
//
//     ✓ creates, renames and deletes a directory on the bound host — verified on the server
//     ✓ navigates into a directory and reports the destination the filesystem has
//     11 passing (1m 17.1s)
//     [gui-e2e] finished with exit 0
//
// and the evidence file for that same run said:
//
//     verdict: PARTIAL      notRunCount: 10      sshFixture: false
//     write case NOT_RUN: no SSH fixture this run
//     navigation case NOT_RUN: no SSH fixture this run
//
// Every remote case had a `return` at the top that recorded NOT_RUN, so **the two
// assertions that run had been built to exercise never executed** — while both cases
// printed a tick. The cause was `node:sqlite`, which the fixture needs to write its
// host row; the message naming it existed, and was written into `fixtureSkipReason` and
// a summary file produced after the suite had already run.
//
// ## Why the fix is at the top of the runner
//
// A per-case NOT_RUN is the right verdict for a run that has no server. What is not
// right is a run that was *supposed* to have one, quietly becoming that run. So the
// check is before the suite starts and it exits non-zero, which means the only way to
// get a green suite is to actually have `node:sqlite` — or to pass `--no-ssh-fixture`,
// which is a deliberate statement that this is a layout-only run.
import assert from 'node:assert/strict'
import process from 'node:process'
import test from 'node:test'

import { sqliteProblem } from './gui-e2e-preconditions.mjs'

test('a Node without node:sqlite is refused, with the version and the error in the text', () => {
  const problem = sqliteProblem(() => {
    throw new Error('No such built-in module: node:sqlite')
  })

  assert.notEqual(problem, null)
  // The version is what tells the reader which runtime they are on; without it the
  // message is a claim about an unnamed thing.
  assert.match(problem, /v\d+\./)
  assert.match(problem, /No such built-in module/)
  // And what to do about it, because "cannot provide node:sqlite" alone is a dead end.
  assert.match(problem, /Node >= 24/)
  assert.match(problem, /--no-ssh-fixture/)
})

test('a Node that has node:sqlite passes, so the guard is not vacuous', () => {
  /*
   * The control. Without it, a `sqliteProblem` that always returned a message would
   * satisfy the case above and make every GUI E2E run impossible — a guard that rejects
   * everything is as broken as one that rejects nothing.
   */
  assert.equal(sqliteProblem(() => ({ DatabaseSync: class {} })), null)
})

test('the guard asks the runtime, it does not pattern-match a version string', () => {
  /*
   * Recorded because the first implementation did the wrong thing here and looked
   * right: it called `process.getBuiltinModule`, which does not exist before Node 22.9,
   * and returned early when it was missing — so on the exact version it was written to
   * catch, it did nothing at all. A version comparison would have the same shape of
   * bug: `--experimental-sqlite` makes the module available on 22.5+, so "major < 24"
   * would reject a Node that works.
   *
   * This asserts the contract instead: the answer comes from trying to resolve.
   */
  let asked = null
  sqliteProblem(name => {
    asked = name
    return {}
  })
  assert.equal(asked, 'node:sqlite')

  /*
   * And the answer must depend on that resolve and nothing else. The node this suite
   * runs on is one of the versions a version-check would special-case, so overriding
   * `process.version` to a value that *would* pass such a check makes the difference
   * observable: a guard that consults the version string answers `null` here, one that
   * asks the runtime still reports the failure.
   */
  const realVersion = process.version
  Object.defineProperty(process, 'version', { value: 'v24.0.0', configurable: true })
  try {
    const problem = sqliteProblem(() => {
      throw new Error('No such built-in module: node:sqlite')
    })
    assert.notEqual(problem, null, 'the guard must not trust the version string')
  } finally {
    Object.defineProperty(process, 'version', { value: realVersion, configurable: true })
  }
})
