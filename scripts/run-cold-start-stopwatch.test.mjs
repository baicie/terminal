import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import {
  ACCESSIBILITY_PROBE,
  STAGES_FILE_NAME,
  describeStages,
  evaluateReadiness,
  evaluateStageBudgets,
  parseColdStartArguments,
  parseAccessibilityReadiness,
  readStages,
  runColdStartStopwatch,
} from './run-cold-start-stopwatch.mjs'

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid = 41_700
  closed = false

  kill(signal) {
    if (this.closed) return false
    this.closed = true
    this.stdout.end()
    this.stderr.end()
    queueMicrotask(() => this.emit('close', null, signal))
    return true
  }
}

function createHarness({
  readiness = ['0,0,0,0', '1,1,1,1'],
  emitSpawn = true,
  closeCode = null,
  closeOnKill = true,
  compileCode = 0,
  axProbeCode = 0,
} = {}) {
  const child = new FakeChild()
  const calls = {
    access: [],
    kill: [],
    osascript: [],
    readFile: [],
    swiftc: [],
    native: [],
    spawn: [],
    applicationSpawned: false,
  }
  let index = 0
  const dependencies = {
    access: async path => {
      calls.access.push(path)
    },
    clearTimeout: globalThis.clearTimeout,
    mkdtemp: async prefix => `${prefix}fixture`,
    now: Date.now,
    platform: 'darwin',
    readFile: async (filePath, encoding) => {
      calls.readFile.push({ filePath, encoding })
      return Buffer.from('binary')
    },
    rm: async () => {},
    setTimeout: globalThis.setTimeout,
    spawn: (command, args, options) => {
      calls.spawn.push({ command, args, options })
      if (command === 'swiftc') {
        calls.swiftc.push({ command, args, options })
        const compiler = new FakeChild()
        queueMicrotask(() => {
          compiler.stdout.end()
          compiler.stderr.end()
          compiler.emit('close', compileCode, null)
        })
        return compiler
      }
      if (
        command === 'osascript' ||
        command.includes('terminal-macos-ax-probe')
      ) {
        if (command.includes('terminal-macos-ax-probe')) {
          calls.native.push({ command, args, options })
        }
        const probe = new FakeChild()
        const output = readiness[Math.min(index++, readiness.length - 1)]
        queueMicrotask(() => {
          probe.stdout.end(`${output}\n`)
          probe.stderr.end()
          probe.emit('close', axProbeCode, null)
        })
        return probe
      }
      calls.applicationSpawned = true
      if (emitSpawn) queueMicrotask(() => child.emit('spawn'))
      if (closeCode !== null) {
        queueMicrotask(() => {
          if (child.closed) return
          child.closed = true
          child.stdout.end()
          child.stderr.end()
          child.emit('close', closeCode, null)
        })
      }
      return child
    },
    tempDirectory: '/private/tmp',
  }
  child.kill = signal => {
    calls.kill.push(signal)
    if (!closeOnKill) {
      child.closed = true
      return true
    }
    return FakeChild.prototype.kill.call(child, signal)
  }
  return { calls, child, dependencies }
}

function createHangingProbeHarness() {
  const harness = createHarness()
  const originalSpawn = harness.dependencies.spawn
  harness.dependencies.spawn = (command, args, options) => {
    if (command === 'swiftc' || command.includes('terminal-macos-ax-probe')) {
      const child = new FakeChild()
      child.kill = signal => {
        harness.calls.kill.push(signal)
        return true
      }
      return child
    }
    return originalSpawn(command, args, options)
  }
  harness.dependencies.probeCleanupGraceMs = 1
  harness.dependencies.nativeAxProbeCompileTimeoutMs = 1
  harness.dependencies.axProbeTimeoutMs = 1
  return harness
}

test('requires the AX-visible terminal readiness conditions', () => {
  assert.deepEqual(parseAccessibilityReadiness('1,1,1,1\n'), {
    localTab: true,
    connected: true,
    terminalInput: true,
    shellPrompt: true,
  })
  assert.throws(
    () => parseAccessibilityReadiness('1,1,1'),
    /four readiness flags/,
  )
  assert.deepEqual(parseAccessibilityReadiness('0,1,1,1'), {
    localTab: false,
    connected: true,
    terminalInput: true,
    shellPrompt: true,
  })
  assert.throws(() => parseAccessibilityReadiness('1,1,1,2'), /0 or 1/)
})

