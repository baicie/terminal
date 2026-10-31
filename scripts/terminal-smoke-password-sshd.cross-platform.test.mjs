import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import {
  buildNativePasswordSshdPlan,
  resolvePasswordSshdBackend,
  resolvedNativeHelpers,
  startTerminalSmokePasswordSshd,
} from './terminal-smoke-password-sshd.mjs'

const execFileAsync = promisify(execFile)
const SCRIPT_PATH = path.join(
  import.meta.dirname,
  'terminal-smoke-password-sshd.mjs',
)
const SCRIPT_URL = pathToFileURL(SCRIPT_PATH).href

// Runs `source` with `mod` bound to a fresh process's own import of this
// module, so importing it can be observed instead of assumed.
async function runWithFreshModule(source) {
  const probe = [`const mod = await import(${JSON.stringify(SCRIPT_URL)})`, source].join(
    '\n',
  )
  const { stdout } = await execFileAsync(process.execPath, [
    '--input-type=module',
    '--eval',
    probe,
  ])
  return stdout.trim()
}

// This file is the first place the module is imported in its own process, and
// nothing below it starts the native backend, so an empty snapshot here says
// the import itself probed for no macOS helper.
test('importing the fixture module probes for no macOS helper', async () => {
  const imported = JSON.parse(
    await runWithFreshModule(
      'process.stdout.write(JSON.stringify(mod.resolvedNativeHelpers()))',
    ),
  )
  assert.deepEqual(imported, [])
  assert.deepEqual(resolvedNativeHelpers(), [])
})

test('a linux or win32 backend selection never resolves a macOS helper', async () => {
  const dockerOnLinux = await resolvePasswordSshdBackend({
    dependencies: {
      env: { TERMINAL_SMOKE_PASSWORD_BACKEND: 'docker' },
      platform: 'linux',
    },
  })
  assert.equal(dockerOnLinux, 'docker')

  const dockerOnWindows = await resolvePasswordSshdBackend({
    dependencies: {
      env: { TERMINAL_SMOKE_PASSWORD_BACKEND: 'docker' },
      platform: 'win32',
    },
  })
  assert.equal(dockerOnWindows, 'docker')

  // An explicit native request is refused by the platform check, which is the
  // only place that reads the platform; dscl must not be probed for it either.
  await assert.rejects(
    () =>
      resolvePasswordSshdBackend({
        dependencies: {
          env: { TERMINAL_SMOKE_PASSWORD_BACKEND: 'native' },
          platform: 'linux',
        },
      }),
    /only exist on macOS/,
  )

  assert.deepEqual(resolvedNativeHelpers(), [])
})

test('a win32 host is refused before any fixture dependency runs', async () => {
  const calls = []
  await assert.rejects(
    () =>
      startTerminalSmokePasswordSshd({
        dependencies: {
          env: {},
          log: line => calls.push(`log:${line}`),
          mkdir: async () => calls.push('mkdir'),
          platform: 'win32',
          spawn: () => calls.push('spawn'),
          writeFile: async () => calls.push('writeFile'),
        },
        runDirectory: path.join(process.cwd(), 'terminal-smoke-win32-refused'),
      }),
    /only supported on macOS and Linux/,
  )
  assert.deepEqual(calls, [])
  assert.deepEqual(resolvedNativeHelpers(), [])
})

test('the native plan names the macOS helpers it will run without resolving them', () => {
  const plan = buildNativePasswordSshdPlan({
    directory: '/tmp/terminal-smoke-cross-platform/password-sshd-native',
    username: 'tmsmokec0ffee00',
  })
  const args = plan.accountSteps.flatMap(step => step.args ?? [])
  assert.ok(args.includes('/usr/bin/dscl'))
  assert.ok(args.includes('/usr/sbin/chown'))
  assert.ok(args.includes('/bin/chmod'))
  assert.deepEqual(resolvedNativeHelpers(), [])
})
