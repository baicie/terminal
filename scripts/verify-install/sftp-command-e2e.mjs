#!/usr/bin/env node
// Command-level SFTP acceptance: the production Rust upload and download paths
// against a real OpenSSH server.
//
// Starts a throwaway sshd on 127.0.0.1 with its own host key, its own user key and
// `Subsystem sftp internal-sftp`, then runs the ignored tests in
// `src/sftp_command_e2e_tests.rs`.
//
//   node scripts/verify-install/sftp-command-e2e.mjs
//
// ## What layer this proves
//
// `staged_upload` and `receive_download` are the functions the `#[tauri::command]`
// handlers call. Running them here proves those implementations work against a real
// server at 24 MiB. It does **not** prove the Tauri command wrappers or any GUI —
// that needs a running app, and is a different suite.
//
// Compare with `sftp-roundtrip-live.e2e.test.ts`, which drives `/usr/bin/sftp`: that
// proves OpenSSH can move the bytes, and nothing about this project's code.
//
// Exits 0 only when sshd started, every ignored test passed, and the fixture was
// removed.

import { execFile } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { connect, createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { launchProcess, stopProcess } from './process-lifecycle.mjs'

const execFileAsync = promisify(execFile)
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..')
const SSHD = '/usr/sbin/sshd'
const SSH_KEYGEN = '/usr/bin/ssh-keygen'
const READY_TIMEOUT_MS = 15_000
const READY_POLL_MS = 100

/**
 * Wait for a launched child to exit, or tear its whole process group down at `timeoutMs`.
 *
 * Returns the outcome instead of throwing: the caller decides how a timeout is classified,
 * and one place doing that classification is the point (see the catch in `main`).
 *
 * The teardown path is `stopProcess`, which signals the **group** when the child leads one,
 * waits for a real `exit`, escalates to SIGKILL, and waits again. A plain `child.kill()` is
 * not enough here — `cargo test` runs the test binary as a grandchild, and orphaned
 * grandchildren keep the inherited pipes open (measured; see the call site).
 */
async function waitForTests(child, timeoutMs) {
  const exited = await Promise.race([
    child.lifecycle.exitPromise.then(() => 'exited'),
    new Promise(resolve => setTimeout(() => resolve('timeout'), timeoutMs)),
  ])
  if (exited === 'timeout') {
    /*
     * Signal the **group**. `detached: true` makes the cargo process its own group leader,
     * so `kill(-pid)` reaches the test binary cargo forked. Killing cargo alone orphans that
     * binary to init (PPID 1) — it keeps running and, worse, keeps the inherited stdout
     * pipe open. Proven in this session: `execFile`'s `timeout` + `killSignal: 'SIGKILL'`
     * left a `sleep 300` grandchild alive with PPID 1.
     */
    const pid = child.pid
    if (pid) {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        // The group is already gone; the per-process stop below still runs.
      }
    }
    await stopProcess(child, { waitMs: 5_000, killWaitMs: 5_000 })
    return {
      timedOut: true,
      code: null,
      stdout: child.lifecycle.output.join(''),
      stderr: '',
    }
  }
  // Real exit observed: give `close` a moment for the pipes to drain, but never wait on it
  // as proof of exit — that was the R02 defect.
  await Promise.race([
    child.lifecycle.closePromise,
    new Promise(resolve => setTimeout(resolve, 2_000)),
  ])
  /*
   * ## Destroying the pipes is what lets this process exit
   *
   * Measured: the first version of this function returned here without touching the
   * streams, and the harness printed `PASS` and then **never exited** — the raw pipe handles
   * stay referenced even after the child is gone, and `process.exitCode` does not force an
   * exit while a handle is alive. `execFile` destroys them internally; `launchProcess` hands
   * the streams to the caller, so the caller owns that duty.
   *
   * The exit did not come from `detached` (removing it changed nothing) and not from the
   * timeout (a minimal `execFile` + `timeout` change exited in 30 s). It came from here.
   */
  child.stdout?.destroy()
  child.stderr?.destroy()
  return {
    timedOut: false,
    code: child.lifecycle.exitCode,
    // stdout and stderr are interleaved on purpose: `launchProcess` pushes both into one
    // array so ordering is preserved, and libtest writes its `test result:` lines to
    // stdout while panic output goes to stderr. Splitting them would reorder the evidence.
    stdout: child.lifecycle.output.join(''),
    stderr: '',
  }
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('could not reserve a loopback port'))
        return
      }
      server.close(error => (error ? reject(error) : resolve(address.port)))
    })
  })
}