test('distinguishes rendered window readiness from terminal evidence', () => {
  const readiness = parseAccessibilityReadiness('1,1,1,0')
  assert.deepEqual(
    evaluateReadiness({
      readiness,
      markerReady: true,
      hasTerminalEvidence: false,
    }),
    { windowReady: true, terminalReady: false },
  )
  assert.deepEqual(
    evaluateReadiness({
      readiness,
      markerReady: true,
      hasTerminalEvidence: true,
    }),
    { windowReady: true, terminalReady: true },
  )
  assert.deepEqual(
    evaluateReadiness({
      readiness: null,
      markerReady: true,
      hasTerminalEvidence: true,
    }),
    { windowReady: false, terminalReady: true },
  )
})

test('parses repeatable marker checks for strict readiness CLI runs', () => {
  assert.deepEqual(
    parseColdStartArguments([
      '--app-path',
      '/Applications/Termius.app/Contents/MacOS/terminal',
      '--readiness-target',
      'terminal',
      '--marker-check',
      '/tmp/shell-ready',
      'first-marker',
      '--marker-check',
      '/tmp/prompt-ready',
      'prompt marker with spaces',
    ]),
    {
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      readinessTarget: 'terminal',
      markerChecks: [
        { path: '/tmp/shell-ready', content: 'first-marker' },
        { path: '/tmp/prompt-ready', content: 'prompt marker with spaces' },
      ],
    },
  )
  assert.throws(
    () => parseColdStartArguments(['--marker-check', '/tmp/shell-ready']),
    /requires a path and expected content/,
  )
})

test('scans every application window for AX readiness', () => {
  const script = ACCESSIBILITY_PROBE(41_700)
  assert.match(script, /repeat with currentWindow in windows/)
  assert.match(script, /entire contents of currentWindow/)
  assert.doesNotMatch(script, /entire contents of window 1/)
})

test('supports the explicit System Events fallback', async () => {
  const harness = createHarness()
  const result = await runColdStartStopwatch({
    appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
    timeoutMs: 1_000,
    axProbe: 'osascript',
    dependencies: harness.dependencies,
  })
  assert.equal(result.ok, true)
  assert.equal(result.axProbe, 'osascript')
  assert.equal(
    harness.calls.spawn[0].command,
    '/Applications/Termius.app/Contents/MacOS/terminal',
  )
  assert.equal(harness.calls.spawn[1].command, 'osascript')
  assert.equal(harness.calls.swiftc.length, 0)
})

test('fails closed when the native AX helper cannot compile', async () => {
  const harness = createHarness({ compileCode: 17 })
  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      timeoutMs: 1_000,
      dependencies: harness.dependencies,
    }),
    /native AX probe compiler exited with code 17/,
  )
  assert.equal(harness.calls.spawn[0].command, 'swiftc')
  assert.equal(
    harness.calls.spawn.some(({ command }) =>
      command.includes('/Contents/MacOS/terminal'),
    ),
    false,
  )
})

test('escalates a hanging native AX compiler after SIGTERM', async () => {
  const harness = createHangingProbeHarness()
  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      dependencies: harness.dependencies,
    }),
    /native AX probe compiler timed out after 1 ms/,
  )
  assert.deepEqual(harness.calls.kill, ['SIGTERM', 'SIGKILL'])
})

test('reaps a timed-out AX helper before retrying the window probe', async () => {
  const harness = createHarness()
  const originalSpawn = harness.dependencies.spawn
  const probeKills = []
  let hangOnce = true
  harness.dependencies.spawn = (command, args, options) => {
    if (command.includes('terminal-macos-ax-probe') && hangOnce) {
      hangOnce = false
      const probe = new FakeChild()
      probe.kill = signal => {
        probeKills.push(signal)
        if (signal === 'SIGKILL') {
          return FakeChild.prototype.kill.call(probe, signal)
        }
        return true
      }
      return probe
    }
    return originalSpawn(command, args, options)
  }
  harness.dependencies.axProbeTimeoutMs = 1
  harness.dependencies.probeCleanupGraceMs = 1

  const result = await runColdStartStopwatch({
    appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
    timeoutMs: 1_000,
    dependencies: harness.dependencies,
  })

  assert.equal(result.windowReady, true)
  assert.deepEqual(probeKills, ['SIGTERM', 'SIGKILL'])
})

