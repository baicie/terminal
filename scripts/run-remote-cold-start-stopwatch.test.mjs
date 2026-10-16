import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import {
  appConfigDirectory,
  createDatabaseSql,
  runRemoteColdStartStopwatch,
  terminalSmokeTempDirectory,
} from './run-remote-cold-start-stopwatch.mjs'

test('uses the configured smoke temp root and avoids Linux /tmp by default', () => {
  assert.equal(
    terminalSmokeTempDirectory({
      platform: 'linux',
      environment: { TERMINAL_SMOKE_TMP: '/home/runner/terminal-smoke-tmp' },
      homeDirectory: '/home/runner',
      systemTempDirectory: '/tmp',
    }),
    '/home/runner/terminal-smoke-tmp',
  )
  assert.equal(
    terminalSmokeTempDirectory({
      platform: 'linux',
      environment: {},
      homeDirectory: '/home/runner',
      systemTempDirectory: '/tmp',
    }),
    '/home/runner',
  )
  assert.equal(
    terminalSmokeTempDirectory({
      platform: 'darwin',
      environment: {},
      homeDirectory: '/Users/runner',
      systemTempDirectory: '/private/tmp',
    }),
    '/private/tmp',
  )
})

test('maps the SQL plugin app config directory on macOS and Linux', () => {
  assert.equal(
    appConfigDirectory('/tmp/home', 'darwin'),
    '/tmp/home/Library/Application Support/com.baicie.termius',
  )
  assert.equal(
    appConfigDirectory('/tmp/home', 'linux', {
      XDG_CONFIG_HOME: '/tmp/config',
    }),
    '/tmp/config/com.baicie.termius',
  )
  assert.equal(
    appConfigDirectory('/tmp/home', 'linux', {}),
    '/tmp/home/.config/com.baicie.termius',
  )
})

test('creates a minimal remote workspace database with escaped credentials', () => {
  const sql = createDatabaseSql({
    fixture: {
      host: '127.0.0.1',
      port: 65_339,
      username: 'tester',
      privateKey: "PRIVATE KEY 'STAYS IN ISOLATED DB'",
    },
    workspaceId: 'workspace-1',
    tabId: 'remote-tab',
    hostId: 'host-1',
    markerCommand: 'printf %s REMOTE_COLD_MARKER > /tmp/marker',
  })

  assert.match(sql, /CREATE TABLE hosts/)
  assert.match(sql, /INSERT INTO workspaces/)
  assert.match(sql, /"type":"remote"/)
  assert.match(sql, /startup_command/)
  assert.match(sql, /shell_integration TEXT DEFAULT 'off'/)
  assert.match(sql, /PRIVATE KEY ''STAYS IN ISOLATED DB''/)
  assert.match(
    createDatabaseSql({
      fixture: {
        host: '127.0.0.1',
        port: 65_339,
        username: 'tester',
        privateKey: 'PRIVATE KEY',
      },
      workspaceId: 'workspace-1',
      tabId: 'remote-tab',
      hostId: 'host-1',
      markerCommand: 'printf marker',
      shellIntegration: 'zsh',
    }),
    /startup_command,shell_integration[^\n]*'printf marker','zsh'/,
  )
})

test('rejects unknown fixture shells and integration modes before allocating resources', async () => {
  const dependencies = {
    platform: 'darwin',
    mkdtemp: async () => {
      throw new Error('must reject before mkdtemp')
    },
  }
  await assert.rejects(
    runRemoteColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      shell: 'fish',
      dependencies,
    }),
    /unsupported remote cold-start fixture shell/,
  )
  await assert.rejects(
    runRemoteColdStartStopwatch({
      appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
      shell: 'sh',
      shellIntegration: 'auto',
      dependencies,
    }),
    /unsupported remote shell integration/,
  )
})

