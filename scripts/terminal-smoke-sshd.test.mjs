import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import {
  SSHD_READY_MARKER,
  SSHD_STOP_GRACE_MS,
  startTerminalSmokeSshd,
} from './terminal-smoke-sshd.mjs'

const RUN_DIRECTORY = '/private/tmp/terminal-smoke-fixture'
const SSH_DIRECTORY = path.join(RUN_DIRECTORY, 'sshd')
const PRIVATE_KEY = [
  '-----BEGIN OPENSSH PRIVATE KEY-----',
  'fixture-private-key',
  '-----END OPENSSH PRIVATE KEY-----',
  '',
].join('\n')
const USER_PUBLIC_KEY =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureUser terminal-smoke'
const HOST_PUBLIC_KEY =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureHost terminal-smoke'
const EXPECTED_HOST_KEY = HOST_PUBLIC_KEY.split(' ').slice(0, 2).join(' ')

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  closed = false

  constructor(pid) {
    super()
    this.pid = pid
  }

  kill(signal) {
    finishChild(this, { signal })
    return true
  }
}

function finishChild(
  child,
  { code = 0, signal = null, stdout = '', stderr = '' } = {},
) {
  if (child.closed) return
  queueMicrotask(() => {
    if (child.closed) return
    child.closed = true
    child.stdout.end(stdout)
    child.stderr.end(stderr)
    child.emit('close', code, signal)
  })
}

function createDependencies({
  daemonChildren = [],
  daemonBehaviors = [{}],
  platform = 'darwin',
  ports = [42_222],
  probeResults = [{ code: 0, stdout: `${SSHD_READY_MARKER}\n` }],
} = {}) {
  const calls = {
    chmod: [],
    kill: [],
    listChildProcesses: [],
    mkdir: [],
    reservePort: 0,
    spawn: [],
    writeFile: [],
  }
  const daemons = []
  let daemonIndex = 0
  let now = 0
  let probeIndex = 0

  const dependencies = {
    chmod: async (...args) => calls.chmod.push(args),
    clearTimeout: globalThis.clearTimeout,
    mkdir: async (...args) => calls.mkdir.push(args),
    now: () => {
      now += 1_000
      return now
    },
    platform,
    listChildProcesses: async parentPid => {
      calls.listChildProcesses.push(parentPid)
      const daemonIndex = daemons.findIndex(child => child.pid === parentPid)
      return daemonChildren[daemonIndex] ?? []
    },
    processKill: (pid, signal) => {
      calls.kill.push([pid, signal])
      const daemon = daemons.find(child => child.pid === Math.abs(pid))
      if (!daemon) return
      const behavior = daemonBehaviors[daemons.indexOf(daemon)] ?? {}
      if (signal === 'SIGTERM' && behavior.closeOnTerm !== false) {
        finishChild(daemon, { signal })
      }
      if (signal === 'SIGKILL' && behavior.closeOnKill !== false) {
        finishChild(daemon, { signal })
      }
    },
    readFile: async filePath => {
      if (filePath.endsWith('host_key.pub')) return HOST_PUBLIC_KEY
      if (filePath.endsWith('user_key.pub')) return USER_PUBLIC_KEY
      if (filePath.endsWith('user_key-cert.pub')) {
        return 'ssh-ed25519-cert-v01@openssh.com AAAAcertificate terminal-smoke-cert\n'
      }
      if (filePath.endsWith('user_key')) return PRIVATE_KEY
      throw new Error(`unexpected read: ${filePath}`)
    },
    reservePort: async () => {
      const port = ports[calls.reservePort]
      calls.reservePort += 1
      return port
    },
    setTimeout: globalThis.setTimeout,
    sleep: async () => {},
    spawn: (command, args, options) => {
      const child = new FakeChild(4_000 + calls.spawn.length)
      calls.spawn.push({ args, command, options })

      if (command === '/usr/sbin/sshd' && args[0] === '-D') {
        const behavior = daemonBehaviors[daemonIndex] ?? {}
        daemonIndex += 1
        daemons.push(child)
        if (behavior.exitImmediately) {
          finishChild(child, {
            code: behavior.code ?? 255,
            stderr: behavior.stderr ?? 'daemon failed',
          })
        }
        return child
      }

      if (command === '/usr/bin/ssh') {
        const result = probeResults[probeIndex] ?? probeResults.at(-1)
        probeIndex += 1
        finishChild(child, result)
        return child
      }

      finishChild(child)
      return child
    },
    userInfo: () => ({ username: 'terminal-smoke' }),
    writeFile: async (...args) => calls.writeFile.push(args),
  }

  return { calls, daemons, dependencies }
}

function writtenText(calls, basename) {
  const call = calls.writeFile.find(([filePath]) =>
    filePath.endsWith(path.join('sshd', basename)),
  )
  assert.ok(call, `${basename} must be written`)
  return call[1]
}