test('rejects unknown AX probe modes', async () => {
  const harness = createHarness()
  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      axProbe: 'invalid',
      dependencies: harness.dependencies,
    }),
    /AX probe must be native or osascript/,
  )
})

test('rejects unsupported platforms before touching an app path', async () => {
  const harness = createHarness()
  harness.dependencies.platform = 'win32'
  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      dependencies: harness.dependencies,
    }),
    /macOS and Linux only/,
  )
  assert.equal(harness.calls.spawn.length, 0)
})

test('supports Linux marker-only remote readiness without AX probing', async () => {
  const harness = createHarness()
  harness.dependencies.platform = 'linux'
  const markerPath = '/tmp/linux-remote-marker'
  const readFile = harness.dependencies.readFile
  harness.dependencies.readFile = async (filePath, encoding) => {
    if (filePath === markerPath && harness.calls.applicationSpawned)
      return 'READY'
    return readFile(filePath, encoding)
  }
  const result = await runColdStartStopwatch({
    appPath: '/workspace/terminal/target/debug/terminal',
    timeoutMs: 1_000,
    readinessMode: 'remote',
    markerPath,
    markerContent: 'READY',
    dependencies: harness.dependencies,
  })
  assert.equal(result.ok, true)
  assert.equal(result.axProbe, 'none')
  assert.equal(result.readiness, null)
  assert.equal(harness.calls.swiftc.length, 0)
  assert.equal(harness.calls.native.length, 0)
})

test('reports AX readiness as window-ready, not terminal-ready', async () => {
  const harness = createHarness({ readiness: ['1,1,1,0'] })
  const result = await runColdStartStopwatch({
    appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
    timeoutMs: 1_000,
    dependencies: harness.dependencies,
  })
  assert.equal(result.ok, true)
  assert.equal(result.axProbe, 'native')
  assert.equal(result.readinessTarget, 'window')
  assert.equal(result.readyAt, 'window')
  assert.equal(result.windowReady, true)
  assert.equal(result.terminalReady, false)
  assert.equal(result.pid, 41_700)
  assert.equal(
    result.binarySha256,
    '9a3a45d01531a20e89ac6ae10b0b0beb0492acd7216a368aa062d1a5fecaf9cd',
  )
  assert.match(result.capturedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(result.readiness.localTab, true)
  assert.equal(result.readiness.connected, true)
  assert.equal(result.readiness.terminalInput, true)
  assert.equal(result.readiness.shellPrompt, false)
  assert.equal(harness.calls.spawn[0].command, 'swiftc')
  assert.equal(
    harness.calls.spawn[1].command,
    '/Applications/Termius.app/Contents/MacOS/terminal',
  )
  assert.equal(
    harness.calls.spawn[2].command.includes('terminal-macos-ax-probe'),
    true,
  )
  assert.deepEqual(harness.calls.kill, ['SIGTERM'])
})

test('requires explicit terminal evidence for strict local readiness', async () => {
  const harness = createHarness()
  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      readinessTarget: 'terminal',
      dependencies: harness.dependencies,
    }),
    /local terminal readiness requires marker or marker-check evidence/,
  )
  assert.equal(harness.calls.spawn.length, 0)
})

test('strict local terminal readiness accepts an end-to-end marker without AX prompt text', async () => {
  const harness = createHarness({ readiness: ['1,1,1,0'] })
  const markerPath = '/private/tmp/local-terminal-ready'
  const readFile = harness.dependencies.readFile
  harness.dependencies.readFile = async (filePath, encoding) => {
    if (filePath === markerPath && harness.calls.applicationSpawned) {
      return 'LOCAL_TERMINAL_READY'
    }
    return readFile(filePath, encoding)
  }
  const result = await runColdStartStopwatch({
    appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
    timeoutMs: 1_000,
    readinessTarget: 'terminal',
    markerPath,
    markerContent: 'LOCAL_TERMINAL_READY',
    dependencies: harness.dependencies,
  })
  assert.equal(result.readyAt, 'terminal')
  assert.equal(result.windowReady, false)
  assert.equal(result.terminalReady, true)
  assert.equal(result.readiness, null)
})

