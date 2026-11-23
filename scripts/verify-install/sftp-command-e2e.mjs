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
    if (process.env.T16_SHAPING) {
      const { startShapingProxy, SHAPING_SCENARIOS } = await import('../sftp-shaping-proxy.mjs')
      const shaping = SHAPING_SCENARIOS[process.env.T16_SHAPING]
      if (!shaping) {
        throw new Error(
          `unknown T16_SHAPING "${process.env.T16_SHAPING}"; known: ` +
            Object.keys(SHAPING_SCENARIOS).join(', '),
        )
      }
      proxy = await startShapingProxy({ targetPort: port, ...shaping })
      proxyPort = proxy.port
      console.log(
        `shaping "${process.env.T16_SHAPING}" on 127.0.0.1:${proxyPort}: ` +
          JSON.stringify(shaping),
      )
    }

    const { stdout, stderr } = await execFileAsync(
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
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          SFTP_E2E_PORT: String(proxyPort),
          SFTP_E2E_USER: os.userInfo().username,
          SFTP_E2E_KEY: paths.userKey,
          SFTP_E2E_DIR: remoteDirectory,
        },
      },
    )
    process.stdout.write(stdout)
    if (stderr.trim() !== '') process.stderr.write(stderr)

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
    console.error(`SFTP command-level: FAIL — ${error.message}`)
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
