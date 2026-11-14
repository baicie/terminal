import { readdir, readFile, stat } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * Guards the recorded acceptance evidence against a failure mode that is
 * invisible when reading a single evidence file: two current evidence files can
 * describe different binaries while both read as authoritative.
 *
 * The six current files are produced by one GitHub Actions macOS run (see
 * .github/workflows/real-machine-matrix.yml and
 * scripts/build-verification-evidence.mjs). They are therefore bound to
 * docs/verification/evidence-manifest.json - the fingerprint, the two artifact
 * hashes and the run id of that run - instead of to a binary on this machine.
 *
 * That binding replaced a comparison against the binary on disk because a CI
 * build and a local build of the same sources are not guaranteed to be
 * bit-identical: relinking target/debug with a different toolchain or feature
 * set already produced different bytes for identical sources, so "the file on
 * my disk must equal the file in CI" could only ever be true for the one
 * machine that happened to run the capture. Binding to the artifacts of the
 * same run keeps the guarantee that matters (evidence and binary belong
 * together) without pretending the bytes are reproducible.
 *
 * Historical records are deliberately exempt from that binding: they document
 * the binary that existed at the time, which is the reason they are kept.
 */

const projectRoot = path.resolve(import.meta.dirname, '..')
const verificationRoot = path.join(projectRoot, 'docs', 'verification')

export const EVIDENCE_PROFILE = new Map([
  ['2026-10-11-macos-cold-start-current.json', 'debug'],
  ['2026-10-11-macos-remote-shell-prompt-rerun.json', 'debug'],
  ['2026-10-11-macos-ssh-matrix-current.json', 'debug'],
  ['2026-10-11-macos-shell-interaction-current.json', 'debug'],
  ['2026-10-11-macos-release-terminal-gate.json', 'release'],
  ['2026-10-11-macos-release-ssh-matrix.json', 'release'],
])

export const EVIDENCE_KIND = new Map([
  ['2026-10-11-macos-cold-start-current.json', 'tauri-process-cold-start-stopwatch-current-worktree'],
  ['2026-10-11-macos-remote-shell-prompt-rerun.json', 'tauri-remote-cold-start-shell-prompt-observed-rerun'],
  ['2026-10-11-macos-ssh-matrix-current.json', 'tauri-real-ssh-matrix-current-worktree'],
  ['2026-10-11-macos-shell-interaction-current.json', 'tauri-local-shell-interaction-current-worktree'],
  ['2026-10-11-macos-release-terminal-gate.json', 'tauri-release-ten-second-terminal-gate'],
  ['2026-10-11-macos-release-ssh-matrix.json', 'tauri-release-ssh-and-shell-matrix'],
])

// The password and password-reconnect cases are deliberately outside this
// contract: the hosted macOS runners have no Docker, and the native loopback
// sshd the fixture can build there authenticates the client and then never
// sees a channel open, so those two cases cannot be measured on the platform
// that produces these files. They stay covered by the Linux job, which runs
// the same two cases against the Debian OpenSSH image (docs/issue.md #144);
// adding them back here is the one-line change once that is solved.
export const DEBUG_SSH_CASES = [
  'key',
  'key-reconnect',
  'key-outage-reconnect',
  'key-outage-wake-reconnect',
  'key-first-connect-outage',
  'agent',
  'agent-reconnect',
  'cert',
  'cert-reconnect',
  'jump',
  'jump-reconnect',
]

export const RELEASE_SSH_CASES = [
  'key',
  'key-reconnect',
  'agent',
  'agent-reconnect',
  'cert',
  'cert-reconnect',
  'jump',
  'jump-reconnect',
]

export const SHELL_PROBE_CASES = [
  'cat-eof',
  'readline-history',
  'readline-tab',
  'vim-edit',
  'nano-edit',
  'pty-resize',
  'ctrl-c-interrupt',
]

const MANIFEST_FILE = 'evidence-manifest.json'

export const EVIDENCE_MANIFEST_FILE = MANIFEST_FILE

// Which manifest field binds which build profile to the artifact of the run.
const PROFILE_MANIFEST_FIELD = new Map([
  ['debug', 'debugSha'],
  ['release', 'releaseSha'],
])

/**
 * Where each profile states which executable it measured. These are the only
 * fields the artifact binding reads, and every one of them is asserted against
 * the manifest and against a fixed artifact path.
 *
 * A sha256 found anywhere else in the document binds nothing: the gate used to
 * collect every field named sha256 from the whole tree and accept a match
 * anywhere, which a digest pasted into a note, a description or a fixture block
 * satisfied just as well as a real measurement - while the field that names the
 * measured binary could say something else entirely.
 */
export const BINARY_BINDING = new Map([
  [
    'debug',
    {
      shaPath: ['binary', 'sha256'],
      pathPath: ['binary', 'path'],
      artifactPath: 'src-tauri/target/debug/terminal',
    },
  ],
  [
    'release',
    {
      shaPath: ['build', 'sha256'],
      pathPath: ['build', 'binary'],
      artifactPath: 'src-tauri/target/release/terminal',
    },
  ],
])

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const RAW_LOG_NAME_PATTERN = /^[A-Za-z0-9._-]+\.log$/

function readStringAt(record, keys) {
  let current = record
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return undefined
    current = current[key]
  }
  return typeof current === 'string' ? current : undefined
}

function findManifestEntry(manifest, file) {
  const listed = Array.isArray(manifest?.evidenceFiles) ? manifest.evidenceFiles : []
  return listed.find(entry => entry?.file === file)
}