test('strict local marker readiness skips AX so helper availability cannot affect timing', async () => {
  const harness = createHarness({ readiness: ['1,1,1,0'], axProbeCode: 77 })
  const markerPath = '/private/tmp/local-terminal-ready'
  const readFile = harness.dependencies.readFile
  harness.dependencies.readFile = async (filePath, encoding) => {
    if (filePath === markerPath && harness.calls.applicationSpawned) {
      return 'LOCAL_TERMINAL_READY'
    }
    return readFile(filePath, encoding)
  }
  const result = await runColdStartStopwatch({
    appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
    timeoutMs: 1_000,
    readinessTarget: 'terminal',
    markerPath,
    markerContent: 'LOCAL_TERMINAL_READY',
    dependencies: harness.dependencies,
  })
  assert.equal(result.readyAt, 'terminal')
  assert.equal(result.markerReady, true)
  assert.equal(result.axProbe, 'none')
  assert.equal(harness.calls.swiftc.length, 0)
  assert.equal(harness.calls.native.length, 0)
})

test('rejects readiness that only completes after the timeout deadline', async () => {
  const harness = createHarness({ readiness: ['1,1,1,1'] })
  const markerPath = '/private/tmp/local-terminal-ready'
  let clock = 0
  const readFile = harness.dependencies.readFile
  harness.dependencies.now = () => clock
  harness.dependencies.setTimeout = () => 1
  harness.dependencies.clearTimeout = () => {}
  harness.dependencies.readFile = async (filePath, encoding) => {
    if (filePath !== markerPath || !harness.calls.applicationSpawned) {
      return readFile(filePath, encoding)
    }
    await Promise.resolve()
    clock = 41
    return 'LOCAL_TERMINAL_READY'
  }

  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      timeoutMs: 10,
      readinessTarget: 'terminal',
      markerPath,
      markerContent: 'LOCAL_TERMINAL_READY',
      dependencies: harness.dependencies,
    }),
    /terminal readiness did not complete within 10 ms/,
  )
  assert.deepEqual(harness.calls.kill, ['SIGTERM'])
})

test('removes explicitly isolated environment keys after merging process env', async () => {
  const harness = createHarness()
  const markerPath = '/private/tmp/local-terminal-ready'
  const readFile = harness.dependencies.readFile
  harness.dependencies.readFile = async (filePath, encoding) => {
    if (filePath === markerPath && harness.calls.applicationSpawned) {
      return 'LOCAL_TERMINAL_READY'
    }
    return readFile(filePath, encoding)
  }
  await runColdStartStopwatch({
    appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
    timeoutMs: 1_000,
    readinessTarget: 'terminal',
    axProbe: 'none',
    markerPath,
    markerContent: 'LOCAL_TERMINAL_READY',
    environment: { BASH_ENV: '/tmp/forged-marker.sh' },
    unsetEnvironmentKeys: ['BASH_ENV'],
    dependencies: harness.dependencies,
  })
  const application = harness.calls.spawn.find(
    call =>
      call.command === '/Applications/Termius.app/Contents/MacOS/terminal',
  )
  assert.equal('BASH_ENV' in application.options.env, false)
})

test('strict local readiness rejects a marker from another run', async () => {
  const harness = createHarness({ readiness: ['1,1,1,0'] })
  const markerPath = '/private/tmp/local-terminal-ready'
  const readFile = harness.dependencies.readFile
  harness.dependencies.readFile = async (filePath, encoding) => {
    if (filePath === markerPath && harness.calls.applicationSpawned) {
      return 'LOCAL_TERMINAL_READY_FROM_ANOTHER_RUN'
    }
    return readFile(filePath, encoding)
  }
  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      timeoutMs: 20,
      readinessTarget: 'terminal',
      markerPath,
      markerContent: 'LOCAL_TERMINAL_READY_FOR_THIS_RUN',
      dependencies: harness.dependencies,
    }),
    /terminal readiness did not complete.*terminalReady.*false/,
  )
  assert.deepEqual(harness.calls.kill, ['SIGTERM'])
})

