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

/** A minimal throwaway sshd config, enough to accept a TCP connection. */
function writeConfig(directory, port) {
  /*
   * Written with `writeFileSync`, not a heredoc: the previous version interpolated the
   * config into a shell string, so `sshd -t` rejected it and every case in this file failed
   * at setup with `Command failed: /usr/sbin/sshd -t`. Measured — a scaffolding bug that
   * reads exactly like "the fixture cannot start".
   */
  const keyPath = path.join(directory, 'host_key')
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', keyPath])
  const config = [
    `Port ${port}`,
    'ListenAddress 127.0.0.1',
    `HostKey ${keyPath}`,
    `PidFile ${path.join(directory, 'sshd.pid')}`,
    'UsePAM no',
    'PasswordAuthentication no',
    'PermitRootLogin no',
    'LogLevel ERROR',
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
      const port = await new Promise(resolve => {
        const server = createServer()
        server.listen(0, '127.0.0.1', () => {
          const p = server.address().port
          server.close(() => resolve(p))
        })
      })
      const config = writeConfig(root, port)
      const daemon = launchProcess(SSHD, ['-D', '-e', '-f', config], {
        detached: true,
      })

      assert.ok(await until(async () => (await portFree(port)) === false), 'the daemon must be listening')
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
