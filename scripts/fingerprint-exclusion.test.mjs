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
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  computeSourceFingerprint,
  findTestModuleFiles,
  isTestSource,
} from './check-verification-evidence.mjs'

/** `findTestModuleFiles` over a synthetic crate, with `root` injected. */
function discoverTestModules(root, relativeRoot) {
  return findTestModuleFiles([relativeRoot], { readdir, stat, readFile }, root)
}

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

// ---------------------------------------------------------------------------
// Fail-closed: the fingerprint must never exclude a production file.
//
// The cases above prove the *intent*. These prove the *guarantee*, and they were
// written against defects the first version of this rule had:
//
//   * `findTestModuleFiles` matched its declaration regex against raw source, so
//     `// #[cfg(test)] mod sftp;` in a doc comment excluded `sftp.rs` from the
//     fingerprint — a production edit would have left the evidence looking valid;
//   * the `_tests.rs` suffix alone was treated as proof, so a production file
//     named `production_tests.rs` was silently untracked;
//   * `.spec.*` and `.stories.*` were excluded although `vitest.config.ts`
//     collects only `src/**/*.test.{ts,tsx}` and this repo configures no
//     Storybook — a `.spec.tsx` the router imported would ship in the bundle.
// ---------------------------------------------------------------------------

/** Run `findTestModuleFiles` over a synthetic crate rooted in a temp directory. */
async function discoverIn(files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'fp-crate-'))
  try {
    for (const [relative, contents] of Object.entries(files)) {
      const target = path.join(dir, 'src-tauri', 'src', relative)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, contents)
    }
    return await discoverTestModules(dir, 'src-tauri/src')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('a declaration mentioned in a comment does not exclude the file it names', async () => {
  // The exact shape of the defect: `sftp.rs` is production, and a doc comment in
  // another module happens to show the attribute.
  const modules = await discoverIn({
    'main.rs': [
      '/// Tests live in',
      '/// #[cfg(test)]',
      '/// mod sftp;',
      '// #[cfg(test)] mod sftp;',
      '/* #[cfg(test)] mod sftp; */',
      '/* /* nested */ #[cfg(test)] mod sftp; */',
      'pub fn run() {}',
    ].join('\n'),
    'sftp.rs': 'pub fn upload() {}',
  })
  assert.equal(
    modules.has('src-tauri/src/sftp.rs'),
    false,
    'a comment must never resolve a module as a test',
  )
  assert.deepEqual([...modules], [])
})

test('a declaration inside a string literal does not exclude the file it names', async () => {
  const modules = await discoverIn({
    'main.rs': [
      'const DOC: &str = "#[cfg(test)] mod sftp;";',
      'static DOC2: &str = r#"#[cfg(test)] mod sftp;"#;',
      'pub fn run() {}',
    ].join('\n'),
    'sftp.rs': 'pub fn upload() {}',
  })
  assert.deepEqual([...modules], [])
})

test('a real #[cfg(test)] declaration is still discovered', async () => {
  const modules = await discoverIn({
    'main.rs': '#[cfg(test)]\n#[path = "probe_tests.rs"]\nmod probe;\npub fn run() {}',
    'probe_tests.rs': 'fn helper() {}',
  })
  assert.ok(modules.has('src-tauri/src/probe_tests.rs'), [...modules].join(','))
})

test('a production module named *_tests.rs is still fingerprinted', async () => {
  // The suffix is a habit, not a compiler rule. Nothing declares this file as a
  // `#[cfg(test)]` module, so it can be a real `mod` and a real part of the build.
  const modules = await discoverIn({
    'lib.rs': 'mod production_tests;\npub fn run() {}',
    'production_tests.rs': 'pub fn shipped_logic() {}',
  })
  assert.equal(modules.has('production_tests.rs'), false)
  assert.equal(isTestSource('src-tauri/src/production_tests.rs', modules), false)
})

test('a .spec or .stories file is not excluded by its name', async () => {
  // vitest's `include` is `src/**/*.test.{ts,tsx}`; no Storybook is configured.
  // Neither pattern has build evidence behind it, so neither may be excluded.
  assert.equal(isTestSource('packages/frontend/src/view/row.spec.tsx'), false)
  assert.equal(isTestSource('packages/frontend/src/view/row.stories.tsx'), false)
  assert.equal(isTestSource('packages/frontend/src/view/row.spec.ts'), false)
})