/**
 * Every sha256 anywhere in the document. It is kept for one narrow purpose -
 * noticing that a single file names two different binaries - and it is
 * deliberately not the artifact binding (see BINARY_BINDING).
 */
function collectHashes(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectHashes(item, found)
    return found
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (key === 'sha256' && typeof nested === 'string') found.push(nested)
      else collectHashes(nested, found)
    }
    return found
  }
  return found
}

export function findRecordedHashes(evidence) {
  return [...new Set(collectHashes(evidence))].sort()
}

export function findSourceFingerprint(evidence) {
  const fingerprint = evidence?.source?.fingerprint
  return typeof fingerprint === 'string' ? fingerprint : undefined
}

function validateColdStartRuns(file, evidence) {
  const runs =
    file === '2026-10-11-macos-release-terminal-gate.json'
      ? evidence.local?.terminalRuns
      : evidence.measurement?.terminalRuns
  const problems = []
  if (!Array.isArray(runs) || runs.length < 3) {
    problems.push(`${file} requires at least 3 terminal marker runs`)
  }
  for (const [index, run] of (Array.isArray(runs) ? runs : []).entries()) {
    if (run?.readyAt !== 'terminal' || run?.terminalReady !== true) {
      problems.push(`${file} run ${index + 1} is not terminal-ready marker evidence`)
    }
    if (
      !Number.isFinite(run?.spawnToReadyMs) ||
      run.spawnToReadyMs < 0 ||
      run.spawnToReadyMs > 10_000
    ) {
      problems.push(`${file} run ${index + 1} exceeds 10000 ms or has no valid timing`)
    }
  }
  return problems
}

function validateMatrixCases(file, evidence) {
  const problems = []
  if (file === '2026-10-11-macos-ssh-matrix-current.json') {
    const cases = Array.isArray(evidence.cases) ? evidence.cases : []
    const names = cases.map(item => item?.name)
    if (
      evidence.allCasesPassed !== true ||
      JSON.stringify(names) !== JSON.stringify(DEBUG_SSH_CASES) ||
      cases.some(item => item?.ok !== true)
    ) {
      problems.push(
        `${file} SSH matrix case set must contain all ${DEBUG_SSH_CASES.length} expected successful cases`,
      )
    }
  }
  if (file === '2026-10-11-macos-shell-interaction-current.json') {
    const shellCases = Array.isArray(evidence.cases) ? evidence.cases : []
    const sshCases = Array.isArray(evidence.sshCases) ? evidence.sshCases : []
    const localShellsComplete = ['bash', 'zsh'].every(shell => {
      const cases = shellCases
        .filter(item => item?.shell === shell)
        .map(item => item?.case)
      return (
        JSON.stringify(cases) === JSON.stringify(SHELL_PROBE_CASES) &&
        shellCases
          .filter(item => item?.shell === shell)
          .every(item => item?.ok === true)
      )
    })
    if (
      evidence.allCasesPassed !== true ||
      evidence.matrixRunsExecuted !== 14 ||
      evidence.matrixRunsPassed !== 14 ||
      shellCases.length !== 14 ||
      !localShellsComplete
    ) {
      problems.push(`${file} local shell matrix must report all 14 bash/zsh runs successful`)
    }
    if (
      evidence.sshRunsExecuted !== 7 ||
      evidence.sshRunsPassed !== 7 ||
      JSON.stringify(sshCases.map(item => item?.case)) !==
        JSON.stringify(SHELL_PROBE_CASES) ||
      sshCases.some(item => item?.ok !== true)
    ) {
      problems.push(`${file} real SSH shell matrix must report all 7 expected cases successful`)
    }
  }
  if (file === '2026-10-11-macos-release-ssh-matrix.json') {
    const matrix = evidence.sshMatrix
    const cases = Array.isArray(matrix?.cases) ? matrix.cases : []
    if (
      matrix?.passed !== RELEASE_SSH_CASES.length ||
      matrix?.failed !== 0 ||
      JSON.stringify(cases.map(item => item?.name)) !==
        JSON.stringify(RELEASE_SSH_CASES) ||
      cases.some(item => item?.ok !== true)
    ) {
      problems.push(
        `${file} release SSH matrix must report all ${RELEASE_SSH_CASES.length} expected successful cases`,
      )
    }
  }
  return problems
}

export function validateEvidenceContract(file, evidence) {
  const problems = []
  const expectedKind = EVIDENCE_KIND.get(file)
  if (evidence?.kind !== expectedKind) {
    problems.push(`${file} has kind ${JSON.stringify(evidence?.kind)}; expected kind ${JSON.stringify(expectedKind)}`)
  }
  if (EVIDENCE_PROFILE.get(file) === 'debug') {
    const fingerprint = findSourceFingerprint(evidence)
    if (!fingerprint) {
      problems.push(`debug evidence ${file} is missing source fingerprint`)
    }
  }
  if (
    file === '2026-10-11-macos-cold-start-current.json' ||
    file === '2026-10-11-macos-release-terminal-gate.json'
  ) {
    problems.push(...validateColdStartRuns(file, evidence ?? {}))
  }
  if (file === '2026-10-11-macos-remote-shell-prompt-rerun.json') {
    const measurement = evidence?.measurement
    if (
      measurement?.markerReady !== true ||
      !Number.isFinite(measurement?.spawnToPromptObservedMs) ||
      measurement.spawnToPromptObservedMs < 0 ||
      measurement.spawnToPromptObservedMs > 10_000
    ) {
      problems.push(`${file} requires a successful terminal marker within 10000 ms`)
    }
  }
  problems.push(...validateMatrixCases(file, evidence ?? {}))
  return problems
}