test('rejects a pre-existing terminal marker before spawning the application', async () => {
  const harness = createHarness()
  const markerPath = '/private/tmp/local-terminal-ready'
  harness.dependencies.readFile = async filePath => {
    if (filePath === markerPath) {
      return 'LOCAL_TERMINAL_READY'
    }
    return Buffer.from('binary')
  }

  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      readinessTarget: 'terminal',
      markerPath,
      markerContent: 'LOCAL_TERMINAL_READY',
      dependencies: harness.dependencies,
    }),
    /terminal marker already exists with expected content/,
  )
  assert.equal(harness.calls.applicationSpawned, false)
})

test('strict local readiness waits for marker evidence after the window is ready', async () => {
  const harness = createHarness({ readiness: ['1,1,1,0'] })
  const markerPath = '/private/tmp/local-terminal-ready'
  const access = harness.dependencies.access
  harness.dependencies.access = async filePath => {
    if (filePath === markerPath) throw new Error('terminal marker is not ready')
    return access(filePath)
  }

  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      timeoutMs: 20,
      readinessTarget: 'terminal',
      markerPath,
      dependencies: harness.dependencies,
    }),
    /terminal readiness did not complete.*windowReady.*false.*terminalReady.*false/,
  )
  assert.deepEqual(harness.calls.kill, ['SIGTERM'])
})

test('supports remote readiness with an isolated home and shell marker', async () => {
  const harness = createHarness({ readiness: ['0,1,1,0'] })
  const markerPath = '/private/tmp/remote-cold-home/REMOTE_COLD_MARKER'
  const readFile = harness.dependencies.readFile
  harness.dependencies.readFile = async (filePath, encoding) => {
    if (filePath === markerPath) {
      harness.calls.readFile.push({ filePath, encoding })
      assert.equal(encoding, 'utf8')
      if (!harness.calls.applicationSpawned)
        throw new Error('marker is not ready')
      return 'REMOTE_COLD_MARKER'
    }
    return readFile(filePath, encoding)
  }
  const result = await runColdStartStopwatch({
    appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
    timeoutMs: 1_000,
    readinessMode: 'remote',
    homeDirectory: '/private/tmp/remote-cold-home',
    markerPath,
    markerContent: 'REMOTE_COLD_MARKER',
    dependencies: harness.dependencies,
  })
  assert.equal(result.ok, true)
  assert.equal(result.readinessMode, 'remote')
  assert.equal(result.axProbe, 'native')
  assert.equal(result.markerReady, true)
  assert.deepEqual(result.readiness, {
    localTab: false,
    connected: true,
    terminalInput: true,
    shellPrompt: false,
  })
  assert.equal(
    harness.calls.spawn[1].options.env.HOME,
    '/private/tmp/remote-cold-home',
  )
  assert.ok(
    harness.calls.readFile.some(
      ({ filePath, encoding }) =>
        filePath === markerPath && encoding === 'utf8',
    ),
  )
})

test('allows remote readiness to skip AX probing entirely', async () => {
  const harness = createHarness({ readiness: ['0,0,0,0'] })
  const markerPath = '/private/tmp/remote-cold-home/REMOTE_COLD_MARKER'
  const readFile = harness.dependencies.readFile
  harness.dependencies.readFile = async (filePath, encoding) => {
    if (filePath === markerPath && harness.calls.applicationSpawned) {
      return 'REMOTE_COLD_MARKER'
    }
    return readFile(filePath, encoding)
  }

  const result = await runColdStartStopwatch({
    appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
    timeoutMs: 1_000,
    axProbe: 'none',
    readinessMode: 'remote',
    markerPath,
    markerContent: 'REMOTE_COLD_MARKER',
    dependencies: harness.dependencies,
  })

  assert.equal(result.axProbe, 'none')
  assert.equal(result.readiness, null)
  assert.equal(harness.calls.swiftc.length, 0)
  assert.equal(harness.calls.native.length, 0)
})

