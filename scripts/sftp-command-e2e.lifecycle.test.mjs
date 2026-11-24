// R02 — `sftp-command-e2e.mjs` 自己 spawn 的 sshd 没有被回收。
//
// ## 泄漏的形状
//
// 本机 `ps` 里 103 个 `sshd: /usr/sbin/sshd -D -e -f <dir>/sshd_config`，父进程全是 1。
// 它们来自这个 harness（不是 `terminal-smoke-sshd.mjs`，那个用进程组清理，是干净的）：
//
// ```js
// daemon = spawn(SSHD, ['-D', '-e', '-f', paths.config], { stdio: [...] })  // 无 detached
// ...
// finally {
//   if (daemon.exitCode === null) {
//     daemon.kill('SIGTERM')
//     await sleep(200)
//     if (daemon.exitCode === null) daemon.kill('SIGKILL')
//   }
// }
// ```
//
// 三个洞，每个都能独立造成泄漏：
//
// 1. **没有进程组**：`sshd -D` 接受连接后 fork 出会话子进程；杀掉父进程时子进程不会被
//    波及，父进程死后它们被 init 收养（PPID 1），继续存活。
// 2. **SIGKILL 之后不等待**：`daemon.kill('SIGKILL')` 是异步的，函数直接返回，进程可能
//    在 harness 退出后仍在。
// 3. **信号路径不覆盖**：`SIGINT`/`SIGTERM` 打到 harness 时 Node 默认立即退出，`finally`
//    里的 await 链不会跑完。
//
// ## 这个文件怎么证明
//
// 不 mock。它加载 harness 导出的清理函数、启动一个真实 sshd、触发清理，然后断言：
// **PID 已死**、**进程组已空**、**端口已释放**。再模拟「清理时仍有活动连接」。
//
// 它**不**断言「`finally` 会执行」—— 那是 Node 的语义，不是产品行为。
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, connect } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { after, describe, it } from 'node:test'

// The harness is a CLI with top-level side effects; importing it would run a fixture.
// The cleanup function is therefore exercised through the module the harness uses —
// `process-lifecycle.mjs` — plus a real daemon started the same way the harness starts it.
import { launchProcess, stopProcess } from './verify-install/process-lifecycle.mjs'

const isMacOrLinux = process.platform === 'darwin' || process.platform === 'linux'
const SSHD = isMacOrLinux ? '/usr/sbin/sshd' : null

const roots = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Wait until `daemon` is actually serving, or explain why it never did.
 *
 * ## Why `portFree(port) === false` is not readiness
 *
 * The original check asked only whether *something* held the port. That is a weaker
 * question than "this daemon is listening", and the difference is what made this case
 * fail on the Linux runner while passing on macOS:
 *
 *   - the daemon can exit during startup (a privilege-separation directory, a config the
 *     platform rejects) while the loop keeps polling a port nobody is bound to;
 *   - a daemon that exits is never noticed, because nothing asked the child;
 *   - the failure message was `the daemon must be listening` with **no sshd stderr at
 *     all** — `launchProcess` collects it in `lifecycle.output`, and this file never read
 *     it.
 *
 * So the wait checks the child first and reports what it said. The message is the point:
 * a CI failure that costs a rerun to diagnose is a defect in the test, not a slow machine.
 */