// Product sources and the executable acceptance path are both part of the
// evidence contract. Documentation, evidence records and **pure test sources**
// are excluded so unrelated edits do not invalidate measurements — see
// "What counts as a product source" below for how a test source is recognised.
export const FINGERPRINT_PATHS = [
  'packages/frontend/src',
  'packages/frontend/index.html',
  'packages/frontend/vite.config.ts',
  'packages/frontend/tsconfig.json',
  'packages/frontend/tsconfig.node.json',
  'src-tauri/src',
  'src-tauri/capabilities',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'src-tauri/tauri.conf.json',
  'src-tauri/build.rs',
  'packages/frontend/package.json',
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'rust-toolchain.toml',
  '.github/workflows/real-machine-matrix.yml',
  'scripts/macos-ax-probe.swift',
  'scripts/macos-frontmost.mjs',
  'scripts/input-probe-scenarios.mjs',
  'scripts/input-probe-source.mjs',
  'scripts/run-cold-start-stopwatch.mjs',
  'scripts/run-local-cold-start-stopwatch.mjs',
  'scripts/run-input-probe.mjs',
  'scripts/run-remote-cold-start-stopwatch.mjs',
  'scripts/run-terminal-shell-probe-matrix.mjs',
  'scripts/run-terminal-shell-probe.mjs',
  'scripts/run-terminal-smoke-matrix.mjs',
  'scripts/run-terminal-smoke.mjs',
  'scripts/terminal-smoke-password-sshd.mjs',
  'scripts/terminal-smoke-renderer-heartbeat.mjs',
  'scripts/terminal-smoke-sshd.mjs',
  'scripts/check-verification-evidence.mjs',
  // The generator decides which numbers land in the evidence and the fetch
  // script decides which files land on disk, so both belong in the fingerprint
  // for the same reason the gate itself does.
  'scripts/build-verification-evidence.mjs',
  'scripts/fetch-verification-evidence.mjs',
]

const FINGERPRINT_IGNORED = new Set(['node_modules', 'dist', 'target', '.git'])

/**
 * What counts as a product source.
 *
 * ## The defect this fixes
 *
 * `FINGERPRINT_PATHS` covers all of `packages/frontend/src` and `src-tauri/src`,
 * and the collector walked every file below them. So editing
 * `src-tauri/src/sftp_download_tests.rs` — a `#[cfg(test)]` module that is not
 * compiled into the product binary at all — invalidated all six acceptance
 * evidence files, and `pnpm verify` reported a fingerprint mismatch for a change
 * that could not possibly alter a measurement. The header of this module already
 * claimed test files were excluded; the collector never implemented it.
 *
 * ## Why recognition is structural
 *
 * "Skip any path containing `test`" is the obvious rule and it is wrong here:
 *
 *   * `packages/frontend/src/experiments/textarea-test.tsx` is **not** a test —
 *     `router/nav-config.tsx` mounts it as a real route (`experiments/` is in the
 *     router), so it ships in the bundle and a change to it can change the app;
 *   * `packages/frontend/src/experiments/terminal-input-probe/` is the probe the
 *     input acceptance scenarios drive, so it is part of the measured path;
 *   * `packages/frontend/src/test-setup.ts` is only reachable from
 *     `vitest.config.ts`'s `setupFiles`, so it *is* test-only despite the name
 *     reading the other way.
 *
 * A path rule keyed on substrings cannot separate those three. The rules below
 * are keyed on how a file enters a build:
 *
 *   * a test **runner** only collects files whose name matches its own
 *     `include` glob — `*.test.*` / `*.spec.*` for vitest (see
 *     `packages/frontend/vitest.config.ts`) and `*.test.mjs` for `node --test`;
 *   * a Rust test module is only reachable through a `#[cfg(test)] mod`
 *     declaration (`#[path = "..."]` or the `<name>_tests.rs` sibling
 *     convention), and is therefore absent from every non-test build.
 *
 * ## Fail-closed
 *
 * `isTestSource` only ever answers for shapes it recognises explicitly. A file
 * whose extension is in neither language's source set throws instead of being
 * silently admitted or silently dropped — an unrecognised file type would
 * otherwise be a hole a source edit could pass through unnoticed.
 */
const JS_TEST_FILE = /\.test\.[cm]?[jt]sx?$/
const FRONTEND_SOURCE = /\.[cm]?[jt]sx?$|\.css$|\.svg$/
const RUST_SOURCE = /\.rs$/

