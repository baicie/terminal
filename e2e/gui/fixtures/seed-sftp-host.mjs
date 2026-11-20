#!/usr/bin/env node
// Seed a real SSH host into the GUI E2E profile, so the dock can be exercised
// against a live connection instead of its empty state (issue #58).
//
// ## Why this exists
//
// `e2e-03-sftp-dock.e2e.mjs` could only verify the dock's *width* without a host —
// with no connection it renders `sftp.noActiveSession`, and the single-pane rule,
// the content-box threshold, the pane switch and the keyboard behaviour all came
// back NOT_RUN. Those are the claims `COMPACT_DOCK_USABLE` and `HOST_SWITCH_SAFE`
// were marked PARTIAL for.
//
// This script starts a throwaway sshd, writes a host row into the throwaway
// profile's SQLite database, and prints the coordinates the spec needs. The app is
// then launched (by the harness) with that profile, and the dock has something real
// to list.
//
// ## Why the database, not the UI
//
// Adding a host through the UI would test the host dialog as a side effect and make
// the dock spec depend on it. Writing the row directly keeps the spec about the dock.
// The schema is the app's own (`connection-schema-core.ts`), so a mismatch surfaces
// as a failing spec rather than a silent empty list.

import { execFile, spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { connect, createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Every sshd this module has started and not yet seen exit.
 *
 * The cleanup hook below is why this exists: without it, a cancelled CI job or a
 * Ctrl-C leaves a listening daemon behind with `ppid=1`, and on a long-lived machine
 * they accumulate (measured: five, the oldest a day old). Registered here rather than
 * in the harness because the harness is not the only caller — a probe script that
 * imports `startSeededSshd` gets the same protection.
 */
const liveDaemons = new Set()

/** Stop everything still running. Idempotent; safe to call from any path. */
function reapAllDaemons() {
  for (const daemon of liveDaemons) {
    try {
      if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill('SIGKILL')
    } catch {
      // A daemon that is already gone throws ESRCH; nothing to do.
    }
  }
  liveDaemons.clear()
}

/*
 * ## Why SIGKILL and not a graceful stop on the way out
 *
 * There is nothing to flush: these servers have no state beyond the throwaway profile
 * they were pointed at, and the profile is deleted separately. What matters is that
 * the process is *gone*, because a listener holding a reserved port is what makes the
 * next run flaky. `stop()` still does SIGTERM→SIGKILL for the orderly path.
 *
 * `beforeExit` covers the normal end of a script that forgot to call `stop()`; the
 * signals cover the two ways a developer or CI actually interrupts one.
 */
process.once('beforeExit', reapAllDaemons)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  // Re-raise so the process still dies with the signal it was sent — a hook that
  // swallows SIGINT would make Ctrl-C stop working.
  process.once(signal, () => {
    reapAllDaemons()
    process.kill(process.pid, signal)
  })
}

/**
 * Where the OpenSSH tools live, per platform.
 *
 * The Unix paths were hard-coded, so on Windows the first attempt was
 * `spawn /usr/bin/ssh-keygen ENOENT` — measured on the Windows runner, reported as
 * "no SSH fixture" and every remote-directory case silently recorded NOT_RUN.
 *
 * Windows ships `ssh.exe` and `ssh-keygen.exe` in `System32\OpenSSH`, but **not**
 * `sshd.exe`: the OpenSSH *server* is an optional feature. So the keys can be
 * generated there and the daemon still cannot start, which is a different answer from
 * "the tools are missing" and has to be reported as such rather than guessed at.
 */
const OPENSSH_DIRS =
  process.platform === 'win32'
    ? [
        path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'OpenSSH'),
        'C:\\Program Files\\OpenSSH-Win64',
      ]
    : ['/usr/bin', '/usr/sbin', '/usr/local/bin', '/usr/local/sbin', '/opt/homebrew/bin']

/** First existing executable among `names`, searched in the platform's OpenSSH dirs. */
async function findExecutable(names) {
  const { access, constants } = await import('node:fs/promises')
  for (const directory of OPENSSH_DIRS) {
    for (const name of names) {
      const candidate = path.join(directory, name)
      try {
        await access(candidate, constants.X_OK)
        return candidate
      } catch {
        // Not here; keep looking. The absence of every candidate is reported by the
        // caller with the list it tried.
      }
    }
  }
  return null
}

