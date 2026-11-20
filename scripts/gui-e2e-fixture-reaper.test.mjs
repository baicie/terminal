// The SSH fixture must not outlive the process that started it.
//
// ## The defect this pins
//
// Measured on the development machine while auditing the two-host case:
//
//   $ ps aux | grep 'sshd -D -e -f /var/folders/.*terminal-gui-sftp'
//   5 processes, the oldest started 8:17 PM the previous evening
//
// Every one had `ppid=1`. `startSeededSshd` spawns a `-D` (foreground) sshd; the only
// caller of `stop()` is `scripts/run-gui-e2e.mjs:347`, which is the *happy* path — a
// cancelled CI job, a Ctrl-C during a fifteen-minute spec run, or any throw between
// start and that line leaves the daemon listening forever.
//
// The consequences are not cosmetic:
//
//   * `reservePort()` closes its probe socket and returns the port, so a *stale*
//     daemon already bound to that number is invisible to it until the new sshd fails
//     to bind — an intermittent "sshd did not listen" with no cause in the log;
//   * a shared runner accumulates processes nobody owns, each with an authorized_keys
//     file pointing at a throwaway key.
//
// The fix is a module-level registry plus `beforeExit`/signal hooks, which is what
// this file tests: **the fixture's own module** is given the signal, and no daemon may
// survive it.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const FIXTURE = path.join(ROOT, 'e2e/gui/fixtures/seed-sftp-host.mjs')

/**
 * Whether this machine can run the fixture at all.
 *
 * `sshd` is optional on Windows and `node:sqlite` needs Node >= 22.5 with the flag.
 * A missing precondition is reported as a skip with the reason, never as a pass —
 * the same rule the rest of this suite follows.
 */
const CAN_RUN = process.platform !== 'win32'

/**
 * Whether `node:sqlite` is reachable in a child process.
 *
 * The fixture writes a host row and needs it. Node 22.5–22.x has the module behind
 * `--experimental-sqlite`, which the child sets for itself; older versions do not have
 * it at all. Reported as a skip with the reason rather than a failure, because the
 * fixture cannot run here either — the same rule the scorecard test follows.
 */
function childHasSqlite() {
  return new Promise(resolve => {
    const probe = spawn(
      process.execPath,
      ['--input-type=module', '-e', "await import('node:sqlite'); process.exit(0)"],
      { env: { ...process.env, NODE_OPTIONS: '--experimental-sqlite' }, stdio: 'ignore' },
    )
    probe.on('exit', code => resolve(code === 0))
    probe.on('error', () => resolve(false))
  })
}

test('a fixture killed by SIGTERM leaves no sshd behind', async t => {
  if (!CAN_RUN) {
    t.skip('the SSH fixture needs a Unix sshd')
    return
  }
  if (!(await childHasSqlite())) {
    t.skip('node:sqlite is unavailable, so the fixture cannot seed a host row')
    return
  }
  const home = mkdtempSync(path.join(os.tmpdir(), 'reaper-test-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))

  /*
   * The child starts a real sshd and then signals itself, never calling `stop()`.
   *
   * This is the exact shape of an interrupted run: the harness had started the
   * server and was in the middle of a spec when the process died. If the fix works,
   * the hook reaps the daemon; if it does not, this test finds an orphan.
   */
  const script = `
    const mod = await import(${JSON.stringify(FIXTURE)})
    const fixture = await mod.startSeededSshd({ home: ${JSON.stringify(home)} })
    process.stdout.write('PORT=' + fixture.port + '\\n')
    process.kill(process.pid, 'SIGTERM')
  `
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, NODE_OPTIONS: '--experimental-sqlite' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => (stdout += chunk))
  child.stderr.on('data', chunk => (stderr += chunk))

  const exited = await new Promise(resolve => {
    child.on('exit', (code, signal) => resolve({ code, signal }))
    // A fixture that cannot start must fail the test with its own message, not hang.
    globalThis.setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ code: null, signal: 'TIMEOUT' })
    }, 60_000).unref?.()
  })

  const portMatch = /PORT=(\d+)/.exec(stdout)
  if (!portMatch) {
    // No port means the fixture never started. That is a real failure of this test's
    // precondition — reported with the child's stderr rather than skipped silently.
    assert.fail(`the fixture never reported a port.\nstdout: ${stdout}\nstderr: ${stderr}`)
  }
  const port = Number(portMatch[1])

  // The child must die from the signal it sent itself, not from the test's timeout.
  assert.equal(exited.signal, 'SIGTERM', `the probe should exit on SIGTERM, got ${JSON.stringify(exited)}`)

  /*
   * Wait for the port to be free.
   *
   * A SIGKILL is immediate, but the kernel can hold the listener briefly after the
   * process is reaped. Polling the port rather than sleeping a fixed amount is what
   * makes this test's verdict about the process, not about timing.
   */
  const { connect } = await import('node:net')
  const stillListening = () =>
    new Promise(resolve => {
      const socket = connect({ host: '127.0.0.1', port }, () => {
        socket.destroy()
        resolve(true)
      })
      socket.on('error', () => resolve(false))
      socket.setTimeout(1_000, () => {
        socket.destroy()
        resolve(false)
      })
    })

  const deadline = Date.now() + 10_000
  let listening = await stillListening()
  while (listening && Date.now() < deadline) {
    await new Promise(resolve => globalThis.setTimeout(resolve, 200))
    listening = await stillListening()
  }

  assert.equal(
    listening,
    false,
    `an sshd survived the fixture's SIGTERM and is still listening on ${port}. ` +
      'Without the registry hook this is what a cancelled run leaves behind.',
  )
})