/**
 * Is this path a pure test source, i.e. one that cannot reach a non-test build?
 *
 * ## The rule: prove it, or hash it
 *
 * A file is excluded only when there is **positive evidence** that no non-test
 * build can reach it. Naming is not evidence. Three naming conventions that look
 * like proof and are not:
 *
 * | Convention | Why it is not enough |
 * | --- | --- |
 * | `*_tests.rs` suffix | the suffix is a habit, not a compiler rule — a file named `production_tests.rs` can be a plain `mod` declared from `lib.rs` |
 * | `*.spec.*` | vitest's `include` is `src/**\/*.test.{ts,tsx}`; nothing collects `*.spec.*`, so such a file that the router imports ships in the bundle |
 * | `*.stories.*` | this repo configures no Storybook; nothing consumes the pattern, so the same caveat applies |
 *
 * `*.test.*` is different: `packages/frontend/vitest.config.ts` declares
 * `include: ['src/**\/*.test.{ts,tsx}']`, so that exact pattern *is* the runner's
 * contract. Even then the exclusion is only sound because no production import
 * targets those files — a plain `.test.ts` could in principle be imported by the
 * app, which is why the pattern is kept as narrow as the configured one.
 *
 * Everything else is hashed. A new file is therefore tracked by default: the
 * failure mode of hashing a test file is one unnecessary re-collection, while the
 * failure mode of excluding a production file is evidence that stays "valid"
 * across a real source change. The asymmetry decides the default.
 *
 * ## Rust: only a real `#[cfg(test)]` declaration counts
 *
 * `testModuleFiles` holds the files `findTestModuleFiles` resolved from actual
 * `#[cfg(test)] mod …;` declarations, with comments and string literals stripped
 * first. A file that merely looks like a test — by suffix, by comment, or by a
 * string that happens to contain the attribute — is not in that set and stays in
 * the fingerprint.
 */
export function isTestSource(relativePath, testModuleFiles = new Set()) {
  if (relativePath.startsWith(FRONTEND_SOURCE_ROOT)) {
    // `test-setup.ts` is reachable only from `vitest.config.ts`'s `setupFiles` —
    // configured, not merely named. The vitest `include` pattern is the other.
    return JS_TEST_FILE.test(relativePath) || relativePath === TEST_SETUP
  }

  if (relativePath.startsWith(RUST_SOURCE_ROOT)) {
    if (!RUST_SOURCE.test(relativePath)) {
      throw new Error(
        `${relativePath} is inside src-tauri/src but is not a Rust source file: ` +
          'the fingerprint rules do not know whether a build uses it',
      )
    }
    // Only a declaration resolved from real code. The suffix alone is not used
    // here: `findTestModuleFiles` also strips comments and strings, so a
    // `_tests.rs` file that nothing declares as `#[cfg(test)]` stays hashed.
    return testModuleFiles.has(relativePath)
  }

  // Everything else is an explicit, hand-listed file: `package.json`,
  // `Cargo.lock`, `capabilities/*.json`, a runner script. Each of those is part
  // of the measured path by construction, and none of them is a test.
  return false
}

const FRONTEND_SOURCE_ROOT = 'packages/frontend/src/'
const RUST_SOURCE_ROOT = 'src-tauri/src/'

const TEST_SETUP = 'packages/frontend/src/test-setup.ts'

/**
 * Strip Rust comments and string literals, leaving only code.
 *
 * Without this, `// #[cfg(test)] mod sftp;` in a doc comment or
 * `const S: &str = "#[cfg(test)] mod sftp;";` in a string would look exactly like
 * a real declaration to the regex below — and excluding `sftp.rs` from the
 * fingerprint is the worst failure this module can have: a production edit would
 * leave the evidence looking valid.
 *
 * Char and byte literals are handled as well (`b'#'`, `'['`), because a naive
 * scanner that only knows `"` would be confused by `'"'` inside a char literal.
 * Nested block comments are counted: Rust allows a comment inside a comment, and
 * ending at the inner terminator would expose the outer comment's body as code.
 *
 * Not a Rust parser — it does not need to be. It only has to guarantee that no
 * comment or literal content reaches the declaration regex, and that real code
 * does. Anything it cannot classify is treated as code, which is the safe side.
 */
export function stripRustCommentsAndStrings(source) {
  return stripRust(source, true)
}

/** Strip comments only, keeping literal bodies. Used to read `#[path = "…"]`. */
export function stripRustComments(source) {
  return stripRust(source, false)
}

function stripRust(source, replaceLiterals) {
  let out = ''
  let index = 0
  const length = source.length
  // The placeholder keeps its quotes so `#[path = "..."]`'s shape stays
  // recognisable while its contents — which could fake a declaration — do not.
  const literal = body => (replaceLiterals ? '" STR "' : `"${body}"`)

  while (index < length) {
    const char = source[index]
    const next = source[index + 1]

    // Line comment: `//` up to the newline. `///` and `//!` are the same shape.
    if (char === '/' && next === '/') {
      while (index < length && source[index] !== '\n') index += 1
      continue
    }

    // Block comment, with nesting.
    if (char === '/' && next === '*') {
      let depth = 1
      index += 2
      while (index < length && depth > 0) {
        if (source[index] === '/' && source[index + 1] === '*') {
          depth += 1
          index += 2
        } else if (source[index] === '*' && source[index + 1] === '/') {
          depth -= 1
          index += 2
        } else {
          index += 1
        }
      }
      // A newline keeps line numbers honest for anything downstream.
      out += '\n'
      continue
    }

    // Raw strings: r"…", r#"…"#, r##"…"## …
    if (char === 'r' && (next === '"' || next === '#')) {
      let hashes = 0
      let probe = index + 1
      while (source[probe] === '#') {
        hashes += 1
        probe += 1
      }
      if (source[probe] === '"') {
        const terminator = '"' + '#'.repeat(hashes)
        const close = source.indexOf(terminator, probe + 1)
        const body = close === -1 ? source.slice(probe + 1) : source.slice(probe + 1, close)
        index = close === -1 ? length : close + terminator.length
        // Placeholder, not the body: a string that happens to contain
        // `#[cfg(test)] mod …;` must not look like a declaration.
        out += literal(body)
        continue
      }
    }

    // Byte strings: b"…" and br"…" / br#"…"#. The `r` form is handled above once
    // the leading `b` is skipped.
    if (char === 'b' && next === '"') {
      const start = index + 2
      index += 2
      while (index < length) {
        if (source[index] === '\\') {
          index += 2
          continue
        }
        if (source[index] === '"') {
          break
        }
        index += 1
      }
      out += literal(source.slice(start, index))
      index += 1
      continue
    }

    // Ordinary string literal.
    if (char === '"') {
      const start = index + 1
      index += 1
      while (index < length) {
        if (source[index] === '\\') {
          index += 2
          continue
        }
        if (source[index] === '"') {
          break
        }
        index += 1
      }
      out += literal(source.slice(start, index))
      index += 1
      continue
    }

    // Char or byte literal: `'x'`, `'\n'`, `b'#'`. A lifetime (`'a`) has no
    // closing quote, so look ahead for one before deciding.
    if (char === "'" || (char === 'b' && next === "'")) {
      const quote = char === 'b' ? index + 1 : index
      const after = quote + 1
      let close = after
      if (source[after] === '\\') close = after + 2
      else close = after + 1
      if (source[close] === "'") {
        index = close + 1
        out += "''"
        continue
      }
      // Not a char literal — a lifetime. Emit the quote as code.
      out += char
      index += 1
      continue
    }

    out += char
    index += 1
  }

  return out
}