async function generateKey(file) {
  await execFileAsync(SSH_KEYGEN, ['-q', '-t', 'ed25519', '-N', '', '-f', file])
  await chmod(file, 0o600)
}

function canConnect(port) {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port })
    const finish = reachable => {
      socket.destroy()
      resolve(reachable)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(500, () => finish(false))
  })
}

async function waitForPort(port, deadline) {
  while (Date.now() < deadline) {
    if (await canConnect(port)) return true
    await new Promise(resolve => globalThis.setTimeout(resolve, READY_POLL_MS))
  }
  return false
}

function sshdConfig({ port, paths, username }) {
  return [
    `Port ${port}`,
    'ListenAddress 127.0.0.1',
    `HostKey "${paths.hostKey}"`,
    `PidFile "${paths.pid}"`,
    `AuthorizedKeysFile "${paths.authorizedKeys}"`,
    `AllowUsers ${username}`,
    'PubkeyAuthentication yes',
    'AuthenticationMethods publickey',
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'PermitEmptyPasswords no',
    'PermitRootLogin no',
    // The fixture home lives under the repository's .tmp directory; its mode is
    // already 0700, so StrictModes adds nothing here.
    'StrictModes no',
    'UsePAM no',
    'PermitUserRC no',
    'AllowAgentForwarding no',
    'X11Forwarding no',
    'PermitTunnel no',
    'GatewayPorts no',
    'UseDNS no',
    'PrintMotd no',
    'PrintLastLog no',
    'LogLevel VERBOSE',
    // The subject of the test: a real SFTP subsystem.
    'Subsystem sftp internal-sftp',
  ].join('\n')
}

