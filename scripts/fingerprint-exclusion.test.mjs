// Issue #72 — the source fingerprint must cover what a build actually contains.
//
// ## The defect
//
// `FINGERPRINT_PATHS` covers all of `packages/frontend/src` and `src-tauri/src`,
// and the collector walked every file underneath. So editing
// `src-tauri/src/sftp_download_tests.rs` — a `#[cfg(test)]` module that never
// enters a product binary — invalidated all six acceptance evidence files.
// Measured: real-machine matrix run 43620195705 succeeded on `6be74f0c` with
// fingerprint `d1d83f6b…`; the only source change after it was a two-line
// clippy fix in that test module (`85daf18`), yet the gate reported a mismatch
// against `195672e8…`.
//
// ## Why these tests drive the real tree
//
// The exclusion rules are only worth anything if they classify the files this
// repository actually has. A hand-built fixture directory would agree with
// whatever rules I wrote next to it. So every case here hashes the real
// `FINGERPRINT_PATHS` closure once, then re-hashes it with **one file's
// contents replaced in memory** and asserts whether the digest moved. That is
// the property that matters — "does editing this file invalidate the
// evidence?" — asked of the real file.
//
// The `stat`/`readdir` shims below forward to the real filesystem, so a new file
// appearing in the tree changes what the closure contains exactly as it would in
// production.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import {
  computeSourceFingerprint,
  findTestModuleFiles,
  isTestSource,
} from './check-verification-evidence.mjs'

const projectRoot = path.resolve(import.meta.dirname, '..')

/** The real filesystem, with one file's bytes replaced. */
function withChangedFile(target, bytes) {
  const wanted = path.resolve(projectRoot, target)
  return {
    readdir,
    stat,
    async readFile(file) {
      if (path.resolve(file) === wanted) return Buffer.from(bytes)
      return readFile(file)
    },
  }
}

/** The real filesystem, unchanged. */
const real = { readdir, stat, readFile }

/**
 * Does editing `target` change the fingerprint?
 *
 * Appends a byte rather than rewording, so the case is the smallest possible
 * edit — the same shape as the two-line clippy fix that broke the gate.
 */
async function changesFingerprint(target) {
  const before = await computeSourceFingerprint(real)
  const after = await computeSourceFingerprint(
    withChangedFile(target, '// an edit that could change a measurement\n'),
  )
  return before !== after
}

test('the Rust test modules in this crate are found structurally, not by name', async () => {
  const modules = await findTestModuleFiles(['src-tauri/src'], real)

  // Named by the `#[path]` declaration inside a production file. `tests.rs` has
  // no `_tests` suffix, so a name-only rule would miss it — and it is one of the
  // largest test files in the crate (39 import tests).
  assert.ok(
    modules.has('src-tauri/src/db_import/tests.rs'),
    `expected the db_import test module to be discovered, got ${[...modules].sort().join(', ')}`,
  )
  // Named by `#[path = "manager_tests.rs"]` in `session/manager.rs`.
  assert.ok(modules.has('src-tauri/src/session/manager_tests.rs'))
  // Declared from `lib.rs` without `#[path]`, so the file is the module name.
  assert.ok(modules.has('src-tauri/src/sftp_download_tests.rs'))
  assert.ok(modules.has('src-tauri/src/sftp_command_e2e_tests.rs'))
  // A production module must never be classified as a test module.
  assert.equal(modules.has('src-tauri/src/sftp_download.rs'), false)
  assert.equal(modules.has('src-tauri/src/sftp.rs'), false)
})

test('editing a Rust test module does not change the fingerprint', async () => {
  // The exact case from the issue: a clippy fix in this file invalidated every
  // evidence file even though it cannot reach the product binary.
  assert.equal(await changesFingerprint('src-tauri/src/sftp_download_tests.rs'), false)
  // Discovered by `#[cfg(test)]`, not by the suffix: proves the structural rule
  // carries its own weight rather than duplicating the name rule.
  assert.equal(await changesFingerprint('src-tauri/src/db_import/tests.rs'), false)
  assert.equal(await changesFingerprint('src-tauri/src/session/manager_tests.rs'), false)
})

test('editing a production Rust source changes the fingerprint', async () => {
  assert.equal(await changesFingerprint('src-tauri/src/sftp_download.rs'), true)
  // A file that has its own inline `#[cfg(test)] mod tests { … }` block is still
  // a production file: the non-test half of it is compiled into the binary.
  assert.equal(await changesFingerprint('src-tauri/src/sftp.rs'), true)
})

