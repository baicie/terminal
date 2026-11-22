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
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { sqliteProblem } from './gui-e2e-preconditions.mjs'
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

  // ## Verify the probe actually landed in the bundle
  //
  // Measured on the Windows runner: every spec failed with `the read-only GUI E2E
  // probe is absent — the frontend was built without VITE_TERMINAL_GUI_E2E=1`, while
  // the same run built the frontend twice without complaint. `tauri build` runs
  // `beforeBuildCommand` itself, so a build that loses the variable produces a
  // perfectly good binary with no probe in it — and the failure then looks like a
  // product defect in every spec instead of a build misconfiguration.
  //
  // Checking the artifact here turns that into one message at the point it happened.
  const probePath = path.join(ROOT, 'dist', 'js')
  let probeFound = false
  try {
    probeFound = readdirSync(probePath).some(name => name.startsWith('gui-e2e-probe'))
  } catch {
    probeFound = false
  }
  if (!probeFound) {
    fail(
      'the GUI E2E probe is missing from dist/js after the build.\n' +
        `  looked in: ${path.relative(ROOT, probePath)}\n` +
        '  `tauri build` runs beforeBuildCommand itself; if that step did not inherit\n' +
        '  VITE_TERMINAL_GUI_E2E=1 the bundle is a normal production build and every\n' +
        '  spec fails claiming the probe is absent. Re-run, and if it persists check\n' +
        '  that the variable reaches the beforeBuildCommand subprocess.',
    )
  }

  // ## The file-picker substitution is a second, independent flag site
  //
  // Same failure, different symptom. Measured on this machine: a run whose binary had
  // no `__terminalE2EFilePickerMarker` still printed **6 passing** for e2e-06, while
  // its evidence recorded `notRunCount: 9` and a null marker. Every upload/download
  // case had returned early, so nothing was driven and nothing failed — the exact
  // shape the probe guard above exists to prevent, one build flag later.
  //
  // Checking the chunk here is what makes that a build error instead of a green run
  // that proves nothing.
  let pickerFound = false
  try {
    pickerFound = readdirSync(probePath).some(name =>
      name.startsWith('e2e-file-picker'),
    )
  } catch {
    pickerFound = false
  }
  if (!pickerFound) {
    fail(
      'the E2E file-picker substitution is missing from dist/js after the build.\n' +
        `  looked in: ${path.relative(ROOT, probePath)}\n` +
        '  Without it every upload/download case records NOT_RUN while the spec\n' +
        '  still reports "passing", so the suite would prove nothing about real bytes.',
    )
  }
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

// Seed a real SSH host before the app starts, so the dock spec exercises a live
// connection instead of the empty state.
//
// ## Why this is no longer opt-in
//
// It was `--with-ssh-fixture`, and no workflow passed it — so every CI run had no
// SSH host, the dock spec took its empty-state branch, and the cases that need a
// live connection recorded NOT_RUN instead of running. The opt-in turned the
// interesting half of the suite off by default and nothing noticed.
//
// The fixture needs `sshd` and `ssh-keygen` at Unix paths, which Windows does not
// have. So availability is probed rather than assumed:
//
//   * available → start it, and `GUI_E2E_SSH_PORT` tells the specs they may connect;
//   * unavailable → no fixture, and the reason is printed and carried into the
//     evidence summary, so a run without a host is visibly different from one that
//     never tried.
//
// `--no-ssh-fixture` forces the old behaviour for a machine that cannot run one.
const sshFixtureRequested = !flags.has('--no-ssh-fixture')
let fixture = null
let fixtureSkipReason = null

/*
 * ## Refuse to run the SSH-backed suite on a Node that cannot start the fixture
 *
 * Measured on this machine: Node 22.12.0, `node:sqlite` is `No such built-in module`.
 * The fixture starts sshd and then cannot write the host row, so it is declared
 * unavailable — and **every spec still reports green**. `e2e-03` was observed at
 * "11 passing, exit 0" with `verdict: PARTIAL`, `notRunCount: 10` and every remote case
 * recording NOT_RUN. The reason existed only as one line of `fixtureSkipReason` in a
 * summary written after the run.
 *
 * A run that cannot touch a server must not look like a run that checked one. This is
 * checked here rather than left to the fixture's own error message because by then the
 * suite has already started, and wdio's reporter is what a reader looks at.
 */
function requireSqliteForFixture() {
  if (!sshFixtureRequested) return
  const problem = sqliteProblem(createRequire(import.meta.url))
  if (problem !== null) fail(problem)
}
requireSqliteForFixture()

