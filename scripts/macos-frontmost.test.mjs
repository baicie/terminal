import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import {
  compileMacFrontmostHelper,
  ensureMacProcessFrontmost,
} from './macos-frontmost.mjs'

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
}

function finish(child, { code = 0, stdout = '', stderr = '' } = {}) {
  queueMicrotask(() => {
    child.stdout.end(stdout)
    child.stderr.end(stderr)
    child.emit('close', code, null)
  })
}

test('compiles the AppKit helper and activates a process until it is frontmost', async () => {
  const writes = []
  const calls = []
  let frontmostPid = '100'
  const dependencies = {
    clearTimeout,
    setTimeout: callback => {
      queueMicrotask(callback)
      return 1
    },
    spawn: (command, args) => {
      calls.push({ command, args })
      const child = new FakeChild()
      if (command === 'swiftc') {
        finish(child)
      } else if (args[0] === 'frontmost') {
        finish(child, { stdout: frontmostPid })
      } else if (args[0] === 'activate') {
        frontmostPid = args[1]
        finish(child)
      } else {
        finish(child, { code: 1, stderr: 'unexpected helper command' })
      }
      return child
    },
    writeFile: async (...args) => writes.push(args),
  }

  const helper = await compileMacFrontmostHelper('/private/tmp/run', dependencies)
  await ensureMacProcessFrontmost(41003, helper, dependencies)

  assert.equal(helper, '/private/tmp/run/macos-frontmost')
  assert.match(writes[0][1], /NSWorkspace\.shared\.frontmostApplication/)
  assert.match(writes[0][1], /CGWindowListCopyWindowInfo/)
  assert.match(writes[0][1], /lsappinfo/)
  assert.match(writes[0][1], /workspaceIsLoginWindow/)
  assert.deepEqual(
    calls.map(({ command, args }) => [command, args]),
    [
      ['swiftc', ['-O', '/private/tmp/run/macos-frontmost.swift', '-o', helper]],
      [helper, ['frontmost']],
      [helper, ['activate', '41003']],
      [helper, ['frontmost']],
    ],
  )
})

test('fails when the target process cannot be brought to the foreground', async () => {
  const dependencies = {
    clearTimeout,
    setTimeout: callback => {
      queueMicrotask(callback)
      return 1
    },
    spawn: (_command, args) => {
      const child = new FakeChild()
      finish(child, {
        stdout: args[0] === 'frontmost' ? '100' : '',
      })
      return child
    },
  }

  await assert.rejects(
    ensureMacProcessFrontmost(41003, '/tmp/macos-frontmost', dependencies),
    /expected process 41003 to be frontmost/,
  )
})

test('retries a transient activation failure while the app registers with AppKit', async () => {
  const calls = []
  let activationAttempts = 0
  let frontmostPid = '100'
  const dependencies = {
    clearTimeout,
    setTimeout: callback => {
      queueMicrotask(callback)
      return 1
    },
    spawn: (_command, args) => {
      calls.push(args)
      const child = new FakeChild()
      if (args[0] === 'frontmost') {
        finish(child, { stdout: frontmostPid })
      } else if (args[0] === 'activate') {
        activationAttempts += 1
        if (activationAttempts === 1) finish(child, { code: 3 })
        else {
          frontmostPid = args[1]
          finish(child)
        }
      }
      return child
    },
  }

  await ensureMacProcessFrontmost(41003, '/tmp/macos-frontmost', dependencies)
  assert.equal(activationAttempts, 2)
  assert.deepEqual(calls, [
    ['frontmost'],
    ['activate', '41003'],
    ['frontmost'],
    ['frontmost'],
    ['activate', '41003'],
    ['frontmost'],
  ])
})

test('does not accept loginwindow while the target window is settling', async () => {
  const calls = []
  const frontmostSequence = ['3111', '3111', '3111', '41003']
  const dependencies = {
    clearTimeout,
    setTimeout: callback => {
      queueMicrotask(callback)
      return 1
    },
    spawn: (_command, args) => {
      calls.push(args)
      const child = new FakeChild()
      if (args[0] === 'frontmost') {
        finish(child, { stdout: frontmostSequence.shift() ?? '3111' })
      } else if (args[0] === 'activate') {
        finish(child)
      }
      return child
    },
  }

  await ensureMacProcessFrontmost(41003, '/tmp/macos-frontmost', dependencies)
  assert.deepEqual(calls, [
    ['frontmost'],
    ['activate', '41003'],
    ['frontmost'],
    ['frontmost'],
    ['activate', '41003'],
    ['frontmost'],
  ])
})