/**
 * Find the Rust files that are only reachable through a `#[cfg(test)]` module.
 *
 * Reads the production `.rs` files once and looks for the two shapes the crate
 * uses:
 *
 * ```ignore
 * #[cfg(test)]
 * #[path = "vault_tests.rs"]
 * mod tests;
 * ```
 *
 * and the same declaration without `#[path]`, where the module file is the
 * `<name>_tests.rs` sibling (`lib.rs`: `mod sftp_download_tests;`). A file that
 * carries its own inline `#[cfg(test)] mod tests { … }` block is *not* covered —
 * it is part of a production file, and the production file is what the
 * fingerprint hashes.
 *
 * The declaration text is matched against **code only**: comments and string
 * literals are stripped first (see `stripRustCommentsAndStrings`), so a mention of
 * the attribute in a comment cannot exclude the file it names.
 *
 * `#[path]` pointing outside `src-tauri/src` (e.g. `../tests/…`) is rejected: a
 * module the fingerprint cannot see must not be silently claimed as a test.
 */
export async function findTestModuleFiles(
  relativeRoots,
  dependencies,
  root = projectRoot,
) {
  const { readFile } = dependencies
  const found = new Set()
  const production = []
  for (const relativeRoot of relativeRoots) {
    await collectFingerprintFiles(
      relativeRoot,
      production,
      dependencies,
      relativePath => RUST_SOURCE.test(relativePath),
      root,
    )
  }

  for (const relativePath of production) {
    const source = String(await readFile(path.join(root, relativePath)))
    // `#[path = "…"]` needs its argument, and `stripRustCommentsAndStrings` replaces
    // every literal with a placeholder. So collect the arguments from the **raw**
    // source and pair them positionally with the declarations found in the stripped
    // code. That keeps both guarantees at once: a string cannot fake a declaration
    // (the `mod` half is matched against code only), and a real `#[path]` keeps its
    // value.
    //
    // Comments are stripped from the argument list too, so `// #[path = "x.rs"]`
    // cannot shift the positional pairing.
    const commentFree = stripRustComments(source)
    const paths = [...commentFree.matchAll(/#\[path\s*=\s*"([^"]+)"\]/g)].map(
      match => match[1],
    )
    const code = stripRustCommentsAndStrings(source)
    let pathIndex = 0
    for (const match of code.matchAll(
      /#\[cfg\(test\)\]\s*(#\[path\s*=\s*"[^"]*"\]\s*)?mod\s+(\w+)\s*;/g,
    )) {
      const [, pathAttribute, moduleName] = match
      const explicit = pathAttribute === undefined ? undefined : paths[pathIndex++]
      const directory = path.posix.dirname(relativePath)
      const declared = explicit ?? `${moduleName}.rs`
      const resolved = path.posix.normalize(path.posix.join(directory, declared))
      // A `#[path]` escaping `src-tauri/src` names a file this collector cannot
      // see. Claiming it as a test would be an assertion about content nobody
      // read, so skip it — the module then simply stays outside the fingerprint,
      // which is what "not visible" already meant.
      if (!resolved.startsWith(RUST_SOURCE_ROOT)) continue
      found.add(resolved)
    }
  }
  return found
}

async function collectFingerprintFiles(
  relativePath,
  out,
  dependencies = {},
  acceptFile = null,
  root = projectRoot,
) {
  const readDirectory = dependencies.readdir ?? readdir
  const statPath = dependencies.stat ?? stat
  let stats
  try {
    stats = await statPath(path.join(root, relativePath))
  } catch {
    return out
  }
  if (stats.isFile()) {
    if (acceptFile === null || acceptFile(relativePath)) out.push(relativePath)
    return out
  }
  if (!stats.isDirectory()) return out
  for (const name of await readDirectory(path.join(root, relativePath))) {
    if (FINGERPRINT_IGNORED.has(name)) continue
    await collectFingerprintFiles(
      path.join(relativePath, name),
      out,
      dependencies,
      acceptFile,
      root,
    )
  }
  return out
}

/**
 * Fingerprints the product sources and the runner/workflow contract the macOS
 * acceptance evidence describes.
 *
 * Debug evidence cannot be validated against its artifact because `pnpm
 * verify` relinks target/debug as a bare cargo build, so the only way to notice
 * that a measurement predates a code change is to fingerprint the code
 * itself. Content hashing keeps this independent of mtimes, checkouts and
 * line endings.
 *
 * Pure test sources are skipped (see `isTestSource`): they are not part of any
 * non-test build, so editing one cannot invalidate a measurement. Everything
 * else under the listed roots is hashed — there is no allowlist of filenames
 * that a new production file could fall outside of.
 */
export async function computeSourceFingerprint(
  dependencies = { readdir, readFile, stat },
) {
  const testModuleFiles = await findTestModuleFiles(
    FINGERPRINT_PATHS.filter(root => root.startsWith('src-tauri/')),
    dependencies,
  )
  const files = []
  for (const root of FINGERPRINT_PATHS) {
    await collectFingerprintFiles(
      root,
      files,
      dependencies,
      relativePath => !isTestSource(relativePath, testModuleFiles),
    )
  }
  files.sort()
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file)
    hash.update(await dependencies.readFile(path.join(projectRoot, file)))
  }
  return hash.digest('hex')
}

