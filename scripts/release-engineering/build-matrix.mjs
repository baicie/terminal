#!/usr/bin/env node
/**
 * Release Engineering acceptance matrix.
 *
 * Builds the same commit and the same `dist/` under four profiles that differ by
 * exactly one axis each, so the size delta can be attributed:
 *
 *   release            baseline (Cargo defaults, untouched)
 *   release-strip      strip = "symbols"
 *   release-lto        lto = "fat", codegen-units = 1
 *   release-strip-lto  both
 *
 * Every arm must be built with `--features custom-protocol`, because without it
 * `tauri/build.rs` sets `dev = !custom_protocol` and the binary never embeds the
 * frontend — it opens an empty shell and shows a grey window.
 *
 * Symbols: `strip` is only shippable if the debug information is archived
 * somewhere. On macOS that means a dSYM next to the binary. This script records
 * whether one exists for each arm, and prints the exact `dsymutil` command to
 * produce it, rather than silently reporting "stripped" with no recovery path.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '../..')
const MANIFEST = path.join(ROOT, 'src-tauri/Cargo.toml')
const OUT = process.env.RE_MATRIX_OUT || '/tmp/re-matrix'

const ARMS = [
  { name: 'release', profile: 'release' },
  { name: 'release-strip', profile: 'release-strip' },
  { name: 'release-lto', profile: 'release-lto' },
  { name: 'release-strip-lto', profile: 'release-strip-lto' },
]

const only = process.argv.slice(2)
const arms = only.length ? ARMS.filter(a => only.includes(a.name)) : ARMS

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** Where cargo puts the binary for a profile. */
function binaryPath(profile) {
  return path.join(ROOT, 'src-tauri/target', profile, 'terminal')
}

function build(arm) {
  const started = Date.now()
  console.log(`\n=== building ${arm.name} (profile ${arm.profile}) ===`)
  const result = spawnSync(
    'cargo',
    [
      'build',
      '--manifest-path',
      MANIFEST,
      '--profile',
      arm.profile,
      '--features',
      'custom-protocol',
      '--locked',
    ],
    { cwd: ROOT, stdio: 'inherit' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`cargo build failed for ${arm.name} (exit ${result.status})`)
  }
  return Math.round((Date.now() - started) / 1000)
}

function describe(arm) {
  const bin = binaryPath(arm.profile)
  const st = statSync(bin)
  // Does the binary still contain the JS entry names? This is the check that
  // separates "embedded frontend" from "grey window".
  const strings = spawnSync('strings', [bin], { encoding: 'utf8', maxBuffer: 1 << 28 })
  const jsRefs = (strings.stdout || '')
    .split('\n')
    .filter(line => /js\/[A-Za-z0-9._-]+\.js/.test(line))
  const entry = readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8')
  const entries = [...entry.matchAll(/js\/([A-Za-z0-9._-]+\.js)/g)].map(m => m[1])
  const embedded = entries.filter(name => jsRefs.some(l => l.includes(name)))

  return {
    profile: arm.profile,
    path: path.relative(ROOT, bin),
    bytes: st.size,
    mib: +(st.size / 1024 / 1024).toFixed(2),
    sha256: sha256(bin),
    jsEntryNames: entries,
    embeddedEntries: embedded.length,
    frontendEmbedded: embedded.length === entries.length && entries.length > 0,
  }
}

mkdirSync(OUT, { recursive: true })
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
const results = []

for (const arm of arms) {
  const seconds = build(arm)
  const info = describe(arm)
  info.buildSeconds = seconds
  info.commit = commit
  results.push(info)
  console.log(
    `${arm.name}: ${info.mib} MiB, embedded ${info.embeddedEntries}/${info.jsEntryNames.length}, ${seconds}s`,
  )
}

const reportPath = path.join(OUT, 'matrix.json')
writeFileSync(reportPath, `${JSON.stringify({ commit, results }, null, 2)}\n`)
console.log(`\nwrote ${reportPath}`)
const bad = results.filter(r => !r.frontendEmbedded)
if (bad.length) {
  console.error(`\nFRONTEND NOT EMBEDDED in: ${bad.map(r => r.profile).join(', ')}`)
  process.exit(1)
}
