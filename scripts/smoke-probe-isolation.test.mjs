// DDQ14 — the test-only IPC surface must not exist in a production build.
//
// ## The defect, measured by the audit
//
// Twenty test-only Tauri commands were registered **unconditionally**: nine
// `terminal_smoke_*`, five `input_probe_*`, two `raw_input_probe_*`, two
// `remote_prompt_probe_*` and two `shell_probe_*`. Worse, `TerminalSmokeState::from_env()`
// ran in every build and reads `TERMINAL_SMOKE`, so a production binary started with that
// variable entered smoke mode and wrote to a caller-supplied path with the app's own
// privileges.
//
// The fix is the same shape `ai` and `smoke-vault-probe` already use: a cargo feature
// that makes the commands **absent** rather than disabled. `generate_handler!` re-emits
// `#[cfg]` on each arm, so a feature-off build has no handler for these names.
//
// ## Why a source-level test
//
// The claim is "these names are not in a build without the feature". Checking that against
// a built binary needs a Rust release build for every PR. The source is what establishes
// the property, and it is the same approach `gui-resource-series-integrity.test.mjs` takes
// for spec invariants.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const libRs = readFileSync(path.join(ROOT, 'src-tauri/src/lib.rs'), 'utf8')
const cargoToml = readFileSync(path.join(ROOT, 'src-tauri/Cargo.toml'), 'utf8')

/** Every command that exists only to drive a test harness. */
const TEST_ONLY_COMMANDS = [
  'terminal_smoke_config',
  'terminal_smoke_reconnect_policy',
  'terminal_smoke_renderer_heartbeat_config',
  'terminal_smoke_connected',
  'terminal_smoke_resources',
  'terminal_smoke_reconnect_requested',
  'terminal_smoke_host_wake',
  'terminal_smoke_emit_stale_output',
  'terminal_smoke_complete',
  'input_probe_config',
  'input_probe_diag',
  'input_probe_focus',
  'input_probe_ready',
  'input_probe_result',
  'raw_input_probe_config',
  'raw_input_probe_result',
  'remote_prompt_probe_config',
  'remote_prompt_probe_observed',
  'shell_probe_config',
  'shell_probe_result',
]

test('the smoke-probe feature exists and is not a default feature', () => {
  assert.match(cargoToml, /^smoke-probe\s*=/m, 'Cargo.toml must declare the feature')
  const defaults = /^default\s*=\s*\[([^\]]*)\]/m.exec(cargoToml)
  if (defaults) {
    assert.ok(
      !defaults[1].includes('smoke-probe'),
      'smoke-probe must not be a default feature',
    )
  }
})

test('every test-only command is behind the feature gate', () => {
  /*
   * The assertion is on the **list entry** in `generate_handler!`, not on the name
   * appearing anywhere: a `#[cfg]` on the `use` statement alone would leave the handler
   * registered and the binary would still answer the command.
   */
  const missing = []
  for (const command of TEST_ONLY_COMMANDS) {
    const gated = new RegExp(
      `#\\[cfg\\(feature = "smoke-probe"\\)\\]\\s*\\n\\s*${command},`,
    )
    if (!gated.test(libRs)) missing.push(command)
  }
  assert.deepEqual(
    missing,
    [],
    `these commands are registered without the feature gate: ${missing.join(', ')}`,
  )
})

test('the smoke state is not constructed without the feature', () => {
  /*
   * The commands are useless without the state, but the state is the dangerous half: it
   * is what reads `TERMINAL_SMOKE` and takes a caller-supplied result path.
   */
  for (const constructor of [
    'TerminalSmokeState::from_env()',
    'InputProbeState::from_env()',
    'RawInputProbeState::from_env()',
    'RemotePromptProbeState::from_env()',
    'ShellProbeState::from_env()',
  ]) {
    const escaped = constructor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(
      libRs,
      new RegExp(`#\\[cfg\\(feature = "smoke-probe"\\)\\]\\s*\\n\\s*let \\w+ = ${escaped}`),
      `${constructor} must be behind the feature, or a production binary reads the env var`,
    )
  }
})

test('the smoke modules themselves are gated', () => {
  // A module compiled into a feature-off build still links its code in, even if nothing
  // calls it — the point is that the binary does not contain it at all.
  for (const module of [
    'input_probe',
    'raw_input_probe',
    'remote_prompt_probe',
    'shell_interaction_probe',
    'terminal_smoke',
  ]) {
    assert.match(
      libRs,
      new RegExp(`#\\[cfg\\(feature = "smoke-probe"\\)\\]\\s*\\nmod ${module};`),
      `mod ${module} must be behind the feature`,
    )
  }
})

test('every smoke build command passes the feature', () => {
  /*
   * ## The failure mode this catches
   *
   * `VITE_TERMINAL_SMOKE_BUILD=1` compiles the smoke **frontend** in. The Rust commands
   * it calls need `--features smoke-probe`. A build with one and not the other produces
   * a UI that calls commands the binary does not have, and every runner would report the
   * product as broken.
   */
  const evidence = readFileSync(
    path.join(ROOT, 'scripts/build-verification-evidence.mjs'),
    'utf8',
  )
  for (const constant of ['DEBUG_BUILD_COMMAND', 'RELEASE_BUILD_COMMAND']) {
    const match = new RegExp(`const ${constant} =\\s*\\n?\\s*'([^']+)'`).exec(evidence)
    assert.ok(match, `${constant} must be present`)
    assert.ok(
      match[1].includes('--features smoke-probe'),
      `${constant} must pass --features smoke-probe, or the smoke UI calls commands that are not there`,
    )
  }
})