test('editing a Tauri command module changes the fingerprint', async () => {
  // `commands.rs` holds the `#[tauri::command]` surface the product exposes.
  assert.equal(await changesFingerprint('src-tauri/src/commands.rs'), true)
  assert.equal(await changesFingerprint('src-tauri/src/lib.rs'), true)
})

test('editing frontend test files does not change the fingerprint', async () => {
  assert.equal(
    await changesFingerprint('packages/frontend/src/service/sftp-session-claim.test.ts'),
    false,
  )
  assert.equal(
    await changesFingerprint('packages/frontend/src/components/host-list/host-dialog.test.tsx'),
    false,
  )
  // Only reachable from `vitest.config.ts`'s `setupFiles`, so it is test-only
  // despite the name giving no hint of it.
  assert.equal(await changesFingerprint('packages/frontend/src/test-setup.ts'), false)
})

test('editing a frontend production source changes the fingerprint', async () => {
  assert.equal(
    await changesFingerprint('packages/frontend/src/service/sftp-session-claim.ts'),
    true,
  )
  assert.equal(await changesFingerprint('packages/frontend/src/App.tsx'), true)
})

test('a file named *-test that the router mounts is not treated as a test', async () => {
  // The boundary the name rule gets wrong. `router/nav-config.tsx` mounts these
  // as real routes, so they are in the bundle and a change to one can change
  // what the acceptance run measures.
  assert.equal(isTestSource('packages/frontend/src/experiments/textarea-test.tsx'), false)
  assert.equal(isTestSource('packages/frontend/src/experiments/xterm-test.tsx'), false)
  assert.equal(await changesFingerprint('packages/frontend/src/experiments/textarea-test.tsx'), true)

  // The probe the input acceptance scenarios drive lives in the same directory.
  assert.equal(
    isTestSource('packages/frontend/src/experiments/terminal-input-probe/index.tsx'),
    false,
  )
})

test('editing a build configuration changes the fingerprint', async () => {
  for (const config of [
    'src-tauri/Cargo.toml',
    'src-tauri/build.rs',
    'src-tauri/tauri.conf.json',
    'packages/frontend/vite.config.ts',
    'packages/frontend/package.json',
    'package.json',
    'pnpm-lock.yaml',
  ]) {
    assert.equal(await changesFingerprint(config), true, `${config} must be hashed`)
  }
})

test('editing a real smoke or probe runner changes the fingerprint', async () => {
  // These are not product sources but they *are* the measuring instrument, so a
  // change to one can change a recorded number. Excluding "anything that looks
  // like a test" would have taken them with it.
  for (const runner of [
    'scripts/run-remote-cold-start-stopwatch.mjs',
    'scripts/terminal-smoke-sshd.mjs',
    'scripts/run-terminal-shell-probe.mjs',
    '.github/workflows/real-machine-matrix.yml',
  ]) {
    assert.equal(await changesFingerprint(runner), true, `${runner} must be hashed`)
  }
})

test('editing the fingerprint algorithm itself changes the fingerprint', async () => {
  // The gate is in `FINGERPRINT_PATHS` on purpose: a change to the rules must
  // invalidate the evidence produced under the old rules, otherwise a weaker
  // algorithm could be swapped in without the evidence noticing.
  assert.equal(await changesFingerprint('scripts/check-verification-evidence.mjs'), true)
  assert.equal(await changesFingerprint('scripts/build-verification-evidence.mjs'), true)
  assert.equal(await changesFingerprint('scripts/fetch-verification-evidence.mjs'), true)
})

test('an unrecognised file type under src-tauri/src throws instead of passing silently', async () => {
  // Fail-closed: a new `build.rs`-adjacent artefact with an extension these
  // rules do not know would otherwise be admitted or dropped without anyone
  // deciding which.
  assert.throws(
    () => isTestSource('src-tauri/src/probe.bin'),
    /src-tauri\/src but is not a Rust source file/,
  )
  // The listed `src-tauri` roots that are not Rust (capabilities JSON) are
  // hand-listed and therefore hashed, not rejected.
  assert.equal(isTestSource('src-tauri/capabilities/default.json'), false)
})

test('the exclusion does not depend on a directory being named after tests', async () => {
  // `__tests__` is a convention this repo does not use, and adding it to an
  // ignore list would be the "exclude by directory name" failure the issue warns
  // about: a real source file in such a directory would vanish from the hash.
  assert.equal(isTestSource('packages/frontend/src/view/__tests__/helper.ts'), false)
  assert.equal(isTestSource('packages/frontend/src/fixtures/sample.ts'), false)
})