export function groupEvidenceByProfile(entries) {
  const groups = new Map()
  for (const [file, profile] of entries) {
    if (!groups.has(profile)) groups.set(profile, [])
    groups.get(profile).push(file)
  }
  return groups
}

export function findProfileHashConflicts(groups, hashesByFile) {
  const conflicts = []
  for (const [profile, files] of groups) {
    const observed = new Map()
    for (const file of files) {
      for (const hash of hashesByFile.get(file) ?? []) {
        if (!observed.has(hash)) observed.set(hash, [])
        observed.get(hash).push(file)
      }
    }
    if (observed.size > 1) {
      conflicts.push({
        profile,
        hashes: [...observed.keys()].sort(),
        files,
      })
    }
  }
  return conflicts
}

export const MISSING_MANIFEST_MESSAGE =
  `docs/verification/${MANIFEST_FILE} is missing. The six current evidence files are ` +
  'only valid together with the manifest of the CI run that produced them; nothing ' +
  'on this machine can replace it, because a local build and the CI build of the same ' +
  'sources are not guaranteed to be bit-identical. Fetch both with ' +
  '`node scripts/fetch-verification-evidence.mjs --latest` (or `--run-id <id>`) instead ' +
  'of writing an evidence file by hand.'

/**
 * Binds the six evidence files to the manifest of one CI run.
 *
 * Each check answers a failure that reading the evidence alone cannot see: a
 * manifest from another checkout, a field pinned by hand while the artifact
 * moved, or a file left over from a different run than the one the manifest
 * describes.
 */
/**
 * Asserts one evidence file against the artifact of the CI run, at the fixed
 * paths that name that artifact. Everything is reported as one problem for the
 * file, because a reviewer needs the sentence about this file rather than four
 * fragments about the same broken binding.
 */
function validateArtifactBinding(file, evidence, manifest) {
  const profile = EVIDENCE_PROFILE.get(file)
  const binding = BINARY_BINDING.get(profile)
  const field = PROFILE_MANIFEST_FIELD.get(profile)
  const expected =
    typeof manifest?.[field] === 'string' ? manifest[field] : undefined
  const recorded = readStringAt(evidence, binding.shaPath)
  const recordedPath = readStringAt(evidence, binding.pathPath)
  const listed = findManifestEntry(manifest, file)
  const detail = []

  if (recorded === undefined || !SHA256_PATTERN.test(recorded)) {
    detail.push(
      `${binding.shaPath.join('.')} is ${JSON.stringify(recorded ?? null)} ` +
        'instead of a sha256 digest',
    )
  }
  if (recorded !== expected) {
    detail.push(
      `it records ${JSON.stringify(recorded ?? null)} where ${MANIFEST_FILE} ` +
        `binds the ${profile} artifact of run ${manifest?.runId ?? '<none>'} to ` +
        `${JSON.stringify(expected ?? null)}`,
    )
  }
  if (recordedPath !== binding.artifactPath) {
    detail.push(
      `${binding.pathPath.join('.')} is ${JSON.stringify(recordedPath ?? null)} ` +
        `instead of ${binding.artifactPath}, so the file does not name the ` +
        'executable it measured',
    )
  }
  if (listed === undefined) {
    detail.push(`${MANIFEST_FILE} records no evidenceFiles entry for this file`)
  } else if (listed.sha256 !== recorded) {
    detail.push(
      `the ${MANIFEST_FILE} evidenceFiles entry for this file records ` +
        JSON.stringify(listed.sha256 ?? null),
    )
  }
  if (detail.length === 0) return []
  return [
    `${profile} evidence ${file}: ${detail.join('; ')}. Re-run the scenario on ` +
      'the artifact that run produced instead of citing numbers measured on a ' +
      'different build or written by hand.',
  ]
}

const RAW_LOG_DIRECTORY = 'docs/verification/raw'

/**
 * The raw log of a scenario is the audit trail behind its JSON numbers: the
 * summary states what was measured, the log is what shows it was measured at
 * all. A manifest naming logs nobody can open is not an audit trail.
 */
