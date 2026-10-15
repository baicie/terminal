import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  parseShellProbeResult,
  runShellProbe,
} from './run-terminal-shell-probe.mjs'

const RESULT = {
  caseName: 'cat-eof',
  durationMs: 42,
  error: null,
  inputEvents: [
    { kind: 'text', bytes: 14, dataHex: '6361742d656f662d70726f62650d' },
    { kind: 'text', bytes: 1, dataHex: '04' },
  ],
  ok: true,
  trace: ['ready', 'pass'],
}

test('parses the strict shell probe result contract', () => {
  assert.deepEqual(parseShellProbeResult(JSON.stringify(RESULT), 'cat-eof'), RESULT)
  assert.throws(
    () =>
      parseShellProbeResult(
        JSON.stringify({ ...RESULT, trace: ['ready', 'step', 'pass'] }),
        'cat-eof',
      ),
    /Invalid shell probe result/,
  )
})

test('interrupt case is rejected without the raw ETX byte', () => {
  const result = {
    ...RESULT,
    caseName: 'ctrl-c-interrupt',
    trace: ['ready', 'step', 'pass'],
    inputEvents: [
      ...RESULT.inputEvents,
      { kind: 'text', bytes: 1, dataHex: '1b' },
    ],
  }
  assert.throws(
    () => parseShellProbeResult(JSON.stringify(result), 'ctrl-c-interrupt'),
    /Invalid shell probe result/,
  )
  assert.deepEqual(
    parseShellProbeResult(
      JSON.stringify({
        ...result,
        inputEvents: [...result.inputEvents, { kind: 'text', bytes: 1, dataHex: '03' }],
      }),
      'ctrl-c-interrupt',
    ).caseName,
    'ctrl-c-interrupt',
  )
})

test('shell probe rejects unsupported platforms before spawning a binary', async () => {
  await assert.rejects(
    runShellProbe({
      skipBuild: true,
      dependencies: { platform: 'aix' },
    }),
    /only supported on macOS, Linux and Windows/,
  )
})

test('a Windows run without a Windows shell is rejected up front', async () => {
  await assert.rejects(
    runShellProbe({
      skipBuild: true,
      dependencies: { platform: 'win32' },
    }),
    /on Windows requires --shells powershell\/cmd/,
  )
  await assert.rejects(
    runShellProbe({
      skipBuild: true,
      shell: 'bash',
      dependencies: { platform: 'win32' },
    }),
    /on Windows requires --shells powershell\/cmd/,
  )
})

test('a Windows shell is rejected on a Unix host', async () => {
  await assert.rejects(
    runShellProbe({
      skipBuild: true,
      shell: 'powershell',
      dependencies: { platform: 'darwin' },
    }),
    /only supported on Windows/,
  )
})

test('a Windows shell rejects a case outside its dialect before spawning', async () => {
  await assert.rejects(
    runShellProbe({
      skipBuild: true,
      shell: 'powershell',
      caseName: 'vim-edit',
      dependencies: { platform: 'win32' },
    }),
    /shell probe shell 'powershell' does not support case 'vim-edit'/,
  )
})

test('each Windows shell is launched by the executable the backend expects', async () => {
  for (const [shell, executable, dialect] of [
    ['powershell', 'powershell.exe', 'powershell'],
    ['cmd', 'cmd.exe', 'cmd'],
  ]) {
    const child = new EventEmitter()
    child.kill = signal => queueMicrotask(() => child.emit('close', 0, signal))
    const calls = []
    const result = await runShellProbe({
      skipBuild: true,
      shell,
      caseName: 'cat-eof',
      targetDirectory: '/tmp/target',
      dependencies: {
        access: async () => {},
        clearTimeout,
        mkdtemp: async () => '/tmp/shell-probe-test',
        now: Date.now,
        platform: 'win32',
        readFile: async () => JSON.stringify(RESULT),
        rm: async () => {},
        setTimeout,
        spawn: (...args) => {
          calls.push(args)
          return child
        },
        tempDirectory: '/tmp',
      },
    })
    assert.equal(result.caseName, RESULT.caseName)
    const env = calls[0][2].env
    assert.equal(env.TERMINAL_DEFAULT_SHELL, executable)
    assert.equal(env.TERMINAL_SHELL_PROBE_DIALECT, dialect)
    assert.equal(calls[0][0], '/tmp/target/debug/terminal.exe')
  }
})

test('runner passes a dedicated case and result path to the gated binary', async () => {
  const child = new EventEmitter()
  child.kill = signal => queueMicrotask(() => child.emit('close', 0, signal))
  const calls = []
  const dependencies = {
    access: async () => {},
    clearTimeout,
    mkdtemp: async () => '/tmp/shell-probe-test',
    now: Date.now,
    platform: 'darwin',
    readFile: async () => JSON.stringify(RESULT),
    rm: async (...args) => calls.push(['rm', ...args]),
    setTimeout,
    spawn: (command, args, options) => {
      calls.push(['spawn', command, args, options])
      return child
    },
    tempDirectory: '/tmp',
  }
  const result = await runShellProbe({
    cwd: '/workspace/terminal',
    env: { KEEP_ME: 'yes', PROMPT_COMMAND: 'must-clear' },
    skipBuild: true,
    targetDirectory: '/workspace/target',
    dependencies,
  })
  assert.deepEqual(result, RESULT)
  const spawnCall = calls.find(call => call[0] === 'spawn')
  assert.equal(spawnCall?.[1], '/workspace/target/debug/terminal')
  assert.equal(spawnCall?.[3].env.KEEP_ME, 'yes')
  assert.equal(spawnCall?.[3].env.PROMPT_COMMAND, undefined)
  assert.equal(spawnCall?.[3].env.TERMINAL_SHELL_PROBE, '1')
  assert.equal(spawnCall?.[3].env.TERMINAL_SHELL_PROBE_CASE, 'cat-eof')
  assert.equal(
    spawnCall?.[3].env.TERMINAL_SHELL_PROBE_RESULT_PATH,
    '/tmp/shell-probe-test/result.json',
  )
  assert.deepEqual(calls.at(-1), [
    'rm',
    '/tmp/shell-probe-test',
    { recursive: true, force: true },
  ])
})