/**
 * `node:sqlite` was added in Node 22.5 but stayed behind `--experimental-sqlite`
 * until Node 23, and `.node-version` pins 24. A static import made the whole module
 * fail to load on an older runtime, so `run-gui-e2e.mjs` could not even reach its
 * "no sshd here" branch — measured on Node 22.12 as
 * `No such built-in module: node:sqlite`, with the fixture reported as unavailable
 * and every remote-directory case silently recording NOT_RUN.
 *
 * Importing lazily turns that into a message a reader can act on, and keeps the
 * already-working paths (ssh-keygen, sshd, port reservation) independent of it.
 */
async function sqlite() {
  try {
    return await import('node:sqlite')
  } catch (error) {
    throw new Error(
      'the SSH fixture needs `node:sqlite` to write the host row. Node >= 24 has it; ' +
        'on 22.5–22.x run with `NODE_OPTIONS=--experimental-sqlite`. ' +
        `Original error: ${error.message}`,
    )
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

async function waitForPort(port, deadline) {
  while (Date.now() < deadline) {
    const reachable = await new Promise(resolve => {
      const socket = connect({ host: '127.0.0.1', port })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        socket.destroy()
        resolve(false)
      })
    })
    if (reachable) return true
    await new Promise(resolve => globalThis.setTimeout(resolve, 100))
  }
  return false
}

/**
 * Where the app puts its database inside the throwaway profile.
 *
 * ## Read the override first; the per-platform guesses are a fallback
 *
 * `TERMINAL_GUI_E2E_CONFIG_DIR` is what the app itself resolves when built with the
 * `gui-e2e` feature, so using it here makes the two sides agree **by construction**
 * rather than by two independent guesses that happen to match.
 *
 * That distinction is not academic. The per-platform paths below are correct on macOS
 * (`$HOME/Library/Application Support`) and Linux (`$XDG_CONFIG_HOME`), but **Windows
 * ignores them**: `dirs::config_dir()` calls `SHGetKnownFolderPath`, not `APPDATA`. The
 * seeded database landed in the temp profile and the app looked in the real one, so the
 * startup gate refused to mount the UI.
 */
function databasePath(home) {
  const identifier = 'com.baicie.termius'
  if (process.env.TERMINAL_GUI_E2E_CONFIG_DIR) {
    return path.join(process.env.TERMINAL_GUI_E2E_CONFIG_DIR, 'terminal.db')
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', identifier, 'terminal.db')
  }
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', identifier, 'terminal.db')
  }
  return path.join(home, '.config', identifier, 'terminal.db')
}

/**
 * Write this sshd's host key into a profile's `known_hosts`.
 *
 * ## Why the fixture has to do this
 *
 * The app verifies host keys against `~/.ssh/known_hosts` and refuses an unknown one —
 * correct behaviour, and the reason every SFTP case recorded NOT_RUN rather than a
 * false PASS: the connection failed with `host key verification failed … key not found
 * in known_hosts`, which the dock rendered as an empty directory.
 *
 * Trusting the throwaway key here is the fixture's job. It is scoped to a throwaway
 * `HOME`, so nothing outside the test profile learns this key.
 */
export async function trustHostKey({ home, hostKeyPath, port, hostname = '127.0.0.1' }) {
  const keygen = await findExecutable(['ssh-keygen', 'ssh-keygen.exe'])
  if (!keygen) throw new Error('ssh-keygen is required to trust the fixture host key')
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  // `ssh-keygen -y` prints the public key in `known_hosts` form.
  const { stdout } = await run(keygen, ['-y', '-f', hostKeyPath])
  const publicKey = stdout.trim()
  const sshDir = path.join(home, '.ssh')
  await mkdir(sshDir, { recursive: true, mode: 0o700 })
  const knownHosts = path.join(sshDir, 'known_hosts')
  // Non-default port is bracketed, which is how OpenSSH and russh both spell it.
  const hostField = port === 22 ? hostname : `[${hostname}]:${port}`
  const existing = await readFile(knownHosts, 'utf8').catch(() => '')
  if (existing.includes(publicKey)) return knownHosts
  await writeFile(knownHosts, `${existing}${hostField} ${publicKey}\n`, { mode: 0o600 })
  return knownHosts
}

