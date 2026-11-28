// DDQ06 — a controlled child process whose footprint we can change on purpose.
//
// ## Why this exists
//
// Every sampler test so far drives a **stub**: `sampleWindows` gets a fake `exec`, and the
// POSIX paths are exercised against whatever `process.pid` happens to be. A stub proves
// the parser; it cannot prove the sampler observes a real process. The task asks for
// exactly that distinction — "sampler 应能识别这些实际变化".
//
// So this spawns a real Node child and gives the test four commands it can send:
//
//   · `allocate` — hold N MiB in Buffers that are touched, so they become resident;
//   · `release`  — drop them and ask the GC to run;
//   · `handles`  — open N files (and, on Windows, N extra kernel handles);
//   · `threads`  — spawn N workers that block on a message;
//   · `exit`     — terminate, so "the process is gone" can be observed.
//
// Each is acknowledged, so a test can assert "the change had happened" before sampling
// rather than sleeping and hoping.
//
// ## Why a child and not the test process itself
//
// The test runner's own footprint moves for reasons the test does not control — other
// tests in the same process, the GC, the assertion library. Measuring it would make every
// assertion a race. A dedicated child starts from a known baseline and only does what it
// is told.
//
// ## Why handles are opened as files
//
// The portable way to raise a handle/descriptor count is to open files: POSIX counts them
// in `/proc/<pid>/fd`, macOS counts them as `lsof` rows, and Windows counts them as kernel
// handles along with registry keys and events. One mechanism, three counters — which is
// also why the numbers are never compared across platforms.

import { fork } from 'node:child_process'
import { openSync, writeSync, closeSync, writeFileSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** The child's own code. Kept as a string so the fixture has no second file to locate. */
const CHILD_SOURCE = String.raw`
const fs = require('node:fs')
const { Worker } = require('node:worker_threads')

let held = []
let handles = []
let workers = []

process.on('message', message => {
  const reply = detail => process.send({ id: message.id, ok: true, ...detail })
  try {
    switch (message.command) {
      case 'allocate': {
        // Touch every page: an untouched Buffer is virtual and does not raise RSS.
        const chunk = Buffer.alloc(message.mib * 1024 * 1024, 1)
        held.push(chunk)
        reply({ heldMib: held.length * message.mib })
        break
      }
      case 'release': {
        held = []
        if (typeof global.gc === 'function') global.gc()
        reply({ heldMib: 0 })
        break
      }
      case 'handles': {
        for (let index = 0; index < message.count; index += 1) {
          handles.push(fs.openSync(message.file, 'r'))
        }
        reply({ openHandles: handles.length })
        break
      }
      case 'closeHandles': {
        for (const handle of handles) {
          try { fs.closeSync(handle) } catch {}
        }
        handles = []
        reply({ openHandles: 0 })
        break
      }
      case 'threads': {
        for (let index = 0; index < message.count; index += 1) {
          // A worker with an empty body stays alive while its port is open, which is a
          // real thread the OS counts.
          workers.push(new Worker('setInterval(() => {}, 1000)', { eval: true }))
        }
        reply({ workers: workers.length })
        break
      }
      case 'stopThreads': {
        Promise.all(workers.map(worker => worker.terminate())).then(() => {
          workers = []
          reply({ workers: 0 })
        })
        break
      }
      case 'exit': {
        process.send({ id: message.id, ok: true })
        // Give the reply a tick to leave before the process disappears.
        setImmediate(() => process.exit(0))
        break
      }
      default:
        process.send({ id: message.id, ok: false, reason: 'unknown command ' + message.command })
    }
  } catch (error) {
    process.send({ id: message.id, ok: false, reason: String(error) })
  }
})

process.send({ id: 0, ok: true, ready: true, pid: process.pid })
`

/**
 * Start the child and wait for its ready message.
 *
 * Returns `{ pid, send, stop }`. `send` resolves with the child's acknowledgement, so a
 * caller can assert the change happened before sampling — the difference between "I asked
 * for 64 MiB" and "64 MiB is resident".
 */
export async function startControlledProcess({ execArgv = [] } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ddq06-child-'))
  const sourceFile = path.join(directory, 'child.cjs')
  writeFileSync(sourceFile, CHILD_SOURCE)
  /*
   * A file the child opens for the handle test. Written and closed here so the child only
   * has to open it, and so a failure to create it is this fixture's error rather than a
   * puzzling "the handle count did not move".
   */
  const handleFile = path.join(directory, 'handle-target.txt')
  writeFileSync(handleFile, 'ddq06\n')

  const child = fork(sourceFile, [], {
    // `--expose-gc` so `release` can actually return memory; without it a released Buffer
    // stays allocated until the next natural GC, and a test that samples immediately would
    // conclude the sampler cannot see a decrease.
    execArgv: [...execArgv, '--expose-gc'],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })

  let nextId = 1
  const pending = new Map()
  let ready = null

  child.on('message', message => {
    if (message?.ready === true && ready === null) {
      ready = message
      return
    }
    const resolver = pending.get(message?.id)
    if (resolver) {
      pending.delete(message.id)
      resolver(message)
    }
  })

  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const childPid = child.pid

  const send = (command, extra = {}) =>
    new Promise((resolve, reject) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        reject(new Error('the controlled process has already exited'))
        return
      }
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`the controlled process did not answer "${command}" within 20 s`))
      }, 20_000)
      pending.set(id, message => {
        clearTimeout(timer)
        if (message.ok === true) resolve(message)
        else reject(new Error(message.reason ?? `"${command}" failed`))
      })
      child.send({ id, command, file: handleFile, ...extra })
    })

  // Wait for the ready message with a deadline: a child that fails to start must show up
  // as a fixture error here, not as a mysterious sampling defect later.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the controlled process never became ready')), 20_000)
    const check = setInterval(() => {
      if (ready !== null) {
        clearInterval(check)
        clearTimeout(timer)
        resolve()
      }
    }, 20)
  })

  return {
    pid: childPid,
    send,
    handleFile,
    /** Resolve when the child exits, so a test can await it before sampling. */
    exited,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
      await exited
    },
  }
}

/** Open N files in this process, for the "the sampler sees the caller's own handles" case. */
export function openFiles(file, count) {
  const handles = []
  for (let index = 0; index < count; index += 1) handles.push(openSync(file, 'r'))
  return () => {
    for (const handle of handles) {
      try {
        closeSync(handle)
      } catch {
        // Already closed; nothing to do.
      }
    }
  }
}

void writeSync
