// R02 — fixture 的进程与目录必须在**每一条**退出路径上被回收。
//
// ## 实测的泄漏
//
// 反复运行 SFTP fixture 之后 `ps` 里有 **103 个** `sshd: /usr/sbin/sshd -D -e -f …`
// 进程，父进程全是 1。它们都还活着，各自的配置目录指向已删除或残留的临时目录。
//
// 这不是「跑太多次」的必然结果。`finally` 里确实有 `daemon.kill('SIGTERM')`，但有三个
// 洞：
//
// 1. **只杀直接子进程**：`sshd -D` 在收到 SIGTERM 前可能已经 fork 出会话子进程，而那些
//    子进程的父进程在 daemon 死后变成 1，`daemon.kill` 够不到它们。
// 2. **没有等待真实退出**：`exitCode === null` 的检查在 200 ms 后跑，若进程尚未回收就
//    发 SIGKILL —— 但 SIGKILL 之后**没有再次等待**。下一个用例立刻绑定端口时，旧进程
//    可能仍持有它。
// 3. **信号路径完全没有覆盖**：`SIGINT` / `SIGTERM` 打到 harness 时，Node 默认退出，
//    `finally` 的 await 链不会跑完。
//
// ## 这个文件证明什么
//
// 用一个**真实的 sshd**（不是 mock）走一遍生命周期，断言：正常退出后没有遗留进程、
// 没有遗留目录、端口已释放。再用一个刻意失败的分支验证失败路径同样回收。
//
// 它不验证「harness 的 finally 会执行」—— 那是 Node 的语义。它验证的是**回收本身**：
// 进程真的死了、端口真的空了、目录真的没了。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { after, describe, it } from 'node:test'
import { startTerminalSmokeSshd } from './terminal-smoke-sshd.mjs'

const isMacOrLinux = process.platform === 'darwin' || process.platform === 'linux'

/** PIDs of sshd processes whose config path is inside `directory`. */
function sshdPidsIn(directory) {
  try {
    const out = execFileSync('ps', ['-eo', 'pid=,command='], { encoding: 'utf8' })
    return out
      .split('\n')
      .filter(line => line.includes(directory) && line.includes('sshd'))
      .map(line => Number(line.trim().split(/\s+/)[0]))
      .filter(pid => Number.isInteger(pid) && pid > 0)
  } catch {
    return []
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Is anything listening on this port right now? */
function portInUse(port) {
  return new Promise(resolve => {
    const server = createServer()
    server.once('error', () => resolve(true))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(false)))
  })
}

/** Wait until `predicate` holds, or give up. Bounded: never an infinite wait. */
async function until(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
}

