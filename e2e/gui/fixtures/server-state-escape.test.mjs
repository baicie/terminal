/**
 * Can the fixture's path guard be walked around?
 *
 * ## Why this is worth testing rather than reading
 *
 * `underRoot` does a `path.resolve` containment check, which refuses `..` and absolute
 * paths. That is the right shape for *lexical* escapes — and it is blind to a path that
 * is lexically inside the root but physically elsewhere. A **symbolic link** staged
 * inside the fixture root is exactly that: `root/innocent/link -> /Users/someone` passes
 * `resolve()`, and everything after it — `readdirSync`, `writeFileSync`,
 * `readFileSync` — follows the link.
 *
 * That matters because the writer is the dangerous half. `seedFile()` writes with
 * `mkdirSync(..., {recursive: true})` and `writeFileSync`, so a link whose target is a
 * directory outside the fixture would create and overwrite files in a real user's tree
 * from a test run. The stated rule is "a bug in a spec must not delete a user's file",
 * and a lexical guard alone does not enforce it.
 *
 * ## What this file does
 *
 * Stages the attack in a throwaway directory (never a real home directory), and asks
 * the guard what it does. Each case is a claim the guard must be able to refuse.
 * Cases that cannot be staged on this platform are skipped explicitly rather than
 * silently omitted.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const ROOT_ENV = 'GUI_E2E_REMOTE_ROOT'
const isWindows = process.platform === 'win32'
// `symlinkSync` needs a type on Windows; "junction" works without elevation for dirs.
const DIR_LINK_TYPE = isWindows ? 'junction' : 'dir'

/** A throwaway workspace: `<tmp>/…terminal-gui-sftp-<n>/remote` plus an `outside`. */
function makeWorkspace() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'guard-probe-'))
  // The guard requires the directory name to contain `terminal-gui-sftp-`, which is the
  // fixture's own convention and what keeps a misconfigured env from pointing at a home
  // directory. The probe honours it so the guard is exercised, not bypassed.
  const root = path.join(base, 'terminal-gui-sftp-probe', 'remote')
  const outside = path.join(base, 'outside-the-fixture')
  mkdirSync(root, { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(path.join(outside, 'user-file.txt'), 'a real user file')
  return { base, root, outside, cleanup: () => rmSync(base, { recursive: true, force: true }) }
}

let workspace
let state

beforeEach(async () => {
  workspace = makeWorkspace()
  process.env[ROOT_ENV] = workspace.root
  // Dynamic: the fixture is plain ESM with no build step, and the GUI harness loads
  // this same file. A fresh instance per case keeps a staged link from leaking into
  // the next one — several cases stage the same names deliberately.
  state = await import(`../fixtures/server-state.mjs?case=${workspace.base}`)
})

afterEach(() => {
  delete process.env[ROOT_ENV]
  workspace?.cleanup()
  workspace = null
})

describe('fixture path guard under a staged escape', () => {
  it('refuses a plain relative and absolute escape — the lexical case it was built for', () => {
    assert.throws(() => state.serverEntries('../outside-the-fixture'))
    assert.throws(() => state.serverEntries(workspace.outside))
    assert.throws(() => state.seedFile('../outside-the-fixture/planted.txt', 'x'))
    assert.equal(existsSync(path.join(workspace.outside, 'planted.txt')), false)
  })

  it('refuses a sibling directory whose name shares the root prefix', () => {
    /*
     * `/tmp/x/remote` and `/tmp/x/remote-evil` — a bare `startsWith(root)` accepts both.
     * The guard appends a separator before comparing, which is what this pins.
     */
    const sibling = `${workspace.root}-evil`
    mkdirSync(sibling, { recursive: true })
    assert.equal(state.serverEntry(path.basename(sibling)), null)
    assert.equal(existsSync(sibling), true)
  })

  it('does not follow a symlinked directory out of the root', () => {
    const link = path.join(workspace.root, 'evil-dir')
    symlinkSync(workspace.outside, link, DIR_LINK_TYPE)

    assert.throws(() => state.serverEntries('evil-dir'))
    assert.equal(state.serverEntry('evil-dir/user-file.txt'), null)
    assert.equal(state.readServerFile('evil-dir/user-file.txt'), null)
  })

  it('does not write through a symlinked directory into a real directory', () => {
    /*
     * The writer is the dangerous half. `seedFile` uses `mkdirSync(recursive)` +
     * `writeFileSync`, both of which follow links; without a resolve-and-compare on the
     * *real* path this creates a file in the outside directory.
     */
    const link = path.join(workspace.root, 'evil-write')
    if (!existsSync(link)) symlinkSync(workspace.outside, link, DIR_LINK_TYPE)

    const planted = path.join(workspace.outside, 'planted.txt')
    const attempted = () => state.seedFile('evil-write/planted.txt', 'planted')
    if (existsSync(planted)) rmSync(planted)
    let refused = false
    try {
      attempted()
    } catch {
      refused = true
    }
    // The escape must be refused *and* the outside directory must be untouched.
    assert.equal(existsSync(planted), false, 'the write escaped into the outside directory')
    assert.equal(refused, true, 'the guard did not refuse a symlinked write')
  })

  it('does not follow a symlinked file out of the root', () => {
    const link = path.join(workspace.root, 'evil-file.txt')
    symlinkSync(path.join(workspace.outside, 'user-file.txt'), link, 'file')

    // Reading it would hand the spec a real user's file contents.
    assert.equal(state.readServerFile('evil-file.txt'), null)
    // Overwriting it would destroy that file.
    assert.throws(() => state.seedFile('evil-file.txt', 'clobbered'))
    assert.equal(
      readFileSync(path.join(workspace.outside, 'user-file.txt'), 'utf8'),
      'a real user file',
    )
  })

  it('refuses a dangling link, which existsSync cannot see but a write would follow', () => {
    /*
     * `existsSync` follows the link and answers false for a missing target, so a guard
     * built on it alone reports "not there" — and then `writeFileSync` creates the
     * target wherever the link points. `lstat` is what tells a link from an absence.
     */
    const danglingTarget = path.join(workspace.base, 'not-yet-created')
    const link = path.join(workspace.root, 'dangling')
    if (!existsSync(danglingTarget)) {
      symlinkSync(danglingTarget, link, DIR_LINK_TYPE)
    }

    assert.equal(lstatSync(link).isSymbolicLink(), true)
    assert.throws(() => state.seedFile('dangling/planted.txt', 'planted'))
    assert.equal(existsSync(danglingTarget), false)
  })

  it('refuses a link that points back at the root', () => {
    // Not an escape, but a loop: a spec following it would act on the root twice with
    // no way to tell which listing it is looking at.
    const loop = path.join(workspace.root, 'loop')
    if (!existsSync(loop)) symlinkSync(workspace.root, loop, DIR_LINK_TYPE)
    assert.throws(() => state.serverEntries('loop'))
  })

  it('still does the ordinary thing: a real file inside the root is readable and writable', () => {
    // The guard must not be so strict that the fixture stops working — every write-case
    // assertion in e2e-03 depends on this path.
    state.seedFile('ordinary/hello.txt', 'hello')
    assert.equal(state.serverEntry('ordinary/hello.txt')?.size, 5)
    assert.equal(state.readServerFile('ordinary/hello.txt')?.toString(), 'hello')
    assert.deepEqual(state.serverEntries('ordinary'), ['hello.txt'])
  })

  it('refuses a Windows reparse point (junction) out of the root', { skip: !isWindows }, () => {
    const junction = path.join(workspace.root, 'junction-out')
    symlinkSync(workspace.outside, junction, 'junction')
    assert.throws(() => state.seedFile('junction-out/planted.txt', 'planted'))
    assert.equal(existsSync(path.join(workspace.outside, 'planted.txt')), false)
  })

  it('refuses a read-only directory it cannot write to', { skip: !isWindows }, () => {
    const locked = path.join(workspace.root, 'locked')
    mkdirSync(locked)
    chmodSync(locked, 0o500)
    assert.throws(() => state.seedFile('locked/planted.txt', 'x'))
  })
})
