#!/usr/bin/env node
/**
 * The cargo tree probe layer behind the RustSec ledger.
 *
 * Split out of build-security-ledger.mjs so the ledger module holds only pure,
 * testable analysis: everything here shells out, so the tests drive the analysis
 * with fixture text instead of needing a cargo toolchain and a resolved
 * Cargo.lock.
 *
 * The one rule this module exists to enforce: a cargo failure must throw. The
 * previous implementation caught every error and returned '', which turned a
 * broken toolchain into a ledger claiming no advisory is reachable.
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// cargo tree has to run inside the crate directory, resolved from this file
// rather than from the caller's working directory so the script behaves the
// same whether it is invoked from the repo root or from scripts/.
const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const CRATE_DIR = join(ROOT, 'src-tauri')

/** The command that produces the snapshot this ledger reads. */
export const AUDIT_COMMAND =
  'cd src-tauri && cargo audit --json > "$TMPDIR/audit.json"'

/**
 * Run a command and return stdout, letting failures throw.
 *
 * Deliberately has no try/catch. `return error.stdout ?? ''` - the shape this
 * replaces - is the most dangerous possible error handler here: an empty tree
 * makes `inTree` false for every crate, so every advisory is reported as
 * absent-from-build-graph and the ledger reads "nothing is reachable".
 */
export function runCargo(args, cwd) {
  return execFileSync('cargo', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/**
 * The two full dumps plus the absent-verification probe, ready for
 * classifyReach.
 *
 * `--target all` matters: without it cargo tree hides crates that only build on
 * other platforms, and a Windows-only dependency would be scored as absent on a
 * macOS run.
 */
export function collectTrees(cwd, exec = runCargo) {
  return {
    normalTree: exec(
      ['tree', '--prefix', 'none', '--edges', 'normal', '--target', 'all'],
      cwd,
    ),
    allTree: exec(
      ['tree', '--prefix', 'none', '--edges', 'all', '--target', 'all'],
      cwd,
    ),
    verifyAbsent: (name, version) =>
      verifyAbsent(name, version, cwd, exec),
  }
}

/** collectTrees against this repo's crate directory - what the CLI uses. */
export function collectCargoTrees() {
  return collectTrees(CRATE_DIR)
}

/**
 * Second opinion on an absent verdict: true when the crate really has no path
 * to the root.
 *
 * `absent-from-build-graph` is the only verdict that justifies an exemption, so
 * it is the only one cross-checked with a separate command. The crate is named
 * as `name@version` because a bare name is ambiguous when the lockfile holds two
 * versions, and cargo exits non-zero on the ambiguity rather than guessing.
 */
export function verifyAbsent(name, version, cwd, exec = runCargo) {
  const out = exec(
    ['tree', '--invert', `${name}@${version}`, '--target', 'all', '--prefix', 'none'],
    cwd,
  )
  // cargo prints its "nothing to print" notice on stderr, so empty stdout is
  // the signal that no dependency path exists.
  return out.trim() === ''
}