export async function seedSftpHost({
  home,
  configDir,
  privateKeyPath,
  port,
  username,
  label,
  hostId = 'e2e-sftp-host',
}) {
  // `configDir` lets one sshd serve several per-spec profiles: each spec gets its own
  // throwaway home, so the row has to be written into each one. Without it the seeded
  // database only lands in the parent's profile and every spec sees an empty host list.
  const dbPath = configDir
    ? path.join(configDir, 'terminal.db')
    : databasePath(home)
  await mkdir(path.dirname(dbPath), { recursive: true })

  const { DatabaseSync } = await sqlite()
  const database = new DatabaseSync(dbPath)
  try {
    // The app creates the schema on first launch; if it has not run yet, create just
    // enough of it for the row to land. `credential_ref` is included because later
    // migrations add it — a table without it makes the app's own SELECT fail, and the
    // symptom is an empty host list rather than an error.
    database.exec(`CREATE TABLE IF NOT EXISTS hosts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, hostname TEXT NOT NULL,
      port INTEGER DEFAULT 22, username TEXT NOT NULL,
      auth_type TEXT DEFAULT 'password', password TEXT, private_key TEXT,
      certificate TEXT, credential_ref TEXT, group_id TEXT, is_favorite INTEGER DEFAULT 0,
      color TEXT, tags TEXT, port_forwards TEXT, startup_command TEXT,
      environment TEXT, jump_host_id TEXT, jump_host_auth_type TEXT,
      agent_forwarding INTEGER DEFAULT 0, shell_integration TEXT DEFAULT 'off',
      identity_file_path TEXT, created_at INTEGER, updated_at INTEGER
    )`)

    const privateKey = await readFile(privateKeyPath, 'utf8')
    const now = Date.now()
    database
      .prepare(
        `INSERT OR REPLACE INTO hosts
         (id, name, hostname, port, username, auth_type, private_key, is_favorite,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'key', ?, 1, ?, ?)`,
      )
      .run(
        hostId,
        label,
        '127.0.0.1',
        port,
        username,
        privateKey,
        now,
        now,
      )
  } finally {
    database.close()
  }
  return dbPath
}

async function sshdConfig({ port, paths, username, chroot, sftpStart }) {
  const text = [
    `Port ${port}`,
    'ListenAddress 127.0.0.1',
    `HostKey ${paths.hostKey}`,
    `PidFile ${paths.pidFile}`,
    `AuthorizedKeysFile ${paths.authorizedKeys}`,
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'PubkeyAuthentication yes',
    'PermitRootLogin no',
    'UsePAM no',
    'StrictModes no',
    /*
     * ## Why `-d`
     *
     * Both fixtures run as the same OS account, so without this every server resolves
     * `.` to the same `$HOME` and both panes render byte-identical rows. The two-host
     * case then cannot distinguish "the panel followed the tab" from "the panel never
     * moved" — measured: its binding assertion compared two connections listing the
     * same directory, which is precisely the wrong-binding failure it exists to catch.
     *
     * `-d` gives each server its own start directory, so the rows really differ.
     */
    `Subsystem sftp internal-sftp${sftpStart ? ` -d ${sftpStart}` : ''}`,
    'LogLevel ERROR',
  ]
  /*
   * ## Why there is no `ChrootDirectory` here
   *
   * Confining the session to a throwaway directory is the right goal — the fixture runs
   * as the developer's own account, so an unconfined SFTP pane lists their real `$HOME`
   * (44 entries on the machine this was written on), and a spec that uploads, renames
   * or deletes would act on real files.
   *
   * `ChrootDirectory` cannot do it: OpenSSH requires the chroot path to be owned by
   * root and not group/world writable, which a per-user sshd started as an ordinary
   * account cannot arrange. `ForceCommand internal-sftp` alone does not confine
   * either — it only refuses shell commands.
   *
   * So containment is the caller's job: `startSeededSshd` creates a private directory
   * and hands it to the specs as `remoteRoot`, and every write in a spec is relative to
   * it. The alternative (running sshd as root) is worse than the risk it removes.
   *
   * ## What "containment is the caller's job" actually means
   *
   * It is a **convention the specs follow**, not a bound the server enforces. The
   * product's `sftp_delete` / `sftp_rename` / `sftp_mkdir` reject only an empty path
   * (`src-tauri/src/sftp.rs`) and pass the string to the server, which is correct —
   * the remote server's own permissions are the authority on what a user may touch.
   * The fixture's sshd runs as the developer's account, so a spec that named
   * `/Users/<dev>/Documents` would really delete from there.
   *
   * `sftpStart` below narrows this in practice: the pane opens in `remoteRoot` and a
   * spec reaches a file through the listing, so a path outside it takes a deliberate
   * `..` or an absolute path in spec code. That is a real reduction in the blast
   * radius but **not a guarantee**, and no test can prove a negative about the next
   * spec someone writes. The two rules that follow from it:
   *
   *   * every write names a path under `GUI_E2E_REMOTE_ROOT`;
   *   * a spec that needs to prove a write happened reads it back **through the same
   *     root**, so a wrong path fails loudly instead of succeeding elsewhere.
   */
  text.push(`AllowUsers ${username}`)
  return `${text.join('\n')}\n`
}

