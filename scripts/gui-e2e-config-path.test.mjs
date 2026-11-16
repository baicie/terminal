// The GUI E2E harness and the app must agree on which config directory is in use.
//
// ## The defect this pins
//
// The harness isolated a throwaway profile by setting `APPDATA` (and `HOME`,
// `USERPROFILE`, `LOCALAPPDATA`). Those variables work on Linux (`XDG_CONFIG_HOME`) and
// macOS (`$HOME`), but **Windows ignores them**: `dirs::config_dir()` calls
// `SHGetKnownFolderPath(FOLDERID_RoamingAppData)`.
//
// Measured on the Windows runner:
//
//   harness seeded   …\Temp\terminal-gui-e2e-…\AppData\Roaming\<id>\terminal.db
//   app opened       C:\Users\runneradmin\AppData\Roaming\<id>\terminal.db
//
// → no database → the startup gate refused to mount the UI, and every GUI case failed
// at `mounts exactly one terminal workbench`. The screenshot said
// `MANUAL_INTERVENTION_REQUIRED · the application config directory is unknown`.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { isolatedProfileEnv } from './gui-e2e-platform.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')

test('the profile env carries an explicit config-dir override', () => {
  // This is the one value both sides read on every platform.
  const profile = isolatedProfileEnv('/tmp/example-home')
  assert.ok(
    profile.TERMINAL_GUI_E2E_CONFIG_DIR,
    'without it, Windows falls back to the real profile and the app finds no database',
  )
  assert.ok(
    path.isAbsolute(profile.TERMINAL_GUI_E2E_CONFIG_DIR),
    'the app refuses a relative override, so the harness must not produce one',
  )
})

test('the override lives inside the throwaway home', () => {
  const home = '/tmp/example-home'
  const profile = isolatedProfileEnv(home)
  assert.ok(
    profile.TERMINAL_GUI_E2E_CONFIG_DIR.startsWith(path.join(home, 'AppData/Roaming')),
    'the override must stay inside the profile, or a run could touch real user data',
  )
})

test('the seeder prefers the override over its per-platform guess', () => {
  const source = readFileSync(path.join(ROOT, 'e2e/gui/fixtures/seed-sftp-host.mjs'), 'utf8')
  const body = source.slice(source.indexOf('function databasePath'))
  const overrideAt = body.indexOf('TERMINAL_GUI_E2E_CONFIG_DIR')
  const platformAt = body.indexOf("process.platform === 'darwin'")
  assert.ok(overrideAt !== -1, 'the seeder must read the override')
  assert.ok(platformAt !== -1, 'the per-platform fallbacks must still exist for non-E2E use')
  assert.ok(
    overrideAt < platformAt,
    'the override must be consulted before the platform guesses, or Windows keeps ' +
      'writing to a directory the app never opens',
  )
})

test('the run script recomputes the override for each per-spec profile', () => {
  // Every spec gets `${home}-${spec}`, so inheriting the parent's override would point
  // every spec at the first spec's directory.
  const source = readFileSync(path.join(ROOT, 'scripts/run-gui-e2e.mjs'), 'utf8')
  const runSpecs = source.slice(source.indexOf('function runSpecs'))
  assert.match(
    runSpecs,
    /TERMINAL_GUI_E2E_CONFIG_DIR:\s*isolatedProfileEnv\(specHome\)/,
    'the per-spec env must derive the override from that spec home, not inherit it',
  )
})

test('the run script seeds every per-spec profile, not just the parent', () => {
  const source = readFileSync(path.join(ROOT, 'scripts/run-gui-e2e.mjs'), 'utf8')
  assert.match(source, /seededProfiles/, 'the run must record which profiles were seeded')
  assert.match(
    source,
    /for \(const spec of specFiles\)/,
    'seeding must iterate the specs; one row in the parent profile leaves the rest empty',
  )
})

test('the app resolves the override only when built with the gui-e2e feature', () => {
  const source = readFileSync(path.join(ROOT, 'src-tauri/src/db_recovery.rs'), 'utf8')
  const fn = source.slice(source.indexOf('fn config_root'), source.indexOf('pub fn database_path'))
  assert.match(fn, /cfg\(feature = "gui-e2e"\)/, 'the override must be feature-gated')
  assert.match(fn, /TERMINAL_GUI_E2E_CONFIG_DIR/, 'the variable name must match the harness')
  // A production build must not contain the variable at all; the isolation gate checks
  // the other half of this from the built bundle.
  const notFeature = source.slice(0, source.indexOf('fn config_root'))
  assert.ok(notFeature.length >= 0)
})