async function main() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    console.log('SKIP: the SFTP acceptance fixture only runs on macOS and Linux')
    return 0
  }
  await access(SSHD).catch(() => {
    throw new Error(`missing ${SSHD}`)
  })

  const workDirectory = await mkdtemp(path.join(PROJECT_ROOT, '.tmp-sftp-e2e-'))
  const paths = {
    hostKey: path.join(workDirectory, 'host_key'),
    userKey: path.join(workDirectory, 'user_key'),
    authorizedKeys: path.join(workDirectory, 'authorized_keys'),
    config: path.join(workDirectory, 'sshd_config'),
    pid: path.join(workDirectory, 'sshd.pid'),
  }
  const remoteDirectory = path.join(workDirectory, 'remote')
  let daemon = null
  let exitCode = 1

  try {
    await mkdir(remoteDirectory, { recursive: true, mode: 0o700 })
    await generateKey(paths.hostKey)
    await generateKey(paths.userKey)
    await writeFile(paths.authorizedKeys, await readFile(`${paths.userKey}.pub`, 'utf8'), {
      mode: 0o600,
    })

    const port = await reservePort()
    await writeFile(
      paths.config,
      sshdConfig({ port, paths, username: os.userInfo().username }),
      { mode: 0o600 },
    )
    /*
     * ## `detached: true`, and a stop that is checked
     *
     * `sshd -D` forks a session child for every accepted connection. Killing only the
     * daemon leaves those children reparented to init: measured on this machine, **103**
     * `sshd -D -e -f …` parents with PPID 1 accumulated across runs, each still holding a
     * config path into a directory that no longer existed.
     *
     * `detached: true` makes the daemon the leader of its own process group, so one signal
     * reaches everything it forked. `stopProcess` then does the part the old hand-written
     * cleanup did not: SIGTERM, wait for a **real** exit, SIGKILL, wait again, and report
     * `timeout` rather than claiming success for a process that would not die.
     */
    daemon = launchProcess(SSHD, ['-D', '-e', '-f', paths.config], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    let diagnostics = ''
    const child = daemon
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', chunk => (diagnostics += chunk))
    child.stderr?.on('data', chunk => (diagnostics += chunk))
    const spawned = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', code => resolve({ code }))
    })

    const ready = await waitForPort(port, Date.now() + READY_TIMEOUT_MS)
    if (!ready) {
      throw new Error(`sshd did not listen on ${port}:\n${diagnostics}`)
    }

    console.log(`sshd listening on 127.0.0.1:${port}; running the command-level tests`)

    /*
     * ## Optional shaping proxy
     *
     * `T16_SHAPING` names a scenario in `sftp-shaping-proxy.mjs`'s vocabulary
     * (`slow-upload`, `cut-upload`, …). When set, the tests connect through a user-space
     * proxy that adds delay/rate limits or resets the connection, so the product's
     * behaviour on a bad link is exercised against the **same** real sshd.
     *
     * The fixture's own port stays private to this process; only the proxy's port is
     * exported to the tests. A reader can therefore tell "shaped" from "direct" by which
     * port the tests were given.
     */
    let proxyPort = port
    let proxy = null
    /*
     * Which tests this scenario is expected to break, and why.
     *
     * Kept next to the scenario rather than inside `SHAPING_SCENARIOS`: the proxy module
     * models a *link*, and which of our tests depend on the link surviving is a property of
     * the tests. Two lists that must stay in sync with two different files is exactly how a
     * "known failure" becomes an unnoticed one.
     *
     * Every entry states the mechanism, so a reader can check the claim rather than trust it.
     */
    const SHAPING_EXPECTATIONS = {
      'cut-upload': {
        expectedFailures: [
          'uploads_24_mib_through_the_production_upload_path',
          'downloads_24_mib_through_the_production_download_path',
        ],
        // The download test seeds its 24 MiB remote file *through the upload path*, so a
        // dead uplink breaks it too. Only 24 MiB transfers cross the 4 MiB cut; every other
        // test moves at most 3 MiB and must still pass.
        note: 'the uplink dies at 4 MiB, so every 24 MiB transfer must fail',
      },
      'cut-download': {
        expectedFailures: [
          'uploads_24_mib_through_the_production_upload_path',
          'downloads_24_mib_through_the_production_download_path',
        ],
        note: 'the downlink dies at 4 MiB, so every 24 MiB transfer must fail',
      },
    }
    let scenarioExpectation = null
    if (process.env.T16_SHAPING) {
      const { startShapingProxy, SHAPING_SCENARIOS } = await import('../sftp-shaping-proxy.mjs')
      const shaping = SHAPING_SCENARIOS[process.env.T16_SHAPING]
      if (!shaping) {
        throw new Error(
          `unknown T16_SHAPING "${process.env.T16_SHAPING}"; known: ` +
            Object.keys(SHAPING_SCENARIOS).join(', '),
        )
      }
      scenarioExpectation = SHAPING_EXPECTATIONS[process.env.T16_SHAPING] ?? {
        expectedFailures: [],
        note: 'no failures declared for this scenario',
      }
      proxy = await startShapingProxy({ targetPort: port, ...shaping })
      proxyPort = proxy.port
      console.log(
        `shaping "${process.env.T16_SHAPING}" on 127.0.0.1:${proxyPort}: ` +
          JSON.stringify(shaping) +
          `\n  expected failures: ${scenarioExpectation.expectedFailures.join(', ') || '(none)'}` +
          `\n  reason: ${scenarioExpectation.note}`,
      )
    }

    /*
     * ## Why this is not `execFileAsync` with a `timeout`
     *
     * Measured (R03): `execFile` with `timeout: 90_000, killSignal: 'SIGKILL'` did end the
     * wait at 90 s — and left the **grandchild** alive. `cargo test` runs the test binary as
     * its own child; killing cargo by PID orphans that binary to init (PPID 1), and because
     * it inherited cargo's stdout/stderr pipes, the harness's own `close` never fired. The
     * process hung again, this time *after* the "bounded" step had reported.
     *
     * This is the same lesson as R02's sshd leak, in a different place: **a deadline that
     * only reaches the direct child is not a deadline.** So the child gets its own process
     * group (`detached`), the deadline signals the group, and the wait is on real exit
     * events rather than on pipe closure.
     */
    const testTimeoutMs = Number(process.env.SFTP_E2E_TIMEOUT_MS ?? 600_000)
    const cargo = launchProcess(
      'cargo',
      [
        'test',
        '--lib',
        'sftp_command_e2e_tests',
        '--',
        '--ignored',
        '--nocapture',
        '--test-threads=1',
      ],
      {
        cwd: path.join(PROJECT_ROOT, 'src-tauri'),
        detached: true,
        env: {
          ...process.env,
          SFTP_E2E_PORT: String(proxyPort),
          SFTP_E2E_USER: os.userInfo().username,
          SFTP_E2E_KEY: paths.userKey,
          SFTP_E2E_DIR: remoteDirectory,
        },
      },
    )
    const cargoResult = await waitForTests(cargo, testTimeoutMs)
    const stdout = cargoResult.stdout
    process.stdout.write(stdout)
    if (cargoResult.stderr.trim() !== '') process.stderr.write(cargoResult.stderr)
    if (cargoResult.timedOut) {
      /*
       * A shape that produced **no verdict** is a harness failure, not a network result.
       * Reported through the same catch path as any other failure so there is one place
       * that decides the classification and one place that sets the exit code.
       */
      const timeoutError = new Error(
        `the command-level tests produced no verdict within ${testTimeoutMs} ms`,
      )
      timeoutError.signal = 'SIGKILL'
      timeoutError.killed = true
      timeoutError.stdout = stdout
      timeoutError.stderr = cargoResult.stderr
      throw timeoutError
    }
    if (cargoResult.code !== 0) {
      /*
       * ## A shaped run makes some tests *supposed* to fail
       *
       * Measured with `T16_SHAPING=cut-download`: 6 passed, 2 failed in 33 s. The two
       * failures are `uploads_24_mib…` and `downloads_24_mib…` — and the scenario resets
       * the **downlink** after 4 MiB. A 24 MiB transfer over a link that dies at 4 MiB
       * *cannot* succeed; `expect("download 24 MiB")` panicking is the correct outcome, not
       * a defect. Counting it as `TEST_FAILURE` would make every shaped run red and hide
       * the one thing the run exists to measure.
       *
       * So each scenario declares which tests it expects to fail, and this is the check:
       * the failing set must be **exactly** what the scenario predicts. Anything else —
       * a test that fails when it was not predicted, or one that passes when it should not
       * have — is a real failure.
       *
       * An unshaped run declares nothing, so any failure is a failure (the CI path).
       */
      const failedNames = [...stdout.matchAll(/^    (sftp_command_e2e_tests::\S+)$/gm)]
        .map(match => match[1].split('::').pop())
      const expected = scenarioExpectation?.expectedFailures ?? []
      const unexpected = failedNames.filter(name => !expected.includes(name))
      const missing = expected.filter(name => !failedNames.includes(name))
      if (scenarioExpectation && unexpected.length === 0 && missing.length === 0) {
        exitCode = 0
        console.log(
          `SFTP command-level: EXPECTED_NETWORK_FAILURE (by design for ` +
            `"${process.env.T16_SHAPING}"): ${failedNames.join(', ')} failed because the ` +
            `link was cut; every other test passed`,
        )
      } else {
        const failed = new Error(
          `cargo test exited with code ${String(cargoResult.code)}` +
            (scenarioExpectation
              ? `; unexpected failures: [${unexpected.join(', ')}]` +
                `; expected but passed: [${missing.join(', ')}]`
              : ''),
        )
        failed.stdout = stdout
        failed.stderr = cargoResult.stderr
        throw failed
      }
    }

    // ## Machine-readable counts for the aggregated test report
    //
    // The runner already prints libtest's `test result:` lines; writing them to a file
    // is what lets `aggregate-test-report.mjs` count this layer instead of reporting it
    // NOT_RUN. `SFTP_E2E_REPORT` is set by CI; when unset the step still passes, it just
    // does not contribute a report.
    if (process.env.SFTP_E2E_REPORT) {
      const { writeFileSync, mkdirSync } = await import('node:fs')
      const path = await import('node:path')
      const target = path.resolve(process.env.SFTP_E2E_REPORT)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, stdout)
      console.log(`sftp command-level report written to ${target}`)
    }

    exitCode = 0
    console.log('SFTP command-level: PASS against real OpenSSH sftp-server')
  } catch (error) {
    console.error(error.stdout ?? '')
    console.error(error.stderr ?? '')
    /*
     * ## `TEST_INFRA_FAILURE` must not be counted as a network result
     *
     * R03 asks for the two to be distinguishable. Before this, a hung harness, a fixture
     * that never started, and "the product correctly reported an error after the RST" all
     * produced the same single word: FAIL. Two of those are test bugs and one is the
     * behaviour under test working correctly.
     *
     * The signal available here is `killed`/`signal`: libtest never reports those, so the
     * process did not produce a verdict of its own. Every other failure comes from libtest
     * and carries a real test result.
     */
    const infraFailure =
      error.killed === true ||
      error.signal != null ||
      error.code === 'ETIMEDOUT' ||
      /did not exit|timed out/i.test(error.message ?? '')
    const kind = infraFailure ? 'TEST_INFRA_FAILURE' : 'TEST_FAILURE'
    exitCode = infraFailure ? 2 : 1
    console.error(
      `SFTP command-level: ${kind} — ${error.message}` +
        (infraFailure
          ? `\n  The tests did not produce a verdict (signal=${error.signal ?? 'none'}).` +
            ` This says nothing about the product's behaviour on a dead link; the harness` +
            ` was bounded at ${process.env.SFTP_E2E_TIMEOUT_MS ?? 600_000} ms.`
          : ''),
    )
  } finally {
    if (typeof proxy !== 'undefined' && proxy) await proxy.close()
    if (daemon !== null) {
      /*
       * Signal the **process group**, not just the daemon.
       *
       * With `detached: true` the daemon's PID is also its PGID, so `kill(-pid)` reaches
       * the session children it forked. `stopProcess` already escalates and waits; what it
       * cannot know is that signalling the group is what this caller needs, so the group
       * signal is sent first and the per-process stop is kept as the checked backstop.
       */
      const pid = daemon.pid
      if (pid) {
        try {
          process.kill(-pid, 'SIGTERM')
        } catch {
          // The group is already gone, or the platform has no process groups; the
          // per-process stop below still runs.
        }
      }
      const stopped = await stopProcess(daemon)
      if (stopped.outcome === 'timeout') {
        // Not a silent pass: a daemon that survives SIGKILL means the next run will bind a
        // port something else still holds.
        console.error(
          `SFTP fixture: sshd ${stopped.pid} did not exit after SIGKILL — ` +
            `run \`ps -p ${stopped.pid}\` before the next attempt`,
        )
        exitCode = 1
      }
    }
    // A scenario makes one fixture directory read-only on purpose; restore the
    // permissions so the fixture can be removed.
    await execFileAsync('/bin/chmod', ['-R', 'u+rwX', workDirectory]).catch(() => {})
    await rm(workDirectory, { recursive: true, force: true })
  }
  return exitCode
}

process.exitCode = await main()

/*
 * ## Why an explicit exit
 *
 * `main()` above has already proven every child is gone: the test child goes through
 * `stopProcess` (real `exit`, SIGKILL escalation, a second wait) and sshd through
 * `stopProcess` with its group signalled first. `process.exitCode` alone was not enough —
 * measured, the process printed `PASS` and then stayed alive indefinitely while
 * `process._getActiveHandles()` reported **only stdin**, and an async-hooks probe found
 * `main` had returned with 4 live promise resources. Something retains a handle whose
 * origin this harness cannot see from the outside.
 *
 * Calling `process.exit(exitCode)` here does not hide a live child: a surviving process
 * would still be reported by the `stopped.outcome === 'timeout'` branch above, which sets
 * a non-zero exit. What it removes is a way for the harness to hang *after* it has already
 * decided the result — the exact failure shape this task exists to eliminate.
 *
 * Bounded, one line, and after all cleanup: there is no work left that an implicit exit
 * would have run.
 */
process.exit(process.exitCode ?? 0)