/**
 * Start a throwaway sshd and seed a host row pointing at it.
 *
 * Returns the pieces a caller needs to stop it again.
 */
export async function startSeededSshd({
  home,
  label = 'E2E Local',
  /**
   * Whether to write a host row pointing at this server.
   *
   * A second server exists so a spec can hold two connections; it must not also write
   * a second row, because `INSERT OR REPLACE` on the fixed id would replace the first
   * one and leave the suite with one host again.
   */
  seedRow = true,
  /** Row id and name for a second host; the default keeps the original single row. */
  hostId = 'e2e-sftp-host',
} = {}) {
  // Resolve the tools before doing anything else, and name what is missing. On
  // Windows the *client* tools exist but `sshd.exe` is an optional feature, so this
  // check is what separates "this platform cannot host the fixture" from "the
  // fixture is broken" — and the message is what the runner records.
  const keygen = await findExecutable(['ssh-keygen', 'ssh-keygen.exe'])
  if (!keygen) {
    throw new Error(
      `ssh-keygen was not found in ${OPENSSH_DIRS.join(', ')}. The SSH fixture needs ` +
        'it to mint a throwaway host key and user key.',
    )
  }
  const sshd = await findExecutable(['sshd', 'sshd.exe'])
  if (!sshd) {
    throw new Error(
      `sshd was not found in ${OPENSSH_DIRS.join(', ')}. ` +
        (process.platform === 'win32'
          ? 'Windows ships the OpenSSH client but the server is an optional feature ' +
            '(Settings → Optional Features → OpenSSH Server); without it this ' +
            'platform cannot run the SSH-backed cases.'
          : 'Install the OpenSSH server package.'),
    )
  }

  const workDirectory = await mkdtemp(path.join(os.tmpdir(), 'terminal-gui-sftp-'))
  await chmod(workDirectory, 0o700)
  /*
   * Where a spec is allowed to write.
   *
   * The sshd runs as the developer's account, so the pane can reach their real `$HOME`.
   * Every upload, rename and delete in a spec must name a path under this directory —
   * that is what makes "the bytes arrived" checkable without touching user data.
   *
   * Created here rather than by the spec so the path is reported once, in the fixture's
   * return value, instead of each spec inventing its own.
   */
  const remoteRoot = path.join(workDirectory, 'remote')
  await mkdir(remoteRoot, { recursive: true, mode: 0o700 })
  /*
   * A marker file per server, so "these are different directories" is checkable by
   * content rather than by a path string the spec would have to trust.
   *
   * Named after the label because that is what the spec already matches on, and a
   * reader comparing two listings can see which server produced which.
   */
  await writeFile(path.join(remoteRoot, `${label.replace(/\s+/g, '-').toLowerCase()}.marker`), `${label}\n`, {
    mode: 0o600,
  })
  const paths = {
    hostKey: path.join(workDirectory, 'host_key'),
    userKey: path.join(workDirectory, 'user_key'),
    authorizedKeys: path.join(workDirectory, 'authorized_keys'),
    pidFile: path.join(workDirectory, 'sshd.pid'),
    config: path.join(workDirectory, 'sshd_config'),
  }

  await execFileAsync(keygen, ['-q', '-t', 'ed25519', '-N', '', '-f', paths.hostKey])
  await execFileAsync(keygen, ['-q', '-t', 'ed25519', '-N', '', '-f', paths.userKey])
  await chmod(paths.userKey, 0o600)
  const publicKey = (await readFile(`${paths.userKey}.pub`, 'utf8')).trim()
  await writeFile(paths.authorizedKeys, `${publicKey}\n`, { mode: 0o600 })

  const port = await reservePort()
  const username = os.userInfo().username
  await writeFile(
    paths.config,
    await sshdConfig({ port, paths, username, sftpStart: remoteRoot }),
    { mode: 0o600 },
  )

  // sshd requires an absolute config path and refuses a world-writable directory.
  const daemon = spawn(sshd, ['-D', '-e', '-f', paths.config], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  /*
   * ## Why the daemon is registered for death, not only stopped politely
   *
   * Measured on a developer machine: five `sshd -D -e -f …terminal-gui-sftp-XXXX/sshd_config`
   * processes still listening, the oldest from the previous evening. Every one had
   * `ppid=1` — the harness that spawned it was gone.
   *
   * `stop()` is only called on the happy path (`run-gui-e2e.mjs:347`). A cancelled CI
   * job, a Ctrl-C during a long spec, or any thrown error between `startSeededSshd`
   * and that line leaves the server running for as long as the machine is up. That is
   * both a port leak (the reserved port stays bound, so the next run's `reservePort`
   * can pick one that a stale daemon is about to answer on) and, on a shared runner,
   * a process nobody owns.
   *
   * The registry below makes cleanup independent of the caller remembering: an exit
   * hook and the three fatal signals all stop every live daemon. `stop()` stays as the
   * explicit path and is idempotent, so both can run without a double kill.
   */
  liveDaemons.add(daemon)
  const stop = async () => {
    liveDaemons.delete(daemon)
    if (daemon.exitCode !== null || daemon.signalCode !== null) return
    daemon.kill('SIGTERM')
    await new Promise(resolve => globalThis.setTimeout(resolve, 200))
    if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill('SIGKILL')
  }

  let diagnostics = ''
  daemon.stdout.setEncoding('utf8')
  daemon.stderr.setEncoding('utf8')
  daemon.stdout.on('data', chunk => (diagnostics += chunk))
  daemon.stderr.on('data', chunk => (diagnostics += chunk))

  const ready = await waitForPort(port, Date.now() + 15_000)
  if (!ready) {
    await stop()
    throw new Error(`sshd did not listen on ${port}:\n${diagnostics}`)
  }

  const databaseFile = seedRow
    ? await seedSftpHost({
        home,
        privateKeyPath: paths.userKey,
        port,
        username,
        label,
        hostId,
      })
    : null
  // The app refuses an unknown host key, which is correct; the fixture's job is to make
  // its throwaway key known inside the throwaway profile.
  const knownHostsFile = await trustHostKey({ home, hostKeyPath: paths.hostKey, port })

  return {
    port,
    username,
    databaseFile,
    knownHostsFile,
    hostKeyPath: paths.hostKey,
    /** The only directory a spec may write to over SFTP. */
    remoteRoot,
    /** The row of `remoteRoot` the server opens at; the spec reads the same path. */
    sftpStart: remoteRoot,
    // Needed to seed additional per-spec profiles against this same sshd.
    userKeyPath: paths.userKey,
    stop,
  }
}

// Allow running this file directly to check the fixture on its own.
if (process.argv[1] && process.argv[1].endsWith('seed-sftp-host.mjs')) {
  const home = process.env.GUI_E2E_HOME
  if (!home) {
    console.error('set GUI_E2E_HOME to a throwaway profile')
    process.exit(1)
  }
  const fixture = await startSeededSshd({ home })
  console.log(JSON.stringify({ port: fixture.port, database: fixture.databaseFile }))
  await fixture.stop()
}