async function validateRawLogArchive(manifest, readDirectory) {
  const problems = []
  const listed = Array.isArray(manifest?.rawLogs?.files)
    ? manifest.rawLogs.files
    : []
  if (listed.length === 0) {
    problems.push(
      `${MANIFEST_FILE} records no rawLogs.files, so the logs behind these ` +
        'measurements cannot be opened. Install the manifest with ' +
        'scripts/fetch-verification-evidence.mjs instead of writing it by hand.',
    )
    return problems
  }
  const unusable = listed.filter(
    name => typeof name !== 'string' || !RAW_LOG_NAME_PATTERN.test(name),
  )
  if (unusable.length > 0) {
    problems.push(
      `${MANIFEST_FILE} lists raw log names that are not plain .log names: ` +
        `${unusable.map(name => JSON.stringify(name ?? null)).join(', ')}.`,
    )
  }
  const runId =
    typeof manifest.runId === 'string' && manifest.runId !== ''
      ? manifest.runId
      : undefined
  if (runId === undefined) return problems
  const usable = listed.filter(
    name => typeof name === 'string' && RAW_LOG_NAME_PATTERN.test(name),
  )
  let installed = []
  try {
    installed = await readDirectory(path.join(verificationRoot, 'raw', runId))
  } catch {
    installed = []
  }
  const present = new Set(installed.map(name => String(name)))
  const missing = usable.filter(
    name => !present.has(name) && !present.has(`${name}.gz`),
  )
  if (missing.length > 0) {
    problems.push(
      `the raw log(s) of run ${runId} are missing from ${RAW_LOG_DIRECTORY}/` +
        `${runId}/: ${missing.join(', ')}. The JSON numbers are a summary; the ` +
        'raw log is what shows they were measured rather than written. Restore ' +
        'them with scripts/fetch-verification-evidence.mjs (or store them as ' +
        '<name>.gz) instead of deleting the tail of the audit trail.',
    )
  }
  return problems
}
export function validateEvidenceManifest(
  manifest,
  { entries, evidenceByFile, sourceFingerprint },
) {
  const problems = []
  const runId = typeof manifest.runId === 'string' ? manifest.runId : undefined

  if (typeof manifest.fingerprint !== 'string' || manifest.fingerprint === '') {
    problems.push(
      `${MANIFEST_FILE} records no source fingerprint, so it cannot show which sources ` +
        'the run measured.',
    )
  } else if (
    sourceFingerprint !== undefined &&
    manifest.fingerprint !== sourceFingerprint
  ) {
    problems.push(
      `${MANIFEST_FILE} was produced from source fingerprint ${manifest.fingerprint}, but ` +
        `these sources fingerprint as ${sourceFingerprint}. The evidence describes a ` +
        'different checkout: dispatch the macOS evidence job on this commit instead of ' +
        'citing measurements taken before these sources existed.',
    )
  }

  if (runId === undefined || runId === '') {
    problems.push(
      `${MANIFEST_FILE} records no run id, so the evidence cannot be tied to the CI run ` +
        'that measured it.',
    )
  }

  for (const [profile, field] of PROFILE_MANIFEST_FIELD) {
    if (!entries.some(([file]) => EVIDENCE_PROFILE.get(file) === profile)) continue
    const expected = manifest[field]
    if (typeof expected !== 'string' || expected === '') {
      problems.push(
        `${MANIFEST_FILE} records no ${field}, so the ${profile} evidence is not bound to ` +
          'the artifact the run built.',
      )
    }
  }

  // One problem per file, read from the fixed paths in BINARY_BINDING. Accepting
  // a matching digest found anywhere in the document let a value pasted into an
  // unrelated field stand in for the binding, so each file is now asserted
  // against the manifest field of its profile, the manifest's own entry for it
  // and the path of the executable it claims to have measured.
  for (const [file] of entries) {
    problems.push(
      ...validateArtifactBinding(file, evidenceByFile.get(file), manifest),
    )
  }

  for (const [file] of entries) {
    const provenance = evidenceByFile.get(file)?.provenance
    if (provenance === null || typeof provenance !== 'object') {
      problems.push(
        `${file} carries no provenance block, so it is not a CI-produced record: ` +
          'scripts/build-verification-evidence.mjs writes that block from the run that ' +
          'measured the scenario.',
      )
      continue
    }
    if (runId !== undefined && provenance.runId !== runId) {
      problems.push(
        `${file} was produced by run ${JSON.stringify(provenance.runId)}, but ` +
          `${MANIFEST_FILE} describes run ${runId}: the evidence file and the manifest ` +
          'come from different runs. Fetch both from one run.',
      )
    }
  }

  return problems
}

