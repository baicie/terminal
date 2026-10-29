import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import {
  ensurePasswordSshdImage,
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