test('starts an isolated public-key-only sshd and proves real authentication', async () => {
  const { calls, dependencies } = createDependencies()

  const fixture = await startTerminalSmokeSshd({
    runDirectory: RUN_DIRECTORY,
    dependencies,
  })

  assert.deepEqual(
    {
      configPath: fixture.configPath,
      expectedHostKey: fixture.expectedHostKey,
      host: fixture.host,
      port: fixture.port,
      privateKey: fixture.privateKey,
      username: fixture.username,
    },
    {
      configPath: path.join(SSH_DIRECTORY, 'connection.json'),
      expectedHostKey: EXPECTED_HOST_KEY,
      host: '127.0.0.1',
      port: 42_222,
      privateKey: PRIVATE_KEY,
      username: 'terminal-smoke',
    },
  )
  assert.deepEqual(calls.mkdir, [
    [SSH_DIRECTORY, { recursive: true, mode: 0o700 }],
    [path.join(SSH_DIRECTORY, 'home'), { recursive: true, mode: 0o700 }],
  ])
  assert.ok(
    calls.chmod.some(
      ([filePath, mode]) => filePath === fixture.configPath && mode === 0o600,
    ),
  )

  const wrapper = writtenText(calls, 'forced-command.sh')
  assert.match(wrapper, /SSH_ORIGINAL_COMMAND/)
  assert.match(wrapper, new RegExp(SSHD_READY_MARKER))
  assert.match(wrapper, /\/usr\/bin\/env -i/)
  assert.match(wrapper, /LANG=en_US\.UTF-8 LC_CTYPE=en_US\.UTF-8/)
  assert.match(wrapper, /\/bin\/sh/)

  const authorizedKeys = writtenText(calls, 'authorized_keys')
  assert.match(
    authorizedKeys,
    /^restrict,pty,from="127\.0\.0\.1",command="[^"]+" ssh-ed25519 /,
  )
  const daemonConfig = writtenText(calls, 'sshd_config')
  for (const expected of [
    'ListenAddress 127.0.0.1',
    'Port 42222',
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'AuthenticationMethods publickey',
    'DisableForwarding yes',
    'AllowAgentForwarding no',
    'AllowTcpForwarding no',
    'PermitUserRC no',
    'UsePAM no',
  ]) {
    assert.match(daemonConfig, new RegExp(expected))
  }

  assert.deepEqual(JSON.parse(writtenText(calls, 'connection.json')), {
    host: '127.0.0.1',
    port: 42_222,
    username: 'terminal-smoke',
    authMode: 'key',
    expectedHostKey: EXPECTED_HOST_KEY,
    privateKey: PRIVATE_KEY,
    password: null,
    certificate: null,
    jump: null,
  })
  const validationIndex = calls.spawn.findIndex(
    call => call.command === '/usr/sbin/sshd' && call.args[0] === '-t',
  )
  const daemonIndex = calls.spawn.findIndex(
    call => call.command === '/usr/sbin/sshd' && call.args[0] === '-D',
  )
  assert.ok(validationIndex >= 0 && validationIndex < daemonIndex)
  assert.equal(calls.spawn[daemonIndex].options.detached, true)

  const probe = calls.spawn.find(call => call.command === '/usr/bin/ssh')
  assert.ok(probe)
  assert.ok(probe.args.includes('BatchMode=yes'))
  assert.ok(probe.args.includes('IdentityAgent=none'))
  assert.ok(probe.args.includes('StrictHostKeyChecking=yes'))
  assert.ok(probe.args.includes(path.join(SSH_DIRECTORY, 'user_key')))
  assert.equal(probe.args.at(-1), 'terminal-smoke-ready')
  for (const call of calls.spawn) {
    assert.doesNotMatch(
      JSON.stringify(call.options.env ?? {}),
      /fixture-private-key/,
    )
  }

  await fixture.stop()
  assert.deepEqual(calls.kill, [[-4_003, 'SIGTERM']])
})

test('restarts the daemon on the same authenticated port', async () => {
  const { calls, daemons, dependencies } = createDependencies()
  const fixture = await startTerminalSmokeSshd({
    runDirectory: RUN_DIRECTORY,
    dependencies,
  })

  await fixture.restart()

  assert.equal(fixture.port, 42_222)
  assert.equal(
    calls.spawn.filter(
      call => call.command === '/usr/sbin/sshd' && call.args[0] === '-D',
    ).length,
    2,
  )
  assert.equal(daemons.length, 2)
  assert.deepEqual(calls.kill, [[-4_003, 'SIGTERM']])

  await fixture.stop()

  assert.deepEqual(calls.kill, [
    [-4_003, 'SIGTERM'],
    [-4_005, 'SIGTERM'],
  ])
})

