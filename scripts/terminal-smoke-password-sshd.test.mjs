import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { accessSync, constants, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { promisify } from 'node:util'

import {
  NATIVE_CHMOD,
  NATIVE_CHOWN,
  buildNativePasswordSshdPlan,
  ensurePasswordSshdImage,
  formatNativePasswordSshdPlan,
  renderNativeSshdConfig,
  resolvePasswordSshdBackend,
  runDockerCommand,
} from './terminal-smoke-password-sshd.mjs'

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  killedWith = null

  constructor(pid) {
    super()
    this.pid = pid
  }

  kill(signal) {
    this.killedWith = signal
    // A real killed docker build can leave BuildKit grandchildren holding the
    // stdio pipes, so `close` may never arrive while `exit` does.
    queueMicrotask(() => this.emit('exit', null, signal))
    return true
  }
}

function createDependencies({ results = [] } = {}) {
  const calls = []
  let index = 0
  const dependencies = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    spawn: (command, args) => {
      const child = new FakeChild(6_000 + calls.length)
      calls.push({ args, command })
      const result = results[index] ?? {}
      index += 1
      if (!result.hang) {
        queueMicrotask(() => {
          child.stdout.end(result.stdout ?? '')
          child.stderr.end(result.stderr ?? '')
          child.emit('close', result.code ?? 0, result.signal ?? null)
        })
      }
      return child
    },
  }
  return { calls, dependencies }
}