test('uses remote markers when WebKit hides the connected status and input', async () => {
  const harness = createHarness({ readiness: ['0,0,0,0'] })
  const markerPath = '/private/tmp/remote-cold-home/REMOTE_COLD_MARKER'
  const readFile = harness.dependencies.readFile
  harness.dependencies.readFile = async (filePath, encoding) => {
    if (filePath === markerPath && harness.calls.applicationSpawned) {
      return 'REMOTE_COLD_MARKER'
    }
    return readFile(filePath, encoding)
  }

  const result = await runColdStartStopwatch({
    appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
    timeoutMs: 1_000,
    readinessMode: 'remote',
    homeDirectory: '/private/tmp/remote-cold-home',
    markerPath,
    markerContent: 'REMOTE_COLD_MARKER',
    dependencies: harness.dependencies,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.readiness, {
    localTab: false,
    connected: false,
    terminalInput: false,
    shellPrompt: false,
  })
  assert.equal(result.markerReady, true)
})

test('does not treat remote AX readiness as sufficient without marker evidence', async () => {
  const harness = createHarness({ readiness: ['0,1,1,0'] })

  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      timeoutMs: 20,
      readinessMode: 'remote',
      dependencies: harness.dependencies,
    }),
    /terminal readiness did not complete/,
  )
  assert.deepEqual(harness.calls.kill, ['SIGTERM'])
})

test('does not report remote readiness when marker content does not match', async () => {
  const harness = createHarness({ readiness: ['0,1,1,0'] })
  const markerPath = '/private/tmp/remote-cold-home/REMOTE_COLD_MARKER'
  const readFile = harness.dependencies.readFile
  harness.dependencies.readFile = async (filePath, encoding) => {
    if (filePath === markerPath) {
      harness.calls.readFile.push({ filePath, encoding })
      assert.equal(encoding, 'utf8')
      return 'WRONG_MARKER'
    }
    return readFile(filePath, encoding)
  }

  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      timeoutMs: 20,
      readinessMode: 'remote',
      homeDirectory: '/private/tmp/remote-cold-home',
      markerPath,
      markerContent: 'REMOTE_COLD_MARKER',
      dependencies: harness.dependencies,
    }),
    /markerReady.*false/,
  )
  assert.deepEqual(harness.calls.kill, ['SIGTERM'])
})

test('requires a marker path when marker content is provided', async () => {
  const harness = createHarness()
  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      markerContent: 'REMOTE_COLD_MARKER',
      dependencies: harness.dependencies,
    }),
    /marker content requires marker path/,
  )
  assert.equal(harness.calls.spawn.length, 0)
})

test('requires non-empty marker content', async () => {
  const harness = createHarness()
  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      markerPath: '/private/tmp/remote-cold-home/REMOTE_COLD_MARKER',
      markerContent: '',
      dependencies: harness.dependencies,
    }),
    /marker content must be a non-empty string/,
  )
  assert.equal(harness.calls.spawn.length, 0)
})

test('does not report remote readiness before the shell marker exists', async () => {
  const harness = createHarness({ readiness: ['0,1,1,0'] })
  const markerPath = '/private/tmp/remote-cold-home/REMOTE_COLD_MARKER'
  const access = harness.dependencies.access
  harness.dependencies.access = async filePath => {
    if (filePath === markerPath) throw new Error('marker is not ready')
    return access(filePath)
  }

  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      timeoutMs: 20,
      readinessMode: 'remote',
      homeDirectory: '/private/tmp/remote-cold-home',
      markerPath,
      dependencies: harness.dependencies,
    }),
    /markerReady.*false/,
  )
  assert.deepEqual(harness.calls.kill, ['SIGTERM'])
})

test('fails when the app exits before readiness', async () => {
  const harness = createHarness({ closeCode: 23 })
  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      timeoutMs: 1_000,
      dependencies: harness.dependencies,
    }),
    /exited with code 23/,
  )
})

test('uses terminal readiness wording when a remote marker app exits early', async () => {
  const harness = createHarness({ closeCode: 1 })
  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      readinessMode: 'remote',
      axProbe: 'none',
      markerPath: '/private/tmp/remote-marker',
      markerContent: 'READY',
      dependencies: harness.dependencies,
    }),
    /before terminal readiness/,
  )
})