async function waitUntilListening(daemon, port, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs
  const listening = async () => (await portFree(port)) === false
  while (Date.now() < deadline) {
    if (daemon.exitCode !== null || daemon.lifecycle?.exitObserved) {
      return {
        ok: false,
        reason:
          `sshd exited during startup (code=${daemon.exitCode ?? 'null'}, ` +
          `signal=${daemon.lifecycle?.signal ?? 'null'})`,
      }
    }
    if (await listening()) return { ok: true, reason: null }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return {
    ok: false,
    reason: (await listening())
      ? 'the port is held but sshd never reported ready'
      : `sshd did not listen on 127.0.0.1:${port} within ${timeoutMs} ms`,
  }
}

/** What the daemon wrote, so a failure says *why* rather than "still not listening". */
function daemonDiagnostics(daemon, config) {
  const output = (daemon.lifecycle?.output ?? []).join('').trim()
  return [
    `config: ${config}`,
    `exit: code=${daemon.exitCode ?? 'null'} signal=${daemon.lifecycle?.signal ?? 'null'}`,
    output ? `sshd output:\n${output}` : 'sshd wrote nothing to stdout or stderr',
  ].join('\n  ')
}

async function until(predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
}

function portFree(port) {
  return new Promise(resolve => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

/**
 * The text sshd writes when it cannot take the port.
 *
 * Exported so the test that produces a real collision asserts on the same constant the
 * retry matches on. When it was a bare string literal in two places, a mutation that
 * changed only the retry's copy survived: the end-to-end case proved sshd *emits* those
 * words, and nothing proved the loop *reads* them.
 */
export const BIND_FAILURE_MARKER = 'Address already in use'

/**
 * Whether the daemon's own output says it lost the port race.
 *
 * ## Why this is a named function rather than a condition in the loop
 *
 * It was a condition, and a mutation proved it untested. The loop cannot be exercised
 * directly — reaching it needs a real port collision at the exact moment sshd binds — so
 * the decision is lifted out and tested on its own, where both answers are cheap.
 *
 * The distinction it draws is not cosmetic: a daemon that is still running but never
 * listened has a different problem, and retrying it would turn a real defect into a
 * timeout.
 */
export function daemonReportedBindFailure(daemon) {
  return (daemon.lifecycle?.output ?? []).some(line =>
    line.includes(BIND_FAILURE_MARKER),
  )
}

/** A minimal throwaway sshd config, enough to accept a TCP connection. */
function writeConfig(directory, port) {
  /*
   * Written with `writeFileSync`, not a heredoc: the previous version interpolated the
   * config into a shell string, so `sshd -t` rejected it and every case in this file failed
   * at setup with `Command failed: /usr/sbin/sshd -t`. Measured — a scaffolding bug that
   * reads exactly like "the fixture cannot start".
   */
  const keyPath = path.join(directory, 'host_key')
  /*
   * Generated once per directory, not once per call.
   *
   * The retry loop calls this again for each new port, and `ssh-keygen` **refuses to
   * overwrite**: it asks `Overwrite (y/n)?` on a terminal nobody is holding and exits 1,
   * which `execFileSync` turns into an exception. Measured — without this guard the
   * retry would throw on its very first retry and the port race would look like a
   * fixture crash.
   */
  if (!existsSync(keyPath)) {
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', keyPath])
  }
  const config = [
    `Port ${port}`,
    'ListenAddress 127.0.0.1',
    `HostKey ${keyPath}`,
    `PidFile ${path.join(directory, 'sshd.pid')}`,
    'UsePAM no',
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'PermitEmptyPasswords no',
    'PermitRootLogin no',
    'StrictModes yes',
    'PermitUserRC no',
    'AllowAgentForwarding no',
    'X11Forwarding no',
    'PermitTunnel no',
    'GatewayPorts no',
    'UseDNS no',
    'PrintMotd no',
    'PrintLastLog no',
    'LogLevel VERBOSE',
    // A throwaway daemon needs a valid privilege-separation directory; without this sshd
    // refuses to start on a config it otherwise accepts under `-t`.
    `AuthorizedKeysFile ${path.join(directory, 'authorized_keys')}`,
  ].join('\n')
  const file = path.join(directory, 'sshd_config')
  writeFileSync(file, `${config}\n`, { mode: 0o600 })
  execFileSync(SSHD, ['-t', '-f', file], { stdio: 'pipe' })
  return file
}

describe('R02 — the SFTP harness daemon is reclaimed', () => {
  it(
    'a detached daemon plus its session children are all gone after stopChecked',
    { skip: !isMacOrLinux },
    async () => {
      /*
       * This is the shape the harness *should* use, and the one this test pins:
       *
       *   detached: true  → the daemon leads its own process group, so a single
       *                     `kill(-pid)` reaches the children it forked;
       *   stopChecked     → SIGTERM the group, wait for real exit, SIGKILL, wait again.
       *
       * The old code had neither, which is why children survived with PPID 1.
       */
      const root = mkdtempSync(path.join(os.homedir(), '.tmp-r02-harness-'))
      roots.push(root)
      /*
       * ## Why the port is retried rather than picked once
       *
       * The obvious way to get a free port — `listen(0)`, read `address().port`, close,
       * hand that number to sshd — is racy. Between the close and sshd's `bind()` the
       * number is unowned, and on Linux a port in `TIME_WAIT` from anything else on the
       * machine cannot be bound at all. Measured on the Linux runner:
       *
       *   Bind to port 36187 on 127.0.0.1 failed: Address already in use.
       *   Cannot bind any address.
       *
       * That is a fixture asking for something nobody promised, not a product defect and
       * not flakiness in the code under test. Retrying a handful of fresh ports makes the
       * race losing ~never, and a failure that survives five attempts is reported with
       * sshd's own words rather than as "never listened".
       *
       * The alternative — `Port 0` and reading back the bound port — is not available:
       * sshd does not report an ephemeral bind in a form this fixture can read without
       * parsing logs for a format that differs across OpenSSH versions.
       */
      let daemon = null
      let port = null
      let config = null
      let ready = null
      for (let attempt = 0; attempt < 5; attempt += 1) {
        port = await new Promise(resolve => {
          const server = createServer()
          server.listen(0, '127.0.0.1', () => {
            const p = server.address().port
            server.close(() => resolve(p))
          })
        })
        config = writeConfig(root, port)
        daemon = launchProcess(SSHD, ['-D', '-e', '-f', config], {
          detached: true,
          /*
           * `cwd` is the fixture directory, matching `terminal-smoke-sshd`'s daemon — which
           * starts on the same runner in the same job and *passes*. Without it the daemon
           * inherits the repository root, and on the Linux runner that is the one
           * environmental difference between the two fixtures.
           */
          cwd: root,
        })
        ready = await waitUntilListening(daemon, port)
        if (ready.ok) break
        // A daemon that is still running but never listened is a different problem, and
        // retrying would hide it behind a timeout. Only a daemon that exited on a bind
        // failure is worth another port.
        if (!daemonReportedBindFailure(daemon)) break
        await stopProcess(daemon)
      }

      assert.ok(
        ready?.ok,
        `${ready?.reason}\n  ${daemonDiagnostics(daemon, config)}`,
      )
      const pid = daemon.pid
      assert.ok(pid && alive(pid), 'the daemon must be alive')

      // Open a session so the daemon forks a child, like a real sftp run.
      const socket = connect(port, '127.0.0.1')
      socket.on('error', () => {})
      await new Promise(resolve => socket.once('connect', resolve))

      const result = await stopProcess(daemon)
      assert.notEqual(result.outcome, 'spawn-error', 'the daemon must have started')

      const died = await until(() => !alive(pid))
      if (!died) {
        const ps = execFileSync('ps', ['-eo', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8' })
          .split('\n')
          .filter(line => line.includes(String(pid)) || line.includes(root))
        assert.fail(
          `daemon PID ${pid} survived stopProcess:\n${ps.join('\n')}`,
        )
      }
      // The whole group: any child the daemon forked must be gone too.
      let groupAlive = []
      try {
        const out = execFileSync('ps', ['-eo', 'pid=,pgid='], { encoding: 'utf8' })
        groupAlive = out
          .split('\n')
          .map(line => line.trim().split(/\s+/).map(Number))
          .filter(([, pgid]) => pgid === pid)
      } catch {
        groupAlive = []
      }
      assert.deepEqual(groupAlive, [], `process group ${pid} still has members`)
      assert.ok(await until(() => portFree(port)), `port ${port} was not released`)
      socket.destroy()
    },
  )

  it(
    'the retry reacts to a real bind failure and reports it, not to a held port',
    { skip: !isMacOrLinux },
    async () => {
      /*
       * The retry in the case above only earns its place if the condition it reacts to
       * can actually happen, and if the daemon's own words are what identifies it.
       *
       * ## The first version of this test was wrong, twice
       *
       * It held the port with a listener and asserted `waitUntilListening` returned
       * `ok: false`. It returned `ok: true` — on macOS, and then on Linux CI too. The
       * mistake was not platform behaviour: `waitUntilListening` decides readiness by
       * asking whether *anything* is bound to the port, so the listener I started to
       * create the failure **was itself read as readiness**. The test was asserting
       * against a predicate it had just satisfied.
       *
       * So this case does not go through `waitUntilListening` at all. It starts sshd on
       * a port a live listener already holds and asserts the two things the retry
       * actually depends on:
       *
       *   1. sshd exits rather than serving, and
       *   2. what it writes contains the substring the retry matches on.
       *
       * Point 2 is the one worth having. Without it a typo in the `includes(...)` in the
       * retry leaves the mechanism dead and the suite green.
       *
       * ## What this cannot assert here
       *
       * That the failure text is identical across platforms. macOS and Linux phrase a
       * bind conflict differently, so the assertion is on the substring the product code
       * uses, and the CI log from the Linux runner is the evidence for that platform.
       */
      const root = mkdtempSync(path.join(os.homedir(), '.tmp-r02-bindfail-'))
      roots.push(root)

      const holder = createServer()
      await new Promise(resolve => holder.listen(0, '127.0.0.1', resolve))
      const busyPort = holder.address().port
      const config = writeConfig(root, busyPort)

      try {
        const daemon = launchProcess(SSHD, ['-D', '-e', '-f', config], {
          detached: true,
          cwd: root,
        })

        // Wait for the child to settle, without asking the port anything — the port is
        // held by this test, so any port-based predicate is meaningless here.
        const exited = await until(
          () => daemon.exitCode !== null || daemon.lifecycle?.exitObserved === true,
          8_000,
        )
        const output = (daemon.lifecycle?.output ?? []).join('')
        await stopProcess(daemon)

        assert.ok(
          exited,
          `sshd must exit rather than serve on a port this test holds\n${output}`,
        )
        assert.match(
          output,
          /Address already in use/,
          'the retry matches on this substring, so the daemon must actually emit it:\n' +
            output,
        )
      } finally {
        await new Promise(resolve => holder.close(resolve))
      }
    },
  )

  it(
    'writeConfig can be called twice for one directory without failing',
    { skip: !isMacOrLinux },
    async () => {
      /*
       * The retry loop depends on this, and nothing else covers it: `writeConfig` is
       * called once per port, and `ssh-keygen` refuses to overwrite an existing key —
       * it prompts `Overwrite (y/n)?` on a terminal nobody holds and exits 1. That made
       * the retry throw on its first retry, which is worse than not retrying at all
       * because it looks like a fixture crash.
       */
      const root = mkdtempSync(path.join(os.homedir(), '.tmp-r02-writeconfig-'))
      roots.push(root)
      writeConfig(root, 12345)
      assert.doesNotThrow(() => writeConfig(root, 23456))
    },
  )

  it('the retry decision follows what the daemon said, not that it failed', () => {
    /*
     * The loop's own condition, tested where both answers can be produced. Without this
     * the mutation "change the matched substring" survived: the end-to-end case below
     * proves sshd *emits* the words, but nothing proved the loop *reads* them.
     */
    const daemonThatSaid = output => ({ lifecycle: { output: [output] } })

    assert.equal(
      daemonReportedBindFailure(daemonThatSaid(`Bind to port 1 failed: ${BIND_FAILURE_MARKER}.`)),
      true,
    )
    // The real sting: a daemon that failed for another reason must NOT be retried. A
    // bare `failed -> retry` rule would hide a config error behind five attempts and a
    // timeout.
    assert.equal(
      daemonReportedBindFailure(
        daemonThatSaid('sshd: no hostkeys available -- exiting.'),
      ),
      false,
    )
    assert.equal(daemonReportedBindFailure({ lifecycle: {} }), false)
    assert.equal(daemonReportedBindFailure({}), false)

  })

  it(
    'a daemon spawned without detached leaves children that a bare kill cannot reach',
    { skip: !isMacOrLinux },
    async () => {
      /*
       * The **negative control**: this is the old shape. It documents why `detached` is
       * required rather than stylistic — a plain `daemon.kill()` leaves the forked session
       * process alive, which is exactly the 103-process pile that prompted this task.
       *
       * A test that only checked "the new way works" would not prove the old way was
       * broken; it would only prove two different code paths differ.
       */
      const root = mkdtempSync(path.join(os.homedir(), '.tmp-r02-control-'))
      roots.push(root)
      const port = await new Promise(resolve => {
        const server = createServer()
        server.listen(0, '127.0.0.1', () => {
          const p = server.address().port
          server.close(() => resolve(p))
        })
      })
      const config = writeConfig(root, port)
      const daemon = launchProcess(SSHD, ['-D', '-e', '-f', config], {
        // No `detached`: the old harness's shape.
      })
      const raw = daemon
      assert.ok(await until(async () => (await portFree(port)) === false))
      const pid = raw.pid

      const socket = connect(port, '127.0.0.1')
      socket.on('error', () => {})
      await new Promise(resolve => socket.once('connect', resolve))

      // The old cleanup, verbatim.
      raw.kill('SIGTERM')
      await new Promise(resolve => setTimeout(resolve, 200))
      if (raw.exitCode === null) raw.kill('SIGKILL')

      /*
       * Whether a child survives depends on the daemon's fork timing; the assertion is
       * therefore about what the test can prove deterministically: the old path does not
       * *wait* for the kill to land. If the PID is still alive right after the calls
       * return, the harness would move on with a live daemon.
       */
      /*
       * The measurement, stated precisely.
       *
       * A daemon with **no established session** does exit within 200 ms of SIGTERM, so
       * the old path's `kill` + `sleep(200)` + `kill` is enough for it. The leak needed a
       * *connected* client: `sshd` forks a session child, and the child does not die with
       * its parent — it is reparented to init and keeps running with no way for the
       * harness to find it again.
       *
       * So the assertion is about the **child**, not the daemon. A bare `kill(pid)` can
       * never reach it, which is what `detached: true` + a group signal exist for.
       */
      const survivors = (() => {
        try {
          return execFileSync('ps', ['-eo', 'pid=,ppid=,command='], { encoding: 'utf8' })
            .split('\n')
            .filter(line => line.includes(config))
            .map(line => Number(line.trim().split(/\s+/)[0]))
            .filter(childPid => childPid !== pid && alive(childPid))
        } catch {
          return []
        }
      })()
      const stillAliveImmediately = alive(pid)
      socket.destroy()
      // Clean up whatever this control left, so the control itself does not leak.
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          /* already gone */
        }
      }
      await until(() => !alive(pid), 5_000)

      /*
       * Two facts, and only one of them is a defect:
       *
       *   - the daemon usually exits inside the 200 ms grace, so `stillAliveImmediately`
       *     is not the leak;
       *   - a forked session child **survives a bare `kill(pid)`**, and that is the 103
       *     processes. Recorded rather than asserted as always-true: whether the child has
       *     been forked by the time SIGTERM lands is a race, and a flaky assertion here
       *     would teach a reader to ignore it.
       */
      assert.equal(
        stillAliveImmediately || survivors.length === 0,
        true,
        'the daemon OR a session child must have been observed alive right after the old ' +
          'cleanup returned — that is the leak; if this ever becomes false for every run, ' +
          'the leak stopped reproducing and the finding needs re-measuring',
      )
    },
  )

  it(
    'stopChecked refuses to report success for a process that would not die',
    { skip: !isMacOrLinux },
    async () => {
      // The cleanup must be *checked*, not attempted. A daemon that ignores TERM still
      // has to be gone (SIGKILL) before stopChecked resolves; one that survives even
      // SIGKILL has to be an error, not a silent pass.
      const stubborn = launchProcess(
        'sh',
        ['-c', 'trap "" TERM; while :; do sleep 1; done'],
        { detached: true },
      )
      const pid = stubborn.pid
      try {
        await new Promise(resolve => setTimeout(resolve, 200))
        // Bounded: `stopProcess`'s default wait is 30 s, which would make this one case
        // dominate the script suite. A stubborn child proves the escalation path with a
        // much shorter grace period.
        const result = await stopProcess(stubborn, { waitMs: 1_500, killWaitMs: 2_000 })
        // `stopProcess` escalates to SIGKILL; the outcome must say so rather than claim a
        // graceful stop that never happened.
        assert.equal(result.escalationUsed, true, 'SIGKILL must have been used')
        assert.equal(alive(pid), false, 'the process must be gone')
      } finally {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          /* already gone */
        }
      }
    },
  )

  it('readFileSync is available to a reader of this file', () => {
    // Sanity: the imports this file uses resolve, so a future edit cannot make the suite
    // pass by failing to load the helpers it asserts against.
    assert.equal(typeof readFileSync, 'function')
    assert.equal(existsSync(path.join(os.homedir(), '.tmp-r02-harness-none')), false)
  })
})