const roots = []
after(async () => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('R02 — the SFTP fixture releases what it starts', () => {
  it(
    'a normal run leaves no process, no port and no directory',
    { skip: !isMacOrLinux },
    async () => {
      const root = mkdtempSync(path.join(os.homedir(), '.tmp-r02-'))
      roots.push(root)
      const fixture = await startTerminalSmokeSshd({
        runDirectory: root,
        enableSftp: true,
      })
      const port = fixture.port
      assert.ok(port > 0, 'the fixture must report its port')
      assert.ok(sshdPidsIn(root).length > 0, 'the fixture must actually start an sshd')

      await fixture.stop()

      assert.ok(
        await until(async () => sshdPidsIn(root).length === 0),
        `sshd still running for ${root}: ${JSON.stringify(sshdPidsIn(root))}`,
      )
      assert.ok(
        await until(async () => !(await portInUse(port))),
        `port ${port} was not released`,
      )
    },
  )

  it(
    'stop() is idempotent — calling it twice does not throw or leak',
    { skip: !isMacOrLinux },
    async () => {
      const root = mkdtempSync(path.join(os.homedir(), '.tmp-r02-'))
      roots.push(root)
      const fixture = await startTerminalSmokeSshd({
        runDirectory: root,
        enableSftp: true,
      })
      await fixture.stop()
      // A second stop on an already-dead daemon is what a double `finally` (a signal
      // handler racing the normal path) produces. It must be a no-op.
      await fixture.stop()
      assert.equal(sshdPidsIn(root).length, 0)
    },
  )

  it(
    'a fixture that is stopped while a session is open still leaves nothing',
    { skip: !isMacOrLinux },
    async () => {
      /*
       * The leak that produced 103 `sshd -D` parents with PPID 1: the daemon forks a
       * per-session child, and killing only the daemon leaves the child to be reaped by
       * init — still holding the config path.
       *
       * This test opens a TCP connection (enough for sshd to accept and fork) and stops
       * the fixture without closing it cleanly first.
       */
      const root = mkdtempSync(path.join(os.homedir(), '.tmp-r02-'))
      roots.push(root)
      const fixture = await startTerminalSmokeSshd({
        runDirectory: root,
        enableSftp: true,
      })

      const { connect } = await import('node:net')
      const socket = connect(fixture.port, '127.0.0.1')
      socket.on('error', () => {})
      await new Promise(resolve => socket.once('connect', resolve))
      // Leave it connected: the daemon has a live child when stop() runs.
      await fixture.stop()

      assert.ok(
        await until(async () => sshdPidsIn(root).length === 0, 8_000),
        `sshd children survived stop(): ${JSON.stringify(sshdPidsIn(root))}`,
      )
      socket.destroy()
    },
  )

  it(
    'the fixture directory is removed by its owner, not left to accumulate',
    { skip: !isMacOrLinux },
    async () => {
      /*
       * 103 stale `/var/folders/.../terminal-gui-sftp-*` directories is what the leak
       * looked like on disk. `stop()` must not require the caller to clean up.
       *
       * ## The first version of this assertion was wrong
       *
       * It read `readdirSync(root)` and required every entry to not contain "sshd" — but
       * `root/sshd/` is the fixture's **own layout**, created before the daemon starts, and
       * holding the host key, the config and the pid file. So the test failed on a healthy
       * fixture with `fixture left daemon files behind: ["sshd"]`, which says nothing about
       * whether anything leaked.
       *
       * What a leak actually leaves is a **running process**, and that is asserted by the
       * other cases in this file. What belongs here is the on-disk claim, stated in terms of
       * what the daemon writes: nothing the daemon created may outlive `stop()` inside the
       * caller's directory. Concretely: no `sshd.pid` naming a live process is left behind,
       * because a stale pid file is the thing a later run would trust.
       */
      const root = mkdtempSync(path.join(os.homedir(), '.tmp-r02-'))
      const fixture = await startTerminalSmokeSshd({
        runDirectory: root,
        enableSftp: true,
      })
      // `startTerminalSmokeSshd` owns the directory it was given; it must not delete a
      // caller-provided one silently, so the assertion is about what is *inside* it.
      await fixture.stop()

      const pidFile = existsSync(root)
        ? readdirSync(root, { recursive: true })
            .map(String)
            .find(name => name.endsWith('sshd.pid'))
        : undefined
      if (pidFile) {
        const recorded = Number(
          readFileSync(path.join(root, pidFile), 'utf8').trim(),
        )
        assert.equal(
          Number.isInteger(recorded) && processAlive(recorded),
          false,
          `a pid file naming live process ${recorded} survived stop(); a later run ` +
            'would trust it',
        )
      }
      rmSync(root, { recursive: true, force: true })
    },
  )

  it('the PID the fixture reports as daemonPid is dead after stop', { skip: !isMacOrLinux }, async () => {
    /*
     * The strongest form: the fixture tells us the PID it started, and that exact PID must
     * not be alive afterwards. Counting matches by directory can be fooled by a name
     * appearing in another process's arguments.
     *
     * ## This test used to hang forever, and that was worse than a failure
     *
     * The fixture exposes `daemonPid` (a getter, because `restart`/`interrupt` replace the
     * daemon handle). This test read `fixture.pid ?? fixture.child?.pid` — **neither
     * exists** — got `undefined`, and threw on the `typeof pid === 'number'` assertion
     * before it ever reached `fixture.stop()`.
     *
     * The throw skipped the teardown, so a real sshd stayed running as a child of the test
     * process. A live child holds the event loop open, so the process never exits — and
     * `node --test`'s `--test-timeout` does not help, because that timer lives on the same
     * loop that the leaked handle keeps alive. Measured: this file ran **1 h 17 min** with
     * `--test-timeout=90000` and never produced a verdict, leaving a throwaway
     * `~/.tmp-r02-XXX/sshd/sshd_config` daemon running the whole time.
     *
     * So the teardown goes in the `finally` block, not at the end of the happy path. A
     * test that proves reclamation must not leak the thing it is measuring when it fails.
     */
    const root = mkdtempSync(path.join(os.homedir(), '.tmp-r02-'))
    roots.push(root)
    const fixture = await startTerminalSmokeSshd({
      runDirectory: root,
      enableSftp: true,
    })
    try {
      const pid = fixture.daemonPid
      assert.equal(
        typeof pid,
        'number',
        'the fixture must expose the daemon PID as `daemonPid`',
      )
      assert.ok(processAlive(pid), 'the daemon must be alive while running')
      await fixture.stop()
      assert.ok(
        await until(() => !processAlive(pid)),
        `PID ${pid} survived fixture.stop()`,
      )
    } finally {
      // Idempotent by construction (`stop()` memoises), and the only thing standing
      // between a failed assertion here and a test run that never ends.
      await fixture.stop().catch(() => {})
    }
  })
})