if (sshFixtureRequested) {
  try {
    const { startSeededSshd } = await import('../e2e/gui/fixtures/seed-sftp-host.mjs')
    log('starting a throwaway sshd and seeding a host into the profile')
    fixture = await startSeededSshd({ home })
    log(`sshd on 127.0.0.1:${fixture.port}; host row written to ${fixture.databaseFile}`)
    /*
     * A second server, for the cases that need two *different* hosts.
     *
     * `e2e-03` records "host switch with two connected hosts" as NOT_RUN because it
     * has only one. A second sshd on its own port with its own host key is what makes
     * "the panel follows the tab, not the last connection" checkable: with one server
     * a wrong binding still lists the right files.
     *
     * A failure here is not fatal — the single-host cases still run, and the two-host
     * case keeps recording NOT_RUN with the reason.
     */
    try {
      fixture.secondary = await startSeededSshd({
        home,
        label: 'E2E Second',
        hostId: 'e2e-sftp-host-second',
      })
      log(`second sshd on 127.0.0.1:${fixture.secondary.port}`)
    } catch (error) {
      log(`no second sshd: ${error.message}`)
    }

  } catch (error) {
    // A missing daemon is not a failed suite. It is a missing precondition, and it
    // is reported as one — the specs then record NOT_RUN for the cases that need it
    // instead of failing on a timeout that says nothing about the product.
    fixtureSkipReason = error.message
    log(`no SSH fixture: ${error.message}`)
  }
}

/**
 * Run the specs, isolating each from the next.
 *
 * ## Why per-spec instead of one `wdio run`
 *
 * `maxInstances: 1` means one app process serves every spec, so state carried over:
 * measured, `e2e-03` ends with the dock open on a connected SSH host, and running it
 * *before* `e2e-01` made the launch-state assertions fail — the suite only worked in
 * the one order it was written in.
 *
 * Two things were tried first and both were wrong:
 *
 *   * closing the extra tab in a baseline hook — closing a tab does not dispose its
 *     PTY, so `e2e-01` still saw two `[data-terminal-workbench]` nodes;
 *   * resetting the dock and route per suite — that fixed the dock, but the active
 *     tab was still the previous spec's SSH session, so the readiness assertions
 *     read a connection that had never shown a local prompt.
 *
 * A fresh process per spec is the only reset that makes the order irrelevant, and it
 * is cheap next to the build: each spec already pays for a WebDriver session.
 * `--one-run` keeps the old single-process behaviour for debugging state carry-over.
 */
function runSpecs(specFiles, environment) {
  if (!process.env.GUI_E2E_ONE_RUN && specFiles.length > 0) {
    const runs = []
    for (const spec of specFiles) {
      log(`running ${spec} in its own app process`)
      runs.push(
        runCommand('npx', ['wdio', 'run', 'wdio.conf.mjs', '--spec', spec], {
          cwd: path.join(ROOT, 'e2e/gui'),
          env: {
            ...environment,
            // A distinct profile per spec: the app is new, so its state must be too.
            ...(() => {
              const specHome = `${environment.GUI_E2E_HOME}-${path.basename(spec, '.e2e.mjs')}`
              return {
                GUI_E2E_HOME: specHome,
                // ## Recomputed from the spec's own home
                //
                // `TERMINAL_GUI_E2E_CONFIG_DIR` is an absolute path the app reads
                // directly. Copying the parent's value here would point every spec at
                // the *first* spec's profile — the app would open one database while
                // the harness inspected another, which is the same class of mismatch
                // that made Windows fail. Derive it from the home this spec will use.
                TERMINAL_GUI_E2E_CONFIG_DIR: isolatedProfileEnv(specHome).TERMINAL_GUI_E2E_CONFIG_DIR,
              }
            })(),
          },
        }),
      )
    }
    const failed = runs.filter(run => !run.ok)
    return {
      ok: failed.length === 0,
      // The first failure's status is what the process exit code should be, and its
      // spawn error (if any) is the one worth printing.
      status: failed.length === 0 ? 0 : (failed[0].status ?? 1),
      error: failed[0]?.error,
    }
  }
  return runCommand('npx', ['wdio', 'run', 'wdio.conf.mjs', ...specArgs], {
    cwd: path.join(ROOT, 'e2e/gui'),
    env: environment,
  })
}

// Which specs to run, in order. An explicit `--spec` wins so a developer can run one
// case; otherwise every spec, alphabetically, which is the documented order.
const explicitSpecs = argv
  .map((arg, index) => (arg === '--spec' ? argv[index + 1] : null))
  .filter(value => typeof value === 'string')
