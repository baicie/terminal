import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import {
  ACCESSIBILITY_PROBE,
  parseAccessibilityReadiness,
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
      if (command === 'osascript' || command.includes('terminal-macos-ax-probe')) {
        if (command.includes('terminal-macos-ax-probe')) {
          calls.native.push({ command, args, options })
        }
        const probe = new FakeChild()
        const output = readiness[Math.min(index++, readiness.length - 1)]
        queueMicrotask(() => {
          probe.stdout.end(`${output}\n`)
          probe.stderr.end()
          probe.emit('close', 0, null)
        })
        return probe
      }
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

test('requires the AX-visible terminal readiness conditions', () => {
  assert.deepEqual(parseAccessibilityReadiness('1,1,1,1\n'), {
    localTab: true,
    connected: true,
    terminalInput: true,
    shellPrompt: true,
  })
  assert.throws(() => parseAccessibilityReadiness('1,1,1'), /four readiness flags/)
  assert.deepEqual(parseAccessibilityReadiness('0,1,1,1'), {
    localTab: false,
    connected: true,
    terminalInput: true,
    shellPrompt: true,
  })
  assert.throws(() => parseAccessibilityReadiness('1,1,1,2'), /0 or 1/)
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
  assert.equal(harness.calls.spawn[0].command, '/Applications/Termius.app/Contents/MacOS/terminal')
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
  assert.equal(harness.calls.spawn.some(({ command }) => command.includes('/Contents/MacOS/terminal')), false)
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
    if (filePath === markerPath) return 'READY'
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

test('measures from child spawn to all AX readiness conditions', async () => {
  const harness = createHarness()
  const result = await runColdStartStopwatch({
    appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
    timeoutMs: 1_000,
    dependencies: harness.dependencies,
  })
  assert.equal(result.ok, true)
  assert.equal(result.axProbe, 'native')
  assert.equal(result.pid, 41_700)
  assert.equal(result.binarySha256, '9a3a45d01531a20e89ac6ae10b0b0beb0492acd7216a368aa062d1a5fecaf9cd')
  assert.match(result.capturedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(result.readiness.localTab, true)
  assert.equal(result.readiness.connected, true)
  assert.equal(result.readiness.terminalInput, true)
  assert.equal(result.readiness.shellPrompt, true)
  assert.equal(harness.calls.spawn[0].command, 'swiftc')
  assert.equal(harness.calls.spawn[1].command, '/Applications/Termius.app/Contents/MacOS/terminal')
  assert.equal(harness.calls.spawn[2].command.includes('terminal-macos-ax-probe'), true)
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

test('uses remote markers when WebKit hides the connected status and input', async () => {
  const harness = createHarness({ readiness: ['0,0,0,0'] })
  const markerPath = '/private/tmp/remote-cold-home/REMOTE_COLD_MARKER'
  const readFile = harness.dependencies.readFile
  harness.dependencies.readFile = async (filePath, encoding) => {
    if (filePath === markerPath) return 'REMOTE_COLD_MARKER'
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
    /AX readiness did not complete/,
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
    /AX readiness did not complete/,
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
      assert.match(error.message, /AX readiness did not complete/)
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
  assert.deepEqual(harness.calls.kill, ['SIGTERM'])
})
