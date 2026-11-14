#!/usr/bin/env node
/**
 * Run the native GUI E2E suite against the real Tauri app.
 *
 * Responsibilities, all of which exist because getting them wrong is how a GUI
 * test suite becomes dangerous or useless:
 *
 *   • build with the `gui-e2e` feature (never the default feature set);
 *   • create a throwaway HOME so the app cannot touch the real database, vault or
 *     SSH keys;
 *   • refuse to run when the binary was NOT built with the feature, with the
 *     reason spelled out rather than a bare timeout;
 *   • write the evidence bundle and exit non-zero on failure.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')
const BINARY = path.join(ROOT, 'src-tauri/target/release/terminal')
const ARTIFACTS = path.join(ROOT, 'e2e/gui/artifacts')

function log(message) {
  console.log(`[gui-e2e] ${message}`)
}

/** Does this binary contain the embedded WebDriver server? */
function binaryHasDriver(file) {
  try {
    // The readiness string lives in the plugin. A build without the `gui-e2e`
    // feature cannot contain it, which is the same fact the isolation gate
    // asserts from the other direction.
    return execFileSync('strings', [file], { encoding: 'utf8', maxBuffer: 1 << 28 }).includes(
      'tauri-plugin-webdriver is ready',
    )
  } catch {
    return false
  }
}

const args = new Set(process.argv.slice(2))
const skipBuild = args.has('--no-build')

if (!skipBuild) {
  log('building frontend with the GUI E2E probe')
  // The probe is compiled in only when this is set, so a production `dist/` never
  // contains it. `tauri build` rebuilds the frontend, so the variable has to be
  // in the environment for that step too.
  const frontend = spawnSync('pnpm', ['--filter=@terminal/frontend', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, VITE_TERMINAL_GUI_E2E: '1' },
  })
  if (frontend.status !== 0) process.exit(frontend.status ?? 1)

  log('building the app with --features gui-e2e (via tauri build)')
  const build = spawnSync(
    'pnpm',
    ['tauri', 'build', '--no-bundle', '--', '--features', 'gui-e2e'],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, VITE_TERMINAL_GUI_E2E: '1' } },
  )
  if (build.status !== 0) process.exit(build.status ?? 1)
}

if (!existsSync(BINARY)) {
  console.error(`[gui-e2e] no binary at ${BINARY}`)
  process.exit(2)
}
if (!binaryHasDriver(BINARY)) {
  console.error(
    '[gui-e2e] the binary does not contain the embedded WebDriver server.\n' +
      '          It was built without `--features gui-e2e`. Re-run without --no-build,\n' +
      '          or rebuild: pnpm tauri build --no-bundle -- --features gui-e2e',
  )
  process.exit(2)
}

const home = path.join(
  os.tmpdir(),
  `terminal-gui-e2e-${process.pid}-${Date.now()}`,
)
mkdirSync(home, { recursive: true })
mkdirSync(ARTIFACTS, { recursive: true })

const sha = createHash('sha256').update(readFileSync(BINARY)).digest('hex')
log(`binary sha256 ${sha}`)
log(`isolated HOME ${home}`)

const run = spawnSync(
  'npx',
  ['wdio', 'run', 'wdio.conf.mjs', ...process.argv.slice(2).filter(a => a.startsWith('--spec'))],
  {
    cwd: path.join(ROOT, 'e2e/gui'),
    stdio: 'inherit',
    env: {
      ...process.env,
      GUI_E2E_BINARY: BINARY,
      GUI_E2E_HOME: home,
    },
  },
)

// Summarise whatever the run left behind, then clean the throwaway profile. The
// evidence files reference the home path but never contain its contents.
const summary = {
  ranAt: new Date().toISOString(),
  binary: { path: path.relative(ROOT, BINARY), sha256: sha },
  platform: { platform: process.platform, arch: process.arch, release: os.release() },
  isolatedHome: home,
  exitCode: run.status,
  verdict: run.status === 0 ? 'PASS' : 'FAIL',
}
writeFileSync(
  path.join(ARTIFACTS, 'run-summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
)

// The isolated profile is disposable by construction. Removing it keeps a
// developer's tmp from filling with databases after a few hundred runs.
rmSync(home, { recursive: true, force: true })

log(`finished with exit ${run.status}`)
process.exit(run.status ?? 1)