test('fails closed when the app never emits a spawn event', async () => {
  const harness = createHarness({ emitSpawn: false })
  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      timeoutMs: 20,
      dependencies: harness.dependencies,
    }),
    /did not emit a spawn event/,
  )
  assert.deepEqual(harness.calls.kill, ['SIGTERM'])
})

test('fails closed when an AX-visible terminal condition is incomplete at the deadline', async () => {
  const harness = createHarness({ readiness: ['1,1,0,1'] })
  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      timeoutMs: 20,
      dependencies: harness.dependencies,
    }),
    /window readiness did not complete/,
  )
  assert.deepEqual(harness.calls.kill, ['SIGTERM'])
})

test('explains an unrendered UI when no readiness condition is ever exposed', async () => {
  const harness = createHarness({ readiness: ['0,0,0,0'] })
  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      timeoutMs: 20,
      dependencies: harness.dependencies,
    }),
    /the UI never rendered/,
  )
})

test('does not blame the UI when some readiness condition was observed', async () => {
  const harness = createHarness({ readiness: ['1,0,0,0'] })
  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      timeoutMs: 20,
      dependencies: harness.dependencies,
    }),
    error => {
      assert.match(error.message, /window readiness did not complete/)
      assert.doesNotMatch(error.message, /the UI never rendered/)
      return true
    },
  )
})

test('fails if SIGTERM does not produce a close event before cleanup grace', async () => {
  const harness = createHarness({ closeOnKill: false })
  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      timeoutMs: 20,
      cleanupGraceMs: 1,
      dependencies: harness.dependencies,
    }),
    /did not exit within 1 ms/,
  )
  assert.deepEqual(harness.calls.kill, ['SIGTERM', 'SIGKILL'])
})

test('parses the staged timeline and ignores a torn final line', async () => {
  const stages = await readStages('/private/tmp/stages.jsonl', {
    readFile: async () => [
      '{"at_ms":10,"stage":"frontend-boot","detail":"main.tsx evaluated"}',
      '{"at_ms":900,"stage":"ssh-tcp-handshake-done","detail":"127.0.0.1:22"}',
      '{"at_ms":950,"stage":"trunc',
      'not json at all',
    ].join('\n'),
  })
  assert.deepEqual(stages, [
    { atMs: 10, stage: 'frontend-boot', detail: 'main.tsx evaluated' },
    { atMs: 900, stage: 'ssh-tcp-handshake-done', detail: '127.0.0.1:22' },
  ])
})

test('reports no stages when the app never wrote one', async () => {
  assert.deepEqual(
    await readStages('/private/tmp/stages.jsonl', {
      readFile: async () => {
        throw new Error('ENOENT')
      },
    }),
    [],
  )
  assert.equal(describeStages([]), 'none recorded')
})

test('compacts a long stage list without dropping the count', () => {
  assert.equal(
    describeStages([
      { atMs: 1, stage: 'a', detail: '' },
      { atMs: 2, stage: 'b', detail: '' },
    ]),
    'a@1ms -> b@2ms',
  )
  const many = Array.from({ length: 25 }, (_value, index) => ({
    atMs: index,
    stage: 's' + index,
    detail: '',
  }))
  assert.match(describeStages(many), /s24@24ms/)
  assert.match(describeStages(many), /\(\+5 earlier\)/)
})

test('always points the app at a stages file inside its own home', async () => {
  const harness = createHarness()
  const markerPath = '/private/tmp/local-terminal-ready'
  const readFile = harness.dependencies.readFile
  harness.dependencies.readFile = async (filePath, encoding) => {
    if (filePath === markerPath && harness.calls.applicationSpawned) {
      return 'LOCAL_TERMINAL_READY'
    }
    return readFile(filePath, encoding)
  }
  await runColdStartStopwatch({
    appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
    timeoutMs: 1_000,
    readinessTarget: 'terminal',
    axProbe: 'none',
    markerPath,
    markerContent: 'LOCAL_TERMINAL_READY',
    environment: { TERMINAL_STARTUP_STAGES_PATH: '/tmp/forged-stages' },
    dependencies: harness.dependencies,
  })
  const application = harness.calls.spawn.find(
    call =>
      call.command === '/Applications/Termius.app/Contents/MacOS/terminal',
  )
  const stagesPath = application.options.env.TERMINAL_STARTUP_STAGES_PATH
  assert.equal(stagesPath.endsWith(STAGES_FILE_NAME), true)
  assert.equal(stagesPath.includes('forged-stages'), false)
})