export async function checkVerificationEvidence({
  dependencies = { readdir, readFile },
  availableFiles,
  sourceFingerprint,
} = {}) {
  const present =
    availableFiles ?? (await dependencies.readdir(verificationRoot))
  // Every registered file must exist. Filtering the registry down to whatever
  // happens to be on disk would make deleting an evidence file silently reduce
  // coverage: the gate would still pass while checking one profile less, and a
  // reviewer would have no signal that the proof had been removed.
  const registered = [...EVIDENCE_PROFILE]
  const absent = registered
    .map(([file]) => file)
    .filter(file => !present.includes(file))
  // Absent files are reported as problems above; they are not read or compared,
  // because there is nothing on disk to compare.
  const entries = registered.filter(([file]) => present.includes(file))
  const hashesByFile = new Map()
  const fingerprintsByFile = new Map()
  const evidenceByFile = new Map()
  const unparsable = []

  for (const [file] of entries) {
    const raw = await dependencies.readFile(
      path.join(verificationRoot, file),
      'utf8',
    )
    try {
      const parsed = JSON.parse(raw)
      evidenceByFile.set(file, parsed)
      hashesByFile.set(file, findRecordedHashes(parsed))
      fingerprintsByFile.set(file, findSourceFingerprint(parsed))
    } catch {
      unparsable.push(file)
      hashesByFile.set(file, [])
      fingerprintsByFile.set(file, undefined)
      evidenceByFile.set(file, undefined)
    }
  }

  const problems = []
  const manifestIssues = []
  let manifest
  if (!present.includes(MANIFEST_FILE)) {
    manifestIssues.push(MISSING_MANIFEST_MESSAGE)
  } else {
    try {
      manifest = JSON.parse(
        await dependencies.readFile(
          path.join(verificationRoot, MANIFEST_FILE),
          'utf8',
        ),
      )
    } catch {
      manifestIssues.push(
        `docs/verification/${MANIFEST_FILE} is not valid JSON, so nothing ties the ` +
          'evidence files to the CI run and the artifacts they describe. Fetch the ' +
          'manifest with scripts/fetch-verification-evidence.mjs instead of editing it.',
      )
    }
  }
  if (absent.length > 0) {
    problems.push(
      `evidence files are registered as current evidence but are missing: ` +
        `${absent.join(', ')}. Restore them, or drop them from EVIDENCE_PROFILE ` +
        'deliberately rather than letting the gate quietly check less.',
    )
  }
  if (unparsable.length > 0) {
    problems.push(`evidence files are not valid JSON: ${unparsable.join(', ')}`)
  }

  for (const [file] of entries) {
    problems.push(...validateEvidenceContract(file, evidenceByFile.get(file)))
  }

  const missing = entries
    .filter(([file]) => hashesByFile.get(file).length === 0)
    .map(([file]) => file)
  if (missing.length > 0) {
    problems.push(
      `evidence files record no binary sha256: ${missing.join(', ')}`,
    )
  }

  const conflicts = findProfileHashConflicts(
    groupEvidenceByProfile(entries),
    hashesByFile,
  )
  for (const conflict of conflicts) {
    problems.push(
      `${conflict.profile} evidence disagrees on the measured binary: ` +
        `${conflict.hashes.join(' vs ')} across ${conflict.files.join(', ')}. ` +
        'Re-run the affected scenarios on one binary instead of citing numbers measured on different builds.',
    )
  }

  // Internal consistency is not enough: the evidence must also be the evidence
  // of one specific CI run. That is what the manifest binds - fingerprint, both
  // artifact hashes and the run id - and it replaced a comparison against the
  // binary on disk, which could only ever hold for the single machine that ran
  // the capture (see the header comment).
  problems.push(...manifestIssues)
  if (manifest !== undefined) {
    problems.push(
      ...validateEvidenceManifest(manifest, {
        entries,
        evidenceByFile,
        sourceFingerprint,
      }),
    )
  }
  if (manifest !== undefined) {
    problems.push(
      ...(await validateRawLogArchive(
        manifest,
        dependencies.readdir ?? readdir,
      )),
    )
  }

  // A fingerprint recorded inside the evidence and the fingerprint recorded in
  // the manifest are two independent statements about the same checkout. The
  // manifest is checked above; this checks every per-file statement, so a file
  // that kept an older fingerprint cannot ride along on a fresh manifest. Both
  // profiles are covered: release evidence states it in provenance.fingerprint,
  // debug evidence in provenance.fingerprint and source.fingerprint.
  if (sourceFingerprint !== undefined) {
    for (const [file] of entries) {
      const evidence = evidenceByFile.get(file)
      const statements = []
      const sourceStatement = fingerprintsByFile.get(file)
      if (
        EVIDENCE_PROFILE.get(file) === 'debug' &&
        sourceStatement !== undefined
      ) {
        statements.push(['source.fingerprint', sourceStatement])
      }
      const provenanceStatement = readStringAt(evidence, [
        'provenance',
        'fingerprint',
      ])
      if (provenanceStatement !== undefined) {
        statements.push(['provenance.fingerprint', provenanceStatement])
      }
      const stale = statements.filter(
        statement => statement[1] !== sourceFingerprint,
      )
      if (stale.length === 0) continue
      problems.push(
        `${file} was recorded against source fingerprint ` +
          `${stale
            .map(([where, value]) => `${value} (${where})`)
            .join(' and ')}, but the terminal sources now fingerprint as ` +
          `${sourceFingerprint}. This file describes an older checkout. ` +
          'Re-run the scenario on the current sources instead of citing ' +
          'measurements taken before this change.',
      )
    }
  }

  return { checked: entries.length, problems }
}

// Compared on real paths: the runtime resolves the entry module through symlinks
// while argv[1] keeps the path as typed, so a checkout reached through a symlink
// would compare unequal and the gate would silently do nothing (exit 0, no output).
function realpathOrNull(target) {
  try {
    return realpathSync(target)
  } catch {
    return null
  }
}

const modulePath = realpathOrNull(fileURLToPath(import.meta.url))
const invokedPath =
  process.argv[1] === undefined
    ? null
    : realpathOrNull(path.resolve(process.argv[1]))

const isDirectRun = modulePath !== null && modulePath === invokedPath

if (isDirectRun) {
  const fingerprint = await computeSourceFingerprint()
  const { checked, problems } = await checkVerificationEvidence({
    sourceFingerprint: fingerprint,
  })
  if (problems.length > 0) {
    console.error(
      `Verification evidence gate failed: ${problems.length} problem(s).`,
    )
    for (const problem of problems) console.error(`- ${problem}`)
    process.exitCode = 1
  } else {
    console.log(
      `Verification evidence gate passed for ${checked} current evidence file(s).`,
    )
  }
}