test('a killed docker build settles instead of waiting for a close that never arrives', async () => {
  const { dependencies } = createDependencies({ results: [{ hang: true }] })
  const started = Date.now()
  await assert.rejects(
    () =>
      runDockerCommand(
        ['build', '--quiet', '-t', 'image', '/tmp/context'],
        { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
        dependencies,
        50,
        'password OpenSSH image build',
      ),
    /timed out after 50 ms/,
  )
  assert.ok(Date.now() - started < 5_000)
})

test('reuses a local password sshd image instead of rebuilding it', async () => {
  const { calls, dependencies } = createDependencies({
    results: [{ code: 0, stdout: 'terminal-smoke-password-sshd:latest\n' }],
  })
  const image = await ensurePasswordSshdImage('/tmp/context', dependencies)
  assert.equal(image, 'terminal-smoke-password-sshd:latest')
  assert.deepEqual(calls[0].args.slice(0, 2), ['image', 'inspect'])
  assert.equal(
    calls.some(call => call.args[0] === 'build'),
    false,
  )
})

test('builds the password sshd image only when it is missing locally', async () => {
  const { calls, dependencies } = createDependencies({
    results: [{ code: 1, stderr: 'No such image\n' }, { code: 0 }],
  })
  const image = await ensurePasswordSshdImage('/tmp/context', dependencies)
  assert.equal(image, 'terminal-smoke-password-sshd:latest')
  assert.deepEqual(calls[1].args.slice(0, 1), ['build'])
})

const SCRIPT_PATH = path.join(
  import.meta.dirname,
  'terminal-smoke-password-sshd.mjs',
)
const PLAN_DIRECTORY = '/tmp/terminal-smoke-plan/password-sshd-native'
const PLAN_USERNAME = 'tmsmoke1a2b3c4d'

function nativePlan(overrides = {}) {
  return buildNativePasswordSshdPlan({
    directory: PLAN_DIRECTORY,
    username: PLAN_USERNAME,
    ...overrides,
  })
}

function backendDependencies({ env = {}, platform = 'darwin', results = [] } = {}) {
  const { calls, dependencies } = createDependencies({ results })
  return { calls, dependencies: { ...dependencies, env, platform } }
}

function directives(config) {
  return config
    .split('\n')
    .filter(line => line !== '' && !line.startsWith('#'))
}

test('the native sshd config is password-only and comes from its inputs', () => {
  const config = renderNativeSshdConfig({
    hostKeyPath: '/tmp/fixture/ssh_host_ed25519_key',
    pidFile: '/tmp/fixture/sshd.pid',
    port: 54_321,
    username: PLAN_USERNAME,
  })
  const lines = directives(config)
  assert.ok(lines.includes('Port 54321'))
  assert.ok(lines.includes('ListenAddress 127.0.0.1'))
  assert.ok(lines.includes('HostKey /tmp/fixture/ssh_host_ed25519_key'))
  assert.ok(lines.includes('PidFile /tmp/fixture/sshd.pid'))
  assert.ok(lines.includes('PasswordAuthentication yes'))
  assert.ok(lines.includes('KbdInteractiveAuthentication no'))
  assert.ok(lines.includes('UsePAM yes'))
  assert.ok(lines.includes('PermitRootLogin no'))
  assert.ok(lines.includes('StrictModes no'))
  assert.ok(lines.includes(`AllowUsers ${PLAN_USERNAME}`))
  assert.equal(lines.filter(line => /^PermitRootLogin /.test(line)).length, 1)
  assert.deepEqual(
    lines.filter(line => /^Port /.test(line)),
    ['Port 54321'],
  )
})

test('a different port, host key and account land in the config verbatim', () => {
  const config = renderNativeSshdConfig({
    hostKeyPath: '/tmp/b/key',
    pidFile: '/tmp/b/sshd.pid',
    port: 65_000,
    username: 'tmsmokebbbb',
  })
  assert.match(config, /^Port 65000$/m)
  assert.match(config, /^HostKey \/tmp\/b\/key$/m)
  assert.match(config, /^PidFile \/tmp\/b\/sshd\.pid$/m)
  assert.match(config, /^AllowUsers tmsmokebbbb$/m)
})

test('the native plan lists exactly the commands a run would execute', () => {
  const plan = nativePlan()
  assert.deepEqual(
    plan.steps.map(step => step.command),
    ['/usr/bin/sudo', '/usr/bin/ssh-keygen', '/usr/bin/sudo'],
  )
  assert.deepEqual(plan.steps[0].args.slice(0, 5), [
    '-n',
    '/usr/sbin/sysadminctl',
    '-addUser',
    PLAN_USERNAME,
    '-password',
  ])
  assert.ok(plan.steps[0].args.includes('-shell'))
  assert.ok(plan.steps[0].args.includes('/bin/bash'))
  assert.ok(plan.steps[0].args.includes(path.join(PLAN_DIRECTORY, 'home')))
  assert.deepEqual(plan.steps[1].args.slice(0, 6), [
    '-q',
    '-t',
    'ed25519',
    '-N',
    '',
    '-f',
  ])
  assert.deepEqual(plan.steps[2].args, [
    '-n',
    '/usr/sbin/sshd',
    '-D',
    '-e',
    '-f',
    plan.paths.configPath,
  ])
  assert.deepEqual(plan.cleanupSteps[1].args, [
    '-n',
    '/usr/sbin/sysadminctl',
    '-deleteUser',
    PLAN_USERNAME,
  ])
  assert.equal(
    plan.config,
    renderNativeSshdConfig({
      hostKeyPath: plan.paths.hostKeyPath,
      pidFile: plan.paths.pidFile,
      port: plan.port,
      username: plan.username,
    }),
  )
})

test('the printed plan shows every command and the whole config', () => {
  const text = formatNativePasswordSshdPlan(nativePlan())
  assert.match(text, /Nothing below was executed/)
  assert.match(text, /^Port <reserved-loopback-port>$/m)
  assert.match(text, /^PasswordAuthentication yes$/m)
  assert.match(text, /^AllowUsers tmsmoke1a2b3c4d$/m)
  assert.match(text, /\/usr\/bin\/sudo -n \/usr\/sbin\/sysadminctl -addUser tmsmoke1a2b3c4d/)
  assert.match(text, /\/usr\/bin\/ssh-keygen -q -t ed25519 -N '' -f /)
  assert.match(text, /\/usr\/bin\/sudo -n \/usr\/sbin\/sshd -D -e -f /)
  assert.match(text, /\/usr\/bin\/sudo -n \/usr\/sbin\/sysadminctl -deleteUser tmsmoke1a2b3c4d/)
  assert.match(text, /generated-per-run/)
})

test('an explicit docker request never probes the daemon', async () => {
  const { calls, dependencies } = backendDependencies({
    env: { TERMINAL_SMOKE_PASSWORD_BACKEND: 'docker' },
    platform: 'linux',
  })
  assert.equal(await resolvePasswordSshdBackend({ dependencies }), 'docker')
  assert.equal(calls.length, 0)
})

test('auto keeps docker whenever the daemon answers', async () => {
  const { calls, dependencies } = backendDependencies({
    results: [{ code: 0, stdout: '25.0.0\n' }],
  })
  assert.equal(await resolvePasswordSshdBackend({ dependencies }), 'docker')
  assert.deepEqual(calls[0].args, ['version', '--format', '{{.Server.Version}}'])
})

test('auto falls back to native only on a Docker-less macOS host', async () => {
  const mac = backendDependencies({
    results: [{ code: 1, stderr: 'Cannot connect to the Docker daemon\n' }],
  })
  assert.equal(
    await resolvePasswordSshdBackend({ dependencies: mac.dependencies }),
    'native',
  )
  const linux = backendDependencies({
    platform: 'linux',
    results: [{ code: 1, stderr: 'docker: not found\n' }],
  })
  await assert.rejects(
    () => resolvePasswordSshdBackend({ dependencies: linux.dependencies }),
    /only exists on macOS/,
  )
})

test('an explicit native request is refused off macOS', async () => {
  const linux = backendDependencies({
    env: { TERMINAL_SMOKE_PASSWORD_BACKEND: 'native' },
    platform: 'linux',
  })
  await assert.rejects(
    () => resolvePasswordSshdBackend({ dependencies: linux.dependencies }),
    /only exist on macOS/,
  )
  const mac = backendDependencies({
    env: { TERMINAL_SMOKE_PASSWORD_BACKEND: 'native' },
  })
  assert.equal(
    await resolvePasswordSshdBackend({ dependencies: mac.dependencies }),
    'native',
  )
})

test('an unknown backend name is refused instead of defaulting silently', async () => {
  const { dependencies } = backendDependencies({
    env: { TERMINAL_SMOKE_PASSWORD_BACKEND: 'podman' },
  })
  await assert.rejects(
    () => resolvePasswordSshdBackend({ dependencies }),
    /must be one of auto, docker, native/,
  )
})

test('--print-plan prints the native plan and executes nothing', async () => {
  const planDirectory = path.join(os.tmpdir(), 'terminal-smoke-print-plan')
  const existedBefore = existsSync(planDirectory)
  const { stdout } = await promisify(execFile)(process.execPath, [
    SCRIPT_PATH,
    '--print-plan',
  ])
  assert.match(stdout, /Nothing below was executed/)
  assert.match(stdout, /^PasswordAuthentication yes$/m)
  assert.match(stdout, /\/usr\/bin\/sudo -n \/usr\/sbin\/sshd -D -e -f /)
  if (!existedBefore) assert.equal(existsSync(planDirectory), false)
})

test('the fixture script refuses to run without --print-plan', async () => {
  await assert.rejects(
    () => promisify(execFile)(process.execPath, [SCRIPT_PATH]),
    /print-plan/,
  )
})

test('native backend resolves helpers to paths this host really ships', () => {
  // /usr/bin/chown does not exist on macOS. An absolute path that is wrong
  // only fails once the runner has already spent its build minutes, so the
  // resolution is asserted here for every helper the fixture invokes.
  if (process.platform === 'win32') {
    // The native backend is refused off macOS, so on Windows the lazy helpers
    // must still report the missing tool instead of resolving to a path no
    // Windows host can ship.
    assert.throws(() => NATIVE_CHOWN(), /none of the expected chown paths/)
    assert.throws(() => NATIVE_CHMOD(), /none of the expected chmod paths/)
    return
  }
  for (const toolPath of [NATIVE_CHOWN(), NATIVE_CHMOD()]) {
    assert.ok(existsSync(toolPath), `${toolPath} must exist on this host`)
    assert.doesNotThrow(
      () => accessSync(toolPath, constants.X_OK),
      `${toolPath} must be executable`,
    )
  }
  assert.equal(path.basename(NATIVE_CHOWN()), 'chown')
  assert.equal(path.basename(NATIVE_CHMOD()), 'chmod')
})
