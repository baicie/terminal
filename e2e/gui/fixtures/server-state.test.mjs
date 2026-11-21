// The server-state reader, checked against a real directory.
//
// ## The defect this exists for
//
// `e2e-03`'s write case is titled "creates, renames and deletes a directory on the
// bound host — verified on the server". It was verified against
// `document.querySelectorAll('[data-testid="file-row"]')`: the pane's own rendering of
// the listing the pane just fetched. A mkdir into the wrong directory, a rename the
// server refused, a delete that removed nothing — all three leave that DOM looking
// right as soon as the optimistic refresh lands.
//
// Reading the fixture's directory from Node fixes that, but only if the reader is
// correct. A `underRoot` that let `..` through would read — or, for the seeding half,
// *write* — outside the fixture, and a reader that silently returned `[]` for a
// missing directory would be indistinguishable from "the product created nothing".
// Both are worse than the original problem because they look independent.
//
// So this file tests the reader itself: the escape guard, the missing-directory
// behaviour, and the round trip the spec relies on.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test, { afterEach, beforeEach } from 'node:test'

import {
  readServerFile,
  remoteRoot,
  seedFile,
  selfCheck,
  serverEntries,
  serverEntry,
} from './server-state.mjs'

const ORIGINAL = process.env.GUI_E2E_REMOTE_ROOT
let workspace = null

/**
 * A directory named the way the real fixture names its own.
 *
 * `remoteRoot` refuses any path that does not contain `terminal-gui-sftp-`, which is
 * how it distinguishes a fixture directory from a home directory. The prefix here is
 * the same `mkdtemp` prefix `seed-sftp-host.mjs` uses.
 */
function fixtureWorkspace() {
  const base = mkdtempSync(path.join(tmpdir(), 'terminal-gui-sftp-'))
  const root = path.join(base, 'remote')
  mkdirSync(root, { recursive: true })
  return { base, root }
}

beforeEach(() => {
  workspace = fixtureWorkspace()
  process.env.GUI_E2E_REMOTE_ROOT = workspace.root
})

afterEach(() => {
  if (workspace !== null) rmSync(workspace.base, { recursive: true, force: true })
  workspace = null
  if (ORIGINAL === undefined) delete process.env.GUI_E2E_REMOTE_ROOT
  else process.env.GUI_E2E_REMOTE_ROOT = ORIGINAL
})

test('reads the server directory, sorted', () => {
  writeFileSync(path.join(workspace.root, 'b.txt'), 'b')
  writeFileSync(path.join(workspace.root, 'a.txt'), 'a')
  mkdirSync(path.join(workspace.root, 'dir'))

  assert.deepEqual(serverEntries(), ['a.txt', 'b.txt', 'dir'])
})

test('a missing directory throws rather than reading as empty', () => {
  /*
   * The distinction the whole case turns on. `[]` here would make "the fixture set up
   * the wrong directory" look exactly like "the product created nothing", and the spec
   * would report a product failure for a harness bug — or, worse, the reverse.
   */
  assert.throws(() => serverEntries('no-such-dir'), /ENOENT/)
})

test('the escape guard rejects a relative escape', () => {
  assert.equal(serverEntry('../etc'), null)
  assert.throws(() => serverEntries('../etc'), /outside/)
})

test('the escape guard rejects an absolute path', () => {
  assert.equal(serverEntry('/etc'), null)
  assert.throws(() => serverEntries('/etc'), /outside/)
})

test('the escape guard rejects a sibling that shares the root as a prefix', () => {
  /*
   * `startsWith(root)` without a separator would accept `/tmp/…/remote-evil`. This is
   * the shape a naive prefix check has, and it is one character away from correct.
   */
  const sibling = `${workspace.root}-evil`
  mkdirSync(sibling)
  try {
    assert.throws(() => serverEntries(`../${path.basename(sibling)}`), /outside/)
  } finally {
    rmSync(sibling, { recursive: true, force: true })
  }
})

test('a read-only fixture run reports null instead of pretending', () => {
  // No fixture: every helper answers "nothing", and `selfCheck` says why.
  delete process.env.GUI_E2E_REMOTE_ROOT
  assert.equal(remoteRoot(), null)
  assert.equal(serverEntry('anything'), null)
  assert.equal(readServerFile('anything'), null)
  const check = selfCheck()
  assert.equal(check.ok, false)
  assert.match(check.reason, /no fixture/)
})

test('a directory outside the fixture naming scheme is refused', () => {
  /*
   * The check that keeps a stray `GUI_E2E_REMOTE_ROOT` from pointing the spec at a home
   * directory. The fixture always creates `terminal-gui-sftp-*`; nothing else is
   * accepted, so a typo fails closed.
   */
  process.env.GUI_E2E_REMOTE_ROOT = tmpdir()
  assert.equal(remoteRoot(), null)
})

test('seeding and reading back a file round-trips the bytes', () => {
  seedFile('nested/dir/payload.bin', 'the exact bytes')
  assert.equal(readServerFile('nested/dir/payload.bin').toString(), 'the exact bytes')
  assert.deepEqual(serverEntries('nested/dir'), ['payload.bin'])
})

test('seeding outside the root is refused', () => {
  assert.throws(() => seedFile('../escape.txt', 'x'), /outside/)
})

test('selfCheck passes on a real fixture directory', () => {
  const check = selfCheck()
  assert.equal(check.ok, true, check.reason)
})
