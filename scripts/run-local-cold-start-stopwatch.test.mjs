import assert from 'node:assert/strict'
import { mkdir, rm as removeDirectory, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import {
  createLocalColdStartNonce,
  runLocalColdStartStopwatch,
} from './run-local-cold-start-stopwatch.mjs'

const PROBE_RESULT = JSON.stringify({
  caseName: 'cat-eof',
  durationMs: 12,
  error: null,
  inputEvents: [
    { kind: 'text', bytes: 14, dataHex: '6361742d656f662d70726f62650d' },
    { kind: 'text', bytes: 1, dataHex: '04' },
  ],
  ok: true,
  trace: ['ready', 'pass'],
})

test('generates safe per-run local cold-start nonces', () => {
  const first = createLocalColdStartNonce()
  const second = createLocalColdStartNonce()
  assert.match(first, /^local_[A-Za-z0-9_-]{24}$/)
  assert.match(second, /^local_[A-Za-z0-9_-]{24}$/)
  assert.notEqual(first, second)
})

test('drives strict readiness with a PTY marker carrying the run nonce', async () => {
  const calls = []
  let stopwatchSettled = false
  let readCount = 0
  const dependencies = {
    mkdtemp: async prefix => `${prefix}test`,
    platform: 'darwin',
    readFile: async () => {
      assert.equal(stopwatchSettled, true)
      readCount += 1
      return PROBE_RESULT
    },
    rm: async (...args) => calls.push(['rm', ...args]),
    runStopwatch: async options => {
      calls.push(options)
      assert.equal(options.readinessMode, 'local')
      assert.equal(options.readinessTarget, 'terminal')
      assert.equal(options.axProbe, 'native')
      assert.equal(options.markerPath.endsWith('/terminal-ready.marker'), true)
      assert.match(
        options.markerContent,
        /^TERMINAL_LOCAL_COLD_START_local_[A-Za-z0-9_-]{24}$/,
      )
      assert.equal(options.environment.TERMINAL_SHELL_PROBE, '1')
      assert.equal(
        options.environment.TERMINAL_SHELL_PROBE_NONCE,
        options.nonce,
      )
      assert.equal(
        options.environment.TERMINAL_SHELL_PROBE_MARKER_PATH,
        options.markerPath,
      )
      assert.equal(
        options.environment.TERMINAL_SHELL_PROBE_MARKER_CONTENT,
        options.markerContent,
      )
      assert.deepEqual(options.unsetEnvironmentKeys, [
        'ENV',
        'BASH_ENV',
        'PROMPT_COMMAND',
        'CDPATH',
        'ZDOTDIR',
        'TERMINAL_SHELL_PROBE_SSH_CONFIG_PATH',
      ])
      // The actual stopwatch resolves only after its marker poll succeeds. The
      // runner must not read the probe result before that point.
      stopwatchSettled = true
      return { ok: true, markerReady: true }
    },
    tempDirectory: '/tmp/',
  }

  const result = await runLocalColdStartStopwatch({
    appPath: '/Applications/Terminal.app/Contents/MacOS/terminal',
    dependencies,
  })
  assert.equal(readCount, 1)
  assert.equal(result.probeResult.ok, true)
  assert.equal(result.nonce, calls[0].environment.TERMINAL_SHELL_PROBE_NONCE)
  assert.equal(calls.at(-1)[0], 'rm')
})

test('leaves stale marker rejection to the strict stopwatch', async () => {
  const runDirectory = path.join(
    '/tmp',
    `terminal-local-cold-stale-${process.pid}`,
  )
  await removeDirectory(runDirectory, { recursive: true, force: true })
  await mkdir(runDirectory, { recursive: true })
  await writeFile(path.join(runDirectory, 'terminal-ready.marker'), 'stale')
  let seen
  await assert.rejects(
    runLocalColdStartStopwatch({
      appPath: '/Applications/Terminal.app/Contents/MacOS/terminal',
      dependencies: {
        mkdtemp: async () => runDirectory,
        platform: 'darwin',
        rm: async (directory, options) => {
          assert.equal(directory, runDirectory)
          await removeDirectory(directory, options)
        },
        runStopwatch: async options => {
          seen = options
          throw new Error(
            'cold-start stopwatch terminal marker already exists with expected content',
          )
        },
        tempDirectory: '/tmp',
      },
    }),
    /terminal marker already exists with expected content/,
  )
  assert.match(
    seen.markerContent,
    /^TERMINAL_LOCAL_COLD_START_local_[A-Za-z0-9_-]{24}$/,
  )
})

test('rejects shells without the posix probe dialect before spawning', async () => {
  await assert.rejects(
    runLocalColdStartStopwatch({
      appPath: '/Applications/Terminal.app/Contents/MacOS/terminal',
      environment: { SHELL: '/opt/homebrew/bin/fish' },
      dependencies: {
        mkdtemp: async () => {
          throw new Error('must not allocate a run directory')
        },
        platform: 'darwin',
        tempDirectory: '/tmp',
      },
    }),
    /has no posix probe dialect.*bash\/zsh/,
  )
})

test('removes startup hooks that could preempt the PTY marker', async () => {
  let seenEnvironment
  await runLocalColdStartStopwatch({
    appPath: '/Applications/Terminal.app/Contents/MacOS/terminal',
    environment: {
      SHELL: '/bin/bash',
      ENV: '/tmp/env',
      BASH_ENV: '/tmp/bash-env',
      PROMPT_COMMAND: 'printf forged',
      CDPATH: '/tmp',
      ZDOTDIR: '/tmp/zsh',
      TERMINAL_DEFAULT_SHELL: '/bin/zsh',
      TERMINAL_SHELL_PROBE_SSH_CONFIG_PATH: '/tmp/stale-ssh-config',
      TERMINAL_SHELL_PROBE_MARKER_PATH: '/tmp/stale-marker',
      TERMINAL_SHELL_PROBE_MARKER_CONTENT: 'stale',
    },
    dependencies: {
      mkdtemp: async prefix => `${prefix}test`,
      platform: 'darwin',
      readFile: async () => PROBE_RESULT,
      rm: async () => {},
      runStopwatch: async options => {
        seenEnvironment = options.environment
        return { ok: true, markerReady: true }
      },
      tempDirectory: '/tmp',
    },
  })
  for (const key of [
    'ENV',
    'BASH_ENV',
    'PROMPT_COMMAND',
    'CDPATH',
    'ZDOTDIR',
    'TERMINAL_SHELL_PROBE_SSH_CONFIG_PATH',
  ]) {
    assert.equal(key in seenEnvironment, false)
  }
  assert.equal(seenEnvironment.TERMINAL_DEFAULT_SHELL, '/bin/zsh')
  assert.equal(
    seenEnvironment.TERMINAL_SHELL_PROBE_MARKER_PATH.endsWith(
      '/terminal-ready.marker',
    ),
    true,
  )
  assert.equal(
    seenEnvironment.TERMINAL_SHELL_PROBE_MARKER_CONTENT.startsWith(
      'TERMINAL_LOCAL_COLD_START_',
    ),
    true,
  )
})
