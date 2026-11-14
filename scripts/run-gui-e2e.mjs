#!/usr/bin/env node
/**
 * Run the native GUI E2E suite against the real Tauri app.
 *
 * Responsibilities, all of which exist because getting them wrong is how a GUI
 * test suite becomes dangerous or useless:
 *
 *   • build with the `gui-e2e` feature (never the default feature set);
 *   • create a throwaway profile so the app cannot touch the real database, Vault
 *     or SSH keys — on Windows that means USERPROFILE/APPDATA/LOCALAPPDATA too;
 *   • refuse to run when the binary was NOT built with the feature, with the
 *     reason spelled out rather than a bare timeout;
 *   • never turn a failed spawn into a silent exit 1 (see `gui-e2e-platform.mjs`).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {
  appBinaryPath,
  binaryHasWebDriver,
  describeFailure,
  isolatedProfileEnv,
  IS_WINDOWS,
  runCommand,
} from './gui-e2e-platform.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')

function log(message) {
  console.log(`[gui-e2e] ${message}`)
}

function fail(message) {
  console.error(`[gui-e2e] ${message}`)
  process.exit(1)
}

const argv = process.argv.slice(2)
const flags = new Set(argv.filter(a => a.startsWith('--')))
const specArgs = argv
  .map((arg, index) => (arg === '--spec' ? ['--spec', argv[index + 1]] : null))
  .filter(Boolean)
  .flat()
  .filter(v => v !== undefined)

const skipBuild = flags.has('--no-build')

if (!skipBuild) {
  log('building frontend with the GUI E2E probe')
  // The probe is compiled in only when this is set, so a production `dist/` never
  // contains it. `tauri build` rebuilds the frontend, so the variable has to be
  // in the environment for that step too.
  const frontend = runCommand('pnpm', ['--filter=@terminal/frontend', 'build'], {
    cwd: ROOT,
    env: { ...process.env, VITE_TERMINAL_GUI_E2E: '1' },
  })
  if (!frontend.ok) fail(describeFailure('frontend build', frontend))

  log('building the app with --features gui-e2e (via tauri build)')
  const build = runCommand(
    'pnpm',
    ['tauri', 'build', '--no-bundle', '--', '--features', 'gui-e2e'],
    { cwd: ROOT, env: { ...process.env, VITE_TERMINAL_GUI_E2E: '1' } },
  )
  if (!build.ok) fail(describeFailure('tauri build', build))
}

const binary = appBinaryPath(ROOT)
const marker = binaryHasWebDriver(binary)
if (!marker.present) {
  fail(
    `the app binary cannot be used for GUI E2E.\n` +
      `  path:   ${binary}\n` +
      `  reason: ${marker.reason}\n` +
      (marker.reason === 'binary missing'
        ? '  It was not built. Re-run without --no-build.'
        : '  Rebuild: pnpm tauri build --no-bundle -- --features gui-e2e'),
  )
}

const home = path.join(os.tmpdir(), `terminal-gui-e2e-${process.pid}-${Date.now()}`)
const profile = isolatedProfileEnv(home)
for (const dir of [home, profile.APPDATA, profile.LOCALAPPDATA, profile.XDG_CONFIG_HOME]) {
  mkdirSync(dir, { recursive: true })
}

log(`binary ${path.relative(ROOT, binary)}`)
log(`isolated profile ${home}`)
log(
  `isolation env: ${Object.keys(profile)
    .map(key => `${key}=${path.relative(home, profile[key]) || '.'}`)
    .join(' ')}`,
)

const run = runCommand('npx', ['wdio', 'run', 'wdio.conf.mjs', ...specArgs], {
  cwd: path.join(ROOT, 'e2e/gui'),
  env: {
    ...process.env,
    GUI_E2E_BINARY: binary,
    GUI_E2E_HOME: home,
  },
})

if (!run.ok && run.error) {
  // A failed spawn is not a failed test. Say so, keep the profile for inspection,
  // and do not claim any case ran.
  console.error(describeFailure('wdio', run))
  console.error(`[gui-e2e] the isolated profile was left at ${home} for inspection`)
  process.exit(1)
}

// Summarise whatever the run left behind, then clean the throwaway profile.
const summary = {
  ranAt: new Date().toISOString(),
  platform: {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
  },
  binary: { path: path.relative(ROOT, binary) },
  isolatedProfile: { path: home, variables: Object.keys(profile) },
  exitCode: run.status,
  verdict: run.ok ? 'PASS' : 'FAIL',
}
writeFileSync(
  path.join(ROOT, 'e2e/gui/artifacts/run-summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
)

// The isolated profile is disposable by construction; removing it keeps a
// developer's tmp from filling with databases after a few hundred runs. On
// Windows a locked SQLite file can make the removal fail — that is reported but
// does not change the test verdict.
if (process.env.GUI_E2E_KEEP_PROFILE === '1') {
  log(`profile kept at ${home} (GUI_E2E_KEEP_PROFILE=1)`)
} else {
  try {
    rmSync(home, { recursive: true, force: true })
  } catch (error) {
    console.warn(`[gui-e2e] could not remove ${home}: ${error.message}`)
  }
}

log(`finished with exit ${run.status}`)
process.exit(run.ok ? 0 : (run.status ?? 1))
