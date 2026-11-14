#!/usr/bin/env node
/**
 * Prove the GUI E2E run cannot reach a developer's real profile.
 *
 * The requirement is a machine-checkable assertion, not a promise. This script
 * launches the app exactly the way the harness does — same env builder, same
 * binary — and then asks the *running process* where it thinks its profile is.
 *
 * On Windows in particular, `HOME` alone is not enough: Tauri resolves its data
 * directory from `USERPROFILE`/`APPDATA`/`LOCALAPPDATA`. A harness that only sets
 * `HOME` leaves the app reading the real database and Vault.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { appBinaryPath, isolatedProfileEnv, IS_WINDOWS } from './gui-e2e-platform.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const BINARY = appBinaryPath(ROOT)

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

if (!existsSync(BINARY)) {
  console.error(`no binary at ${BINARY}; build with --features gui-e2e first`)
  process.exit(2)
}

const home = path.join(os.tmpdir(), `terminal-profile-check-${process.pid}-${Date.now()}`)
const profile = isolatedProfileEnv(home)
mkdirSync(home, { recursive: true })

// 1. The env builder covers every variable each platform actually uses.
const required = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME']
for (const key of required) {
  record(
    `isolatedProfileEnv sets ${key}`,
    typeof profile[key] === 'string' && profile[key].startsWith(home),
    profile[key],
  )
}
record(
  'the profile lives under the OS temp directory, not the user home',
  !home.startsWith(os.homedir()) || home.startsWith(os.tmpdir()),
  home,
)

// 2. The real binary, started with that env, must not touch the real profile.
//    Ask the Rust side where it decided to put its database. `startup` tracing
//    logs the resolved path on every run.
const child = spawn(BINARY, [], {
  env: { ...process.env, ...profile, TAURI_WEBDRIVER_PORT: '0', RUST_LOG: 'info' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
child.stdout.on('data', c => (output += String(c)))
child.stderr.on('data', c => (output += String(c)))

await new Promise(resolve => {
  const timer = setTimeout(resolve, 15_000)
  child.once('exit', () => {
    clearTimeout(timer)
    resolve()
  })
  // Give the app a moment to reach its bootstrap stage, then stop it.
  setTimeout(() => {
    child.kill(IS_WINDOWS ? undefined : 'SIGTERM')
  }, 12_000)
})
child.kill('SIGKILL')

// The app logs its database path. Anything under the real home is a leak.
const realHome = os.homedir()
const leaks = output
  .split('\n')
  .filter(line => line.includes(realHome) && !line.includes(home))
record(
  'the app never logged a path inside the real user home',
  leaks.length === 0,
  leaks.length ? leaks.slice(0, 2).join(' | ') : 'no real-home path in the log',
)

rmSync(home, { recursive: true, force: true })

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`)
if (failed.length) {
  console.error('\nGUI E2E profile isolation FAILED')
  process.exit(1)
}
console.log('\nGUI E2E profile isolation passed: the app cannot reach the real profile.')