test('passes the exact marker content to the cold-start stopwatch', async () => {
  const calls = { stopwatch: [], stop: 0 }
  const fixture = {
    host: '127.0.0.1',
    port: 65_339,
    username: 'tester',
    privateKey: 'PRIVATE KEY',
    homePath: '/private/tmp/remote-fixture-home',
    knownHostsPath: '/private/tmp/remote-fixture-known-hosts',
    stop: async () => {
      calls.stop += 1
    },
  }
  let tempDirectoryIndex = 0
  const dependencies = {
    access: async () => {},
    mkdir: async () => {},
    mkdtemp: async prefix => `${prefix}${tempDirectoryIndex++}`,
    platform: 'darwin',
    readFile: async (filePath, encoding) => {
      assert.equal(filePath, fixture.knownHostsPath)
      assert.equal(encoding, 'utf8')
      return 'known-host fixture\n'
    },
    rm: async () => {},
    runStopwatch: async options => {
      calls.stopwatch.push(options)
      return {
        markerPath: options.markerPath,
        markerReady: true,
        ok: true,
      }
    },
    spawn: () => {
      const child = new EventEmitter()
      child.stdin = new PassThrough()
      child.stderr = new PassThrough()
      queueMicrotask(() => child.emit('close', 0, null))
      return child
    },
    startSshd: async () => fixture,
    tempDirectory: '/private/tmp',
    writeFile: async () => {},
  }

  const result = await runRemoteColdStartStopwatch({
    appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
    timeoutMs: 321,
    dependencies,
  })

  assert.equal(calls.stopwatch.length, 1)
  assert.equal(calls.stopwatch[0].axProbe, 'none')
  assert.equal(calls.stopwatch[0].markerContent, 'REMOTE_COLD_MARKER')
  assert.deepEqual(calls.stopwatch[0].markerChecks, [
    {
      path: '/private/tmp/remote-fixture-home/REMOTE_PROMPT_MARKER',
      content: 'REMOTE_PROMPT_MARKER',
    },
  ])
  assert.equal(
    calls.stopwatch[0].environment.TERMINAL_REMOTE_PROMPT_PROBE_MARKER,
    'REMOTE_PROMPT_MARKER',
  )
  assert.equal(
    calls.stopwatch[0].environment.TERMINAL_REMOTE_PROMPT_PROBE_COMMAND,
    "printf '%s\\n' REMOTE_PROMPT_MARKER; false",
  )
  assert.equal(
    calls.stopwatch[0].environment.TERMINAL_REMOTE_PROMPT_PROBE_EXPECTED_CWD,
    fixture.homePath,
  )
  assert.equal(
    calls.stopwatch[0].environment.TERMINAL_REMOTE_PROMPT_PROBE_EXPECTED_EXIT_CODE,
    '1',
  )
  assert.equal(
    calls.stopwatch[0].markerPath,
    '/private/tmp/remote-fixture-home/REMOTE_COLD_MARKER',
  )
  assert.equal(calls.stopwatch[0].timeoutMs, 321)
  assert.equal('checkDevServer' in calls.stopwatch[0], false)
  assert.equal(result.marker, 'REMOTE_COLD_MARKER')
  assert.equal(result.markerReady, true)
  assert.equal(calls.stop, 1)
})

test('never passes a dev server preflight flag to the stopwatch', async () => {
  const seen = []
  const fixture = {
    host: '127.0.0.1',
    port: 65_340,
    username: 'tester',
    privateKey: 'PRIVATE KEY',
    homePath: '/private/tmp/remote-fixture-home',
    knownHostsPath: '/private/tmp/remote-fixture-known-hosts',
    stop: async () => {},
  }
  let tempDirectoryIndex = 0
  const dependencies = {
    access: async () => {},
    mkdir: async () => {},
    mkdtemp: async prefix => `${prefix}${tempDirectoryIndex++}`,
    platform: 'darwin',
    readFile: async () => 'known-host fixture\n',
    rm: async () => {},
    runStopwatch: async options => {
      seen.push('checkDevServer' in options)
      return { markerPath: options.markerPath, markerReady: true, ok: true }
    },
    spawn: () => {
      const child = new EventEmitter()
      child.stdin = new PassThrough()
      child.stderr = new PassThrough()
      queueMicrotask(() => child.emit('close', 0, null))
      return child
    },
    startSshd: async () => fixture,
    tempDirectory: '/private/tmp',
    writeFile: async () => {},
  }

  await runRemoteColdStartStopwatch({
    appPath: '/Applications/Termius.app/Contents/MacOS/terminal',
    dependencies,
  })

  assert.deepEqual(seen, [false])
})

test('supports Linux remote prompt fixtures with an isolated XDG config root', async () => {
  const calls = { stopwatch: [], stop: 0 }
  const fixture = {
    host: '127.0.0.1',
    port: 65_341,
    username: 'tester',
    privateKey: 'PRIVATE KEY',
    homePath: '/tmp/linux-remote-fixture-home',
    knownHostsPath: '/tmp/linux-remote-fixture-known-hosts',
    stop: async () => {
      calls.stop += 1
    },
  }
  let tempDirectoryIndex = 0
  const dependencies = {
    access: async () => {},
    mkdir: async () => {},
    mkdtemp: async prefix => `${prefix}${tempDirectoryIndex++}`,
    platform: 'linux',
    readFile: async () => 'known-host fixture\n',
    rm: async () => {},
    runStopwatch: async options => {
      calls.stopwatch.push(options)
      return { markerPath: options.markerPath, markerReady: true, ok: true }
    },
    spawn: () => {
      const child = new EventEmitter()
      child.stdin = new PassThrough()
      child.stderr = new PassThrough()
      queueMicrotask(() => child.emit('close', 0, null))
      return child
    },
    startSshd: async () => fixture,
    tempDirectory: '/tmp',
    writeFile: async () => {},
  }

  await runRemoteColdStartStopwatch({
    appPath: '/workspace/terminal/target/debug/terminal',
    dependencies,
  })

  assert.equal(calls.stopwatch.length, 1)
  assert.equal(
    calls.stopwatch[0].environment.XDG_CONFIG_HOME,
    '/tmp/terminal-remote-cold-home-0/.config',
  )
  assert.equal(calls.stop, 1)
})
