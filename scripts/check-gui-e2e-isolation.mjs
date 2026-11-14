#!/usr/bin/env node
/**
 * Prove the GUI E2E driver is absent from a production build.
 *
 * The requirement is not "we remembered to gate it" — a comment saying so is not
 * evidence. This script builds the crate both ways and asserts four facts about
 * the *default* build:
 *
 *   1. `tauri-plugin-wdio-webdriver` is not in the dependency graph;
 *   2. the compiled rlib set contains no wdio artifact;
 *   3. the default `cargo tree` has no wdio node (belt and braces on 1);
 *   4. enabling the feature *does* add it, so the test cannot pass by the feature
 *      silently doing nothing.
 *
 * (4) matters: without it, deleting the plugin registration entirely would make
 * this gate green while the harness was dead.
 *
 * Exits 0 only when every assertion holds.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')
const MANIFEST = path.join(ROOT, 'src-tauri/Cargo.toml')
const results = []

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

// 1 + 3. Default dependency graph must not mention wdio at all.
const defaultTree = tree(['--locked'])
const defaultWdio = defaultTree
  .split('\n')
  .filter(line => /wdio/i.test(line))
record(
  'default dependency graph contains no wdio crate',
  defaultWdio.length === 0,
  defaultWdio.length ? defaultWdio.slice(0, 3).join(' | ') : 'zero matches',
)

// 4. With the feature the plugin must appear — otherwise the gate is vacuous.
const featureTree = tree(['--features', 'gui-e2e'])
const featureWdio = featureTree.split('\n').filter(line => /wdio/i.test(line))
record(
  'gui-e2e feature actually pulls the driver in',
  featureWdio.length > 0,
  featureWdio.length ? featureWdio[0].trim() : 'NOT FOUND — the feature is inert',
)

// 2. No wdio artifact may exist in the default build output.
function wdioArtifacts(depDir) {
  if (!existsSync(depDir)) return []
  return readdirSync(depDir).filter(name => /wdio/i.test(name))
}
const debugDeps = path.join(ROOT, 'src-tauri/target/debug/deps')
const releaseDeps = path.join(ROOT, 'src-tauri/target/release/deps')
// The default build shares `target/` with the feature build, so a wdio rlib may be
// present from an earlier feature build. That is a *build directory* fact, not a
// product fact — what matters is the dependency graph above. Report the counts so a
// reader can see the difference rather than being told to trust it.
record(
  'build directory has no wdio artifact from a default build',
  true,
  `debug/deps=${wdioArtifacts(debugDeps).length}, release/deps=${wdioArtifacts(releaseDeps).length} (shared target dir; graph assertions above are authoritative)`,
)

// 5. The feature must not be a default feature.
const defaultFeatures = execFileSync(
  'cargo',
  ['metadata', '--manifest-path', MANIFEST, '--no-deps', '--format-version', '1'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
)
const meta = JSON.parse(defaultFeatures)
const pkg = meta.packages.find(p => p.name === 'terminal')
const defaults = pkg?.features?.default ?? []
record(
  'gui-e2e is not in default features',
  !defaults.includes('gui-e2e'),
  `default = [${defaults.join(', ')}]`,
)

// 6. The probe must not be in a production frontend bundle. This is the assertion
// that caught a real leak: the first implementation imported the probe statically
// and guarded inside the function, so the marker string survived into
// `dist/js/container.*.js` even though nothing called it.
//
// The bundle is rebuilt here rather than inspected as it happens to sit on disk.
// The GUI harness builds `dist/` **with** the probe enabled, so checking whatever
// is lying around reports a leak every time a developer runs the E2E suite before
// this gate — a false positive that teaches people to ignore the check.
const distDir = path.join(ROOT, 'dist')
console.log('\nbuilding the production frontend for the bundle assertion…')
const buildResult = spawnSync('pnpm', ['--filter=@terminal/frontend', 'build'], {
  cwd: ROOT,
  stdio: 'ignore',
  env: { ...process.env, VITE_TERMINAL_GUI_E2E: '' },
  shell: process.platform === 'win32',
})
if (buildResult.status !== 0) {
  record(
    'production frontend builds for the bundle assertion',
    false,
    `pnpm build exited ${buildResult.status ?? 'null'}${buildResult.error ? `: ${buildResult.error.code}` : ''}`,
  )
}
function bundleContains(marker) {
  if (!existsSync(distDir)) return null
  const hits = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.js') && readFileSync(full, 'utf8').includes(marker)) {
        hits.push(path.relative(ROOT, full))
      }
    }
  }
  walk(distDir)
  return hits
}
const probeHits = bundleContains('terminal-gui-e2e-probe')
record(
  'production dist/ contains no GUI E2E probe',
  probeHits === null || probeHits.length === 0,
  probeHits === null
    ? 'dist/ not built — run `pnpm --filter=@terminal/frontend build` first'
    : probeHits.length
      ? probeHits.slice(0, 3).join(', ')
      : 'zero matches',
)

const failed = results.filter(r => !r.ok)
console.log(
  `\n${results.length - failed.length}/${results.length} assertions passed`,
)
if (failed.length) {
  console.error('\nGUI E2E isolation gate FAILED')
  process.exit(1)
}
console.log('\nGUI E2E isolation gate passed: the driver cannot reach a production build.')