test('restart terminates active SSH session process groups before replacing the daemon', async () => {
  const { calls, dependencies } = createDependencies({
    daemonChildren: [
      [{ pid: 7_001, processGroupId: 7_001 }],
      [],
    ],
  })
  const fixture = await startTerminalSmokeSshd({
    runDirectory: RUN_DIRECTORY,
    dependencies,
  })

  await fixture.restart()

  assert.deepEqual(calls.listChildProcesses, [4_003])
  assert.deepEqual(calls.kill, [
    [-7_001, 'SIGTERM'],
    [-4_003, 'SIGTERM'],
  ])

  await fixture.stop()
})

for (const [name, child] of [
  ['invalid process metadata', { pid: 0, processGroupId: 0 }],
  ['a non-isolated process group', { pid: 7_001, processGroupId: 7_002 }],
]) {
  test(`restart fails closed for ${name}`, async () => {
    const { calls, daemons, dependencies } = createDependencies({
      daemonChildren: [[child]],
    })
    const fixture = await startTerminalSmokeSshd({
      runDirectory: RUN_DIRECTORY,
      dependencies,
    })

    await assert.rejects(fixture.restart(), /OpenSSH child process/)

    assert.deepEqual(calls.listChildProcesses, [4_003])
    assert.deepEqual(calls.kill, [])
    finishChild(daemons[0], { signal: 'SIGTERM' })
  })
}

test('rejects unsupported hosts without touching the run directory', async () => {
  const { calls, dependencies } = createDependencies({ platform: 'win32' })

  await assert.rejects(
    startTerminalSmokeSshd({ runDirectory: RUN_DIRECTORY, dependencies }),
    /only supported on macOS and Linux/,
  )

  assert.equal(calls.mkdir.length, 0)
  assert.equal(calls.spawn.length, 0)
})

test('retries a random loopback port after an sshd bind conflict', async () => {
  const { calls, dependencies } = createDependencies({
    daemonBehaviors: [
      { exitImmediately: true, stderr: 'Bind to port: Address already in use' },
      {},
    ],
    ports: [43_001, 43_002],
  })

  const fixture = await startTerminalSmokeSshd({
    runDirectory: RUN_DIRECTORY,
    dependencies,
  })

  assert.equal(fixture.port, 43_002)
  assert.equal(calls.reservePort, 2)
  assert.equal(
    calls.spawn.filter(
      call => call.command === '/usr/sbin/sshd' && call.args[0] === '-D',
    ).length,
    2,
  )
  await fixture.stop()
})

test('cleans the daemon process group when readiness cannot be proven', async () => {
  const { calls, daemons, dependencies } = createDependencies({
    probeResults: [{ code: 255, stderr: 'Connection refused' }],
  })

  await assert.rejects(
    startTerminalSmokeSshd({ runDirectory: RUN_DIRECTORY, dependencies }),
    /readiness probe failed/,
  )

  assert.equal(daemons[0].closed, true)
  assert.deepEqual(calls.kill, [[-4_003, 'SIGTERM']])
  assert.equal(
    calls.writeFile.some(([filePath]) => filePath.endsWith('connection.json')),
    false,
  )
})

test('cleans the authenticated daemon when publishing the config fails', async () => {
  const { calls, daemons, dependencies } = createDependencies()
  const originalWriteFile = dependencies.writeFile
  dependencies.writeFile = async (...args) => {
    await originalWriteFile(...args)
    if (args[0].endsWith('connection.json')) {
      throw new Error('disk full')
    }
  }

  await assert.rejects(
    startTerminalSmokeSshd({ runDirectory: RUN_DIRECTORY, dependencies }),
    /disk full/,
  )

  assert.equal(daemons[0].closed, true)
  assert.deepEqual(calls.kill, [[-4_003, 'SIGTERM']])
})

test('stop escalates a stuck process group to SIGKILL and waits for close', async () => {
  const { calls, daemons, dependencies } = createDependencies({
    daemonBehaviors: [{ closeOnTerm: false }],
  })
  dependencies.setTimeout = (callback, delay, ...args) => {
    if (delay === SSHD_STOP_GRACE_MS) {
      const handle = { fake: true }
      queueMicrotask(() => callback(...args))
      return handle
    }
    return globalThis.setTimeout(callback, delay, ...args)
  }
  dependencies.clearTimeout = handle => {
    if (!handle?.fake) globalThis.clearTimeout(handle)
  }
  const fixture = await startTerminalSmokeSshd({
    runDirectory: RUN_DIRECTORY,
    dependencies,
  })

  await fixture.stop()

  assert.equal(daemons[0].closed, true)
  assert.deepEqual(calls.kill, [
    [-4_003, 'SIGTERM'],
    [-4_003, 'SIGKILL'],
  ])
})