test('Linux shell probes select the requested shell through the isolated environment', async () => {
  const child = new EventEmitter()
  child.kill = signal => queueMicrotask(() => child.emit('close', 0, signal))
  const calls = []
  const dependencies = {
    access: async () => {},
    clearTimeout,
    mkdtemp: async () => '/tmp/shell-probe-linux-test',
    now: Date.now,
    platform: 'linux',
    readFile: async () => JSON.stringify(RESULT),
    rm: async (...args) => calls.push(['rm', ...args]),
    setTimeout,
    spawn: (command, args, options) => {
      calls.push(['spawn', command, args, options])
      return child
    },
    tempDirectory: '/tmp',
  }
  await runShellProbe({
    cwd: '/workspace/terminal',
    skipBuild: true,
    shell: 'zsh',
    targetDirectory: '/workspace/target',
    dependencies,
  })
  const spawnCall = calls.find(call => call[0] === 'spawn')
  assert.equal(spawnCall?.[3].env.TERMINAL_DEFAULT_SHELL, 'zsh')
})

test('the ssh transport starts the real sshd fixture and hands the app its config', async () => {
  const child = new EventEmitter()
  child.kill = signal => queueMicrotask(() => child.emit('close', 0, signal))
  const calls = []
  let written = ''
  const dependencies = {
    access: async () => {},
    clearTimeout,
    mkdtemp: async () => '/tmp/shell-probe-ssh-test',
    now: Date.now,
    platform: 'darwin',
    readFile: async () => JSON.stringify(RESULT),
    rm: async (...args) => calls.push(['rm', ...args]),
    setTimeout,
    spawn: (command, args, options) => {
      calls.push(['spawn', command, args, options])
      return child
    },
    startSshd: async () => ({
      host: '127.0.0.1',
      port: 22222,
      username: 'probe',
      authMode: 'key',
      expectedHostKey: 'ssh-ed25519 AAAA probe',
      privateKey: 'PRIVATE',
      password: null,
      certificate: null,
      jump: null,
      stop: async () => calls.push(['stop']),
    }),
    tempDirectory: '/tmp',
    writeFile: async (path_, contents) => {
      written = contents
    },
  }
  await runShellProbe({
    cwd: '/workspace/terminal',
    skipBuild: true,
    transport: 'ssh',
    targetDirectory: '/workspace/target',
    dependencies,
  })
  // The app must receive the fixture's real connection details; a probe that
  // silently fell back to a local PTY would report a pass for the wrong
  // transport entirely.
  assert.equal(
    calls.find(call => call[0] === 'spawn')?.[3].env
      .TERMINAL_SHELL_PROBE_SSH_CONFIG_PATH,
    '/tmp/shell-probe-ssh-test/ssh-config.json',
  )
  assert.equal(JSON.parse(written).port, 22222)
  assert.equal(JSON.parse(written).authMode, 'key')
  // A shell request must not leak onto the SSH transport, where the login
  // shell belongs to the fixture rather than to this process.
  assert.equal(
    calls.find(call => call[0] === 'spawn')?.[3].env.TERMINAL_DEFAULT_SHELL,
    undefined,
  )
  assert.ok(calls.some(call => call[0] === 'stop'))
  assert.deepEqual(calls.at(-1), [
    'rm',
    '/tmp/shell-probe-ssh-test',
    { recursive: true, force: true },
  ])
})

test('rejects an unsupported transport before spawning anything', async () => {
  await assert.rejects(
    runShellProbe({
      cwd: '/workspace/terminal',
      skipBuild: true,
      transport: 'serial',
      targetDirectory: '/workspace/target',
      dependencies: { platform: 'darwin' },
    }),
    /Unsupported terminal shell probe transport/,
  )
})

test('runner cleans the temporary directory when the app emits an error', async () => {
  const child = new EventEmitter()
  child.kill = () => {}
  const calls = []
  const appError = new Error('fixture process failed')
  const dependencies = {
    access: async () => {
      throw new Error('result pending')
    },
    clearTimeout: () => {},
    mkdtemp: async () => '/tmp/shell-probe-error',
    now: Date.now,
    platform: 'darwin',
    readFile: async () => JSON.stringify(RESULT),
    rm: async (...args) => calls.push(args),
    setTimeout: () => 1,
    spawn: () => {
      queueMicrotask(() => child.emit('error', appError))
      return child
    },
    tempDirectory: '/tmp',
  }

  await assert.rejects(
    runShellProbe({
      cwd: '/workspace/terminal',
      skipBuild: true,
      targetDirectory: '/workspace/target',
      dependencies,
    }),
    /fixture process failed/,
  )
  assert.deepEqual(calls, [
    ['/tmp/shell-probe-error', { recursive: true, force: true }],
  ])
})