const specFiles = flags.has('--one-run')
  ? []
  : explicitSpecs.length > 0
    ? explicitSpecs
    : readdirSync(path.join(ROOT, 'e2e/gui/specs'))
        .filter(name => name.endsWith('.e2e.mjs'))
        .sort()
        .map(name => `./specs/${name}`)

// ## Every spec gets its own profile, so every profile needs the seeded host row
//
// `runSpecs` derives `${home}-${spec}` per spec (a fresh app must start from fresh
// state). Seeding only `home` left those profiles without a database, so the
// SFTP-backed cases recorded NOT_RUN against a host list that was never populated —
// and on Windows the startup gate refused to mount the UI at all, because the database
// it looked for did not exist in the profile it was actually using.
if (fixture !== null && specFiles.length > 0) {
  const { seedSftpHost, trustHostKey } = await import('../e2e/gui/fixtures/seed-sftp-host.mjs')
  fixture.seededProfiles = []
  for (const spec of specFiles) {
    const specHome = `${home}-${path.basename(spec, '.e2e.mjs')}`
    const configDir = isolatedProfileEnv(specHome).TERMINAL_GUI_E2E_CONFIG_DIR
    fixture.seededProfiles.push(
      await seedSftpHost({
        home: specHome,
        configDir,
        privateKeyPath: fixture.userKeyPath,
        port: fixture.port,
        username: fixture.username,
        label: 'E2E Local',
      }),
    )
    /*
     * The second server needs its own row in the same profile.
     *
     * Seeding it only into the parent profile left the per-spec one with a single
     * host, and the two-host case failed with "no card labelled E2E Second" — the case
     * was correct, the fixture had not put the row where the app reads it.
     */
    if (fixture.secondary) {
      await seedSftpHost({
        home: specHome,
        configDir,
        privateKeyPath: fixture.secondary.userKeyPath,
        port: fixture.secondary.port,
        username: fixture.secondary.username,
        label: 'E2E Second',
        hostId: 'e2e-sftp-host-second',
      })
    }
    /*
     * Each profile is a separate `HOME`, so each needs the host key trusted too.
     *
     * The app refuses an unknown host key. Without this the seeded host connects and
     * then fails verification, which the dock renders as an empty directory — the
     * exact shape the SFTP cases recorded NOT_RUN against for several rounds.
     */
    await trustHostKey({
      home: specHome,
      hostKeyPath: fixture.hostKeyPath,
      port: fixture.port,
    })
    if (fixture.secondary) {
      // A different server presents a different host key; trusting only the first
      // would leave the second refused with the same "unknown key" failure.
      await trustHostKey({
        home: specHome,
        hostKeyPath: fixture.secondary.hostKeyPath,
        port: fixture.secondary.port,
      })
    }
  }
  log(`seeded ${fixture.seededProfiles.length} per-spec profile(s)`)
}

const run = runSpecs(specFiles, {
  ...process.env,
  GUI_E2E_BINARY: binary,
  GUI_E2E_HOME: home,
  GUI_E2E_SSH_PORT: fixture ? String(fixture.port) : '',
  /*
   * The only directory a spec may write to over SFTP.
   *
   * The fixture's sshd runs as the developer's account, so the pane can reach their
   * real `$HOME`. Handing every spec the same contained directory is what lets an
   * upload test assert on real bytes without touching user files.
   */
  GUI_E2E_REMOTE_ROOT: fixture ? fixture.remoteRoot : '',
  /*
   * The second server's writable root.
   *
   * The write case proves "these writes did not land on the other host" by reading that
   * host's directory. Reading it through the *pane* would ask the product whether the
   * product misbehaved; this is the server's own answer, from the same Node process.
   */
  GUI_E2E_REMOTE_ROOT_2: fixture?.secondary ? fixture.secondary.remoteRoot : '',
  /** Port of the second server, for the two-host cases. Empty when unavailable. */
  GUI_E2E_SSH_PORT_2: fixture?.secondary ? String(fixture.secondary.port) : '',
})

if (fixture !== null) {
  await fixture.stop()
  log('stopped the ssh fixture')
}

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
  // Recorded explicitly: a run with no SSH host cannot make the claims that need
  // one, and the summary has to say which run this was.
  sshFixture: fixture
    ? { started: true, port: fixture.port }
    : { started: false, reason: fixtureSkipReason ?? 'disabled by --no-ssh-fixture' },
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