test('stop escalates a stuck SSH session process group to SIGKILL', async () => {
  const { calls, daemons, dependencies } = createDependencies({
    daemonBehaviors: [{ closeOnTerm: false }],
    daemonChildren: [[{ pid: 7_001, processGroupId: 7_001 }]],
  })
  dependencies.setTimeout = (callback, delay, ...args) => {
    if (delay === SSHD_STOP_GRACE_MS) {
      const handle = { fake: true }
      queueMicrotask(() => callback(...args))
      return handle
    }
    return globalThis.setTimeout(callback, delay, ...args)
  }
  dependencies.clearTimeout = handle => {
    if (!handle?.fake) globalThis.clearTimeout(handle)
  }
  const fixture = await startTerminalSmokeSshd({
    runDirectory: RUN_DIRECTORY,
    dependencies,
  })

  await fixture.stop()

  assert.equal(daemons[0].closed, true)
  assert.deepEqual(calls.kill, [
    [-7_001, 'SIGTERM'],
    [-4_003, 'SIGTERM'],
    [-7_001, 'SIGKILL'],
    [-4_003, 'SIGKILL'],
  ])
})

test('starts a certificate-trusted sshd and proves certificate authentication', async () => {
  const { calls, dependencies } = createDependencies()

  const fixture = await startTerminalSmokeSshd({
    runDirectory: RUN_DIRECTORY,
    mode: 'cert',
    dependencies,
  })

  assert.equal(fixture.authMode, 'cert')
  assert.match(fixture.certificate, /^ssh-ed25519-cert-v01@openssh\.com /)
  assert.equal(fixture.privateKey, PRIVATE_KEY)

  const daemonConfig = writtenText(calls, 'sshd_config')
  assert.match(daemonConfig, /TrustedUserCAKeys .*ca_key\.pub/)
  assert.match(daemonConfig, /DisableForwarding yes/)

  const signing = calls.spawn.find(
    call => call.command === '/usr/bin/ssh-keygen' && call.args.includes('-s'),
  )
  assert.ok(signing, 'certificate signing must run')
  assert.ok(signing.args.includes(SSH_DIRECTORY + '/ca_key'))
  assert.deepEqual(
    signing.args.slice(0, 4),
    ['-q', '-s', SSH_DIRECTORY + '/ca_key', '-I'],
  )
  assert.ok(signing.args.includes('-O'))
  assert.ok(signing.args.includes('clear'))
  assert.ok(signing.args.includes('permit-pty'))
  assert.ok(signing.args.some(arg => arg.startsWith('force-command=')))
  assert.ok(signing.args.includes('source-address=127.0.0.1'))

  const probe = calls.spawn.find(call => call.command === '/usr/bin/ssh')
  assert.ok(probe.args.includes(`CertificateFile=${SSH_DIRECTORY}/user_key-cert.pub`))

  assert.deepEqual(JSON.parse(writtenText(calls, 'connection.json')), {
    host: '127.0.0.1',
    port: 42_222,
    username: 'terminal-smoke',
    authMode: 'cert',
    expectedHostKey: EXPECTED_HOST_KEY,
    privateKey: PRIVATE_KEY,
    password: null,
    certificate: 'ssh-ed25519-cert-v01@openssh.com AAAAcertificate',
    jump: null,
  })
  await fixture.stop()
})

test('starts a jump-role sshd restricted to the target port', async () => {
  const { calls, dependencies } = createDependencies()

  const fixture = await startTerminalSmokeSshd({
    runDirectory: RUN_DIRECTORY,
    role: 'jump',
    targetPort: 42_333,
    dependencies,
  })

  const daemonConfig = writtenText(calls, 'sshd_config')
  assert.match(daemonConfig, /AllowTcpForwarding yes/)
  assert.match(daemonConfig, /PermitOpen 127\.0\.0\.1:42333/)
  assert.match(daemonConfig, /PermitTTY no/)
  assert.doesNotMatch(daemonConfig, /DisableForwarding yes/)
  assert.doesNotMatch(daemonConfig, /PermitTTY yes/)

  const authorizedKeys = writtenText(calls, 'authorized_keys')
  assert.doesNotMatch(authorizedKeys, /restrict/)
  assert.match(authorizedKeys, /no-pty/)
  assert.match(authorizedKeys, /no-agent-forwarding/)

  const probe = calls.spawn.find(call => call.command === '/usr/bin/ssh')
  assert.ok(probe.args.includes('terminal-smoke-ready'))
  await fixture.stop()
})

test('rejects a jump role without a numeric target port', async () => {
  const { calls, dependencies } = createDependencies()

  await assert.rejects(
    startTerminalSmokeSshd({
      runDirectory: RUN_DIRECTORY,
      role: 'jump',
      dependencies,
    }),
    /target port/,
  )
  assert.equal(calls.mkdir.length, 0)
})
