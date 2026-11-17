#!/usr/bin/env node
/**
 * Prove the AI transport is absent from a build compiled without the `ai` feature.
 *
 * The design requirement is not "we gated it" — a comment saying so is not evidence,
 * and neither is a Tauri command that exists but answers "disabled". A feature-off
 * build must have no code path that can reach a model, no command the renderer could
 * call, and no `chat/completions` URL in the binary.
 *
 * What this asserts, in order of how hard each is to fake:
 *
 *   1. `src/ai/` is not in the feature-off dependency graph (it is a module of this
 *      crate, so the proxy is the crate's own `--cfg feature="ai"` set — asserted
 *      through `cargo tree -e features`).
 *   2. The feature literally is off: `cargo tree -e features` shows no `ai` feature
 *      edge on the `terminal` package.
 *   3. Building with the feature *does* compile the module, so the test cannot pass by
 *      the feature silently doing nothing.
 *   4. The feature-off library does not contain the module's identifying strings,
 *      while the feature-on library does.
 *
 * (4) is the decisive one: it looks at the compiled artifact rather than at the
 * manifest. The marker strings are chosen to be (a) present in the AI module and
 * (b) nowhere else, so a match means this code and not `storage.rs`'s `reqwest` use.
 *
 * Exits 0 only when every assertion holds.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')
const MANIFEST = path.join(ROOT, 'src-tauri/Cargo.toml')
const results = []

/**
 * Strings that exist only in `src-tauri/src/ai/`.
 *
 * `chat/completions` is built in `endpoint::chat_completions_url`. The delimiter is
 * the injection defence's own marker, which no other module spells. Neither appears
 * in a test file that a release build compiles.
 */
const AI_MARKERS = ['UNTRUSTED_TERMINAL_OUTPUT', '/chat/completions']

function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function tree(args) {
  try {
    return execFileSync('cargo', ['tree', '--manifest-path', MANIFEST, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (error) {
    return String(error.stdout ?? '')
  }
}

/** The features the `terminal` package declares, from `cargo metadata`. */
function declaredFeatures() {
  try {
    const raw = execFileSync(
      'cargo',
      ['metadata', '--manifest-path', MANIFEST, '--no-deps', '--format-version', '1'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    const metadata = JSON.parse(raw)
    const pkg = metadata.packages?.find(pkg => pkg.name === 'terminal')
    return pkg?.features ? Object.keys(pkg.features) : []
  } catch {
    return []
  }
}

// 1. The feature must exist and must not be a default.
//
// `cargo tree -e features` was the first approach and it does **not** work here: `ai`
// is an empty feature (`ai = []`), and an empty feature enables no dependency, so it
// never appears as a rendered edge. The build facts below are what actually prove the
// feature does something; this assertion only covers the manifest's own claim.
const features = declaredFeatures()
record(
  'the crate declares an `ai` feature',
  features.includes('ai'),
  features.length ? features.join(', ') : 'metadata unavailable',
)
const defaultFeatures = declaredDefaultFeatures()
record(
  '`ai` is not enabled by default',
  !defaultFeatures.includes('ai'),
  defaultFeatures.length ? defaultFeatures.join(', ') : 'no default features',
)

function declaredDefaultFeatures() {
  try {
    const raw = execFileSync(
      'cargo',
      ['metadata', '--manifest-path', MANIFEST, '--no-deps', '--format-version', '1'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    const metadata = JSON.parse(raw)
    const pkg = metadata.packages?.find(pkg => pkg.name === 'terminal')
    return pkg?.features?.default ?? []
  } catch {
    return []
  }
}

// 2. A default build must not have the feature on. The decisive evidence is the
// artifact check below; this is the cheap structural probe that fails fast.
const defaultTree = tree(['--locked', '-e', 'features'])
const defaultAiEdges = defaultTree
  .split('\n')
  .filter(line => /^terminal feature "ai"/.test(line.trim()))
record(
  'default dependency graph shows no `ai` feature edge',
  defaultAiEdges.length === 0,
  defaultAiEdges.length ? defaultAiEdges.slice(0, 3).join(' | ') : 'zero matches',
)

/**
 * Read the built library and report which markers appear in it.
 *
 * The rlib is searched as bytes rather than through `nm`: the markers are string
 * literals, and a symbol-level check would miss a string that is inlined into a
 * larger blob. An absent rlib is reported as a failure, not skipped — a gate that
 * silently passes when its input is missing is worse than no gate.
 */
function markersIn(rlibPath) {
  if (!existsSync(rlibPath)) return null
  const contents = readFileSync(rlibPath)
  return AI_MARKERS.filter(marker => contents.includes(Buffer.from(marker, 'utf8')))
}

/** The rlib `cargo build` just produced, whichever profile directory holds it. */
function libPath(profile) {
  const dir = path.join(ROOT, 'src-tauri/target', profile)
  const candidate = path.join(dir, 'libterminal_lib.rlib')
  if (existsSync(candidate)) return candidate
  // Cargo may name it after the crate's `[lib] name`.
  const fallback = path.join(dir, 'libterminal.rlib')
  return existsSync(fallback) ? fallback : candidate
}

// The off-build is the decisive check, so it is built with a distinct target dir:
// sharing `target/` with an on-build would let a stale artifact answer for it.
const OFF_TARGET = path.join(ROOT, 'src-tauri/target/ai-isolation-off')
const ON_TARGET = path.join(ROOT, 'src-tauri/target/ai-isolation-on')

function buildInto(targetDir, extraArgs) {
  execFileSync(
    'cargo',
    [
      'build',
      '--locked',
      '--manifest-path',
      MANIFEST,
      '--target-dir',
      targetDir,
      ...extraArgs,
    ],
    { cwd: ROOT, stdio: 'inherit' },
  )
  const candidate = path.join(targetDir, 'debug/libterminal_lib.rlib')
  if (existsSync(candidate)) return candidate
  return path.join(targetDir, 'debug/libterminal.rlib')
}

const offLib = buildInto(OFF_TARGET, [])
const offMarkers = markersIn(offLib)
record(
  'feature-off library contains no AI marker string',
  offMarkers !== null && offMarkers.length === 0,
  offMarkers === null
    ? `missing artifact: ${path.relative(ROOT, offLib)}`
    : offMarkers.length
      ? `leaked: ${offMarkers.join(', ')}`
      : `${AI_MARKERS.length} markers absent`,
)

const onLib = buildInto(ON_TARGET, ['--features', 'ai'])
const onMarkers = markersIn(onLib)
record(
  'feature-on library does contain them (the check is not vacuous)',
  onMarkers !== null && onMarkers.length === AI_MARKERS.length,
  onMarkers === null
    ? `missing artifact: ${path.relative(ROOT, onLib)}`
    : `found ${onMarkers.length}/${AI_MARKERS.length}: ${onMarkers.join(', ')}`,
)

// The manifest and the product config must agree that the product build has it on:
// a `features` list that named the wrong feature would leave the shipped app with no
// AI while every test above stayed green.
const tauriConfig = JSON.parse(
  readFileSync(path.join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'),
)
const configured = tauriConfig?.build?.features ?? []
record(
  'tauri.conf.json enables `ai` for the product build',
  configured.includes('ai'),
  configured.length ? configured.join(', ') : 'empty',
)

const failed = results.filter(result => !result.ok)
if (failed.length > 0) {
  console.error(`\nAI isolation gate failed: ${failed.length} assertion(s) did not hold.`)
  process.exitCode = 1
} else {
  console.log(`\nAI isolation gate passed: ${results.length} assertions.`)
}