test('attributes a readiness timeout to the last stage the app reached', async () => {
  const harness = createHarness({ readiness: ['0,0,0,0'] })
  const stagesPath = '/private/tmp/terminal-cold-start-fixture/terminal-startup-stages.jsonl'
  const readFile = harness.dependencies.readFile
  let clock = 0
  harness.dependencies.now = () => clock
  harness.dependencies.readFile = async (filePath, encoding) => {
    if (filePath === stagesPath && harness.calls.applicationSpawned) {
      clock = 900
      return [
        '{"at_ms":120,"stage":"frontend-boot","detail":"main.tsx evaluated"}',
        '{"at_ms":880,"stage":"ssh-connect-start","detail":"127.0.0.1:22"}',
      ].join('\n')
    }
    return readFile(filePath, encoding)
  }
  await assert.rejects(
    runColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      timeoutMs: 10,
      readinessMode: 'remote',
      homeDirectory: '/private/tmp/terminal-cold-start-fixture',
      markerPath: '/private/tmp/remote-marker',
      markerContent: 'REMOTE_COLD_MARKER',
      dependencies: harness.dependencies,
    }),
    error => {
      assert.match(error.message, /terminal readiness did not complete/)
      assert.match(
        error.message,
        /stages: frontend-boot@120ms -> ssh-connect-start@880ms/,
      )
      return true
    },
  )
})

test('records first stage arrival and the timeline on success', async () => {
  const harness = createHarness({ readiness: ['0,0,0,0'] })
  const stagesPath = '/private/tmp/terminal-cold-start-fixture/terminal-startup-stages.jsonl'
  const markerPath = '/private/tmp/local-terminal-ready'
  const readFile = harness.dependencies.readFile
  let clock = 0
  harness.dependencies.now = () => clock
  harness.dependencies.readFile = async (filePath, encoding) => {
    if (filePath === markerPath && harness.calls.applicationSpawned) {
      clock = 700
      return 'LOCAL_TERMINAL_READY'
    }
    if (filePath === stagesPath && harness.calls.applicationSpawned) {
      return '{"at_ms":250,"stage":"frontend-boot","detail":"main.tsx evaluated"}'
    }
    return readFile(filePath, encoding)
  }
  const result = await runColdStartStopwatch({
    appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
    timeoutMs: 5_000,
    readinessMode: 'remote',
    homeDirectory: '/private/tmp/terminal-cold-start-fixture',
    markerPath,
    markerContent: 'LOCAL_TERMINAL_READY',
    dependencies: harness.dependencies,
  })
  assert.equal(result.stages.length, 1)
  assert.equal(result.stages[0].stage, 'frontend-boot')
  // The marker was satisfied at 700 ms and the stages file is read in the same
  // poll iteration, so the first stage is observed at that offset.
  assert.equal(result.firstStageSeenMs, 700)
})

test('names the stage that exceeded its measured budget', () => {
  const { checked, violations } = evaluateStageBudgets([
    { atMs: 0, stage: 'ssh-connect-start', detail: '' },
    { atMs: 4_000, stage: 'ssh-tcp-handshake-done', detail: '' },
    { atMs: 4_100, stage: 'ssh-auth-done', detail: '' },
    { atMs: 4_200, stage: 'ssh-pty-ready', detail: '' },
  ])
  assert.equal(checked.length, 3)
  assert.deepEqual(violations, [
    {
      from: 'ssh-connect-start',
      to: 'ssh-tcp-handshake-done',
      elapsedMs: 4_000,
      budgetMs: 1_500,
    },
  ])
})

test('a stage that never arrived is not a latency violation', () => {
  const { checked, violations } = evaluateStageBudgets([
    { atMs: 5, stage: 'frontend-boot', detail: '' },
  ])
  assert.deepEqual(checked, [])
  assert.deepEqual(violations, [])
})