test('a .test file is excluded only because vitest collects exactly that pattern', async () => {
  assert.equal(isTestSource('packages/frontend/src/view/row.test.tsx'), true)
  assert.equal(isTestSource('packages/frontend/src/view/row.test.ts'), true)
  // The narrow form matters: a `.tsx` that is not `.test.`-infixed stays hashed.
  assert.equal(isTestSource('packages/frontend/src/view/row-test.tsx'), false)
  assert.equal(isTestSource('packages/frontend/src/experiments/textarea-test.tsx'), false)
})

test('the evidence generator and the gate itself are never excluded', async () => {
  // Both are hand-listed in FINGERPRINT_PATHS and neither is inside a source root,
  // so the answer must be `false` — a weaker rule here would let the algorithm be
  // swapped without the evidence noticing.
  for (const file of [
    'scripts/check-verification-evidence.mjs',
    'scripts/build-verification-evidence.mjs',
    'scripts/fetch-verification-evidence.mjs',
  ]) {
    assert.equal(isTestSource(file), false, `${file} must be hashed`)
  }
})

test('the real crate still resolves every #[cfg(test)] module it had before', async () => {
  // Guards the regression the stripper introduced once: replacing string bodies
  // with a placeholder also ate `#[path = "..."]`'s argument, and discovery fell
  // from 9 modules to 3. A smaller set means production test files were pulled
  // *into* the fingerprint — noisy but safe — while a *wrong* set means a
  // production file was excluded. Assert the exact members.
  const modules = await findTestModuleFiles(['src-tauri/src'], real)
  for (const expected of [
    'src-tauri/src/db_import/tests.rs',
    'src-tauri/src/session/manager_tests.rs',
    'src-tauri/src/session/terminal_output_tests.rs',
    'src-tauri/src/sftp_command_e2e_tests.rs',
    'src-tauri/src/sftp_download_tests.rs',
    'src-tauri/src/sftp_upload_tests.rs',
    'src-tauri/src/ssh_host_key_tests.rs',
    'src-tauri/src/terminal_smoke_tests.rs',
    'src-tauri/src/vault_tests.rs',
  ]) {
    assert.ok(modules.has(expected), `${expected} must be discovered`)
  }
  // And nothing outside the crate: a `#[path]` that escapes `src-tauri/src` names a
  // file this collector cannot see, so it must not be claimed as a test.
  for (const file of modules) {
    assert.ok(file.startsWith('src-tauri/src/'), `${file} escapes src-tauri/src`)
  }
})

test('the real frontend tree classifies only test files as tests', async () => {
  // A sweep of the actual tree, because the previous defects were only visible in
  // the shape of real files. Two things are asserted:
  //
  //   * every `.test.*` file is excluded — they are what vitest collects;
  //   * every file whose name merely *looks* like a test but that the router or the
  //     smoke build uses stays in — `experiments/textarea-test.tsx` is a real route.
  //
  // The count is deliberately not pinned: adding a test file must not require
  // editing this test. What is pinned is that no file which is *not* named
  // `.test.` is excluded, and that the known production look-alikes stay.
  const files = []
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(full)
      else files.push(path.relative(projectRoot, full))
    }
  }
  await walk(path.join(projectRoot, 'packages/frontend/src'))

  const excluded = files.filter(file => isTestSource(file))
  const excludedWithoutTestName = excluded.filter(
    file => !/\.test\.[cm]?[jt]sx?$/.test(file) && file !== 'packages/frontend/src/test-setup.ts',
  )
  assert.deepEqual(
    excludedWithoutTestName,
    [],
    'only *.test.* (and the configured setup file) may be excluded',
  )

  // The look-alikes that a name-based rule would wrongly drop.
  for (const kept of [
    'packages/frontend/src/experiments/textarea-test.tsx',
    'packages/frontend/src/experiments/xterm-test.tsx',
    'packages/frontend/src/experiments/terminal-input-probe/index.tsx',
  ]) {
    assert.equal(isTestSource(kept), false, `${kept} must stay in the fingerprint`)
  }
})

test('no real Rust source is excluded unless a cfg(test) declaration names it', async () => {
  // The mirror sweep for Rust. `src-tauri/src` is walked for real, and the only files
  // that may be excluded are the ones `findTestModuleFiles` resolved from an actual
  // attribute — never by suffix.
  const modules = await findTestModuleFiles(['src-tauri/src'], real)
  const files = []
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name.endsWith('.rs')) files.push(path.relative(projectRoot, full))
    }
  }
  await walk(path.join(projectRoot, 'src-tauri/src'))

  for (const file of files) {
    const excluded = isTestSource(file, modules)
    const declared = modules.has(file)
    assert.equal(
      excluded,
      declared,
      `${file} exclusion (${excluded}) must match its cfg(test) declaration (${declared})`,
    )
  }
})
