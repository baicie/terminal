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
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SSHD = '/usr/sbin/sshd'
const SSH_KEYGEN = '/usr/bin/ssh-keygen'

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
 * `app_config_dir()` on macOS is `~/Library/Application Support/<identifier>`, and the
 * harness already points HOME at a temp directory.
 */
function databasePath(home) {
  const identifier = 'com.baicie.termius'
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', identifier, 'terminal.db')
  }
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', identifier, 'terminal.db')
  }
  return path.join(home, '.config', identifier, 'terminal.db')
}

export async function seedSftpHost({ home, privateKeyPath, port, username, label }) {
  const dbPath = databasePath(home)
  await mkdir(path.dirname(dbPath), { recursive: true })

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
        'e2e-sftp-host',
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

async function sshdConfig({ port, paths, username }) {
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
    `AllowUsers ${username}`,
    'Subsystem sftp internal-sftp',
    'LogLevel ERROR',
  ].join('\n')
  return `${text}\n`
}

/**
 * Start a throwaway sshd and seed a host row pointing at it.
 *
 * Returns the pieces a caller needs to stop it again.
 */
export async function startSeededSshd({ home, label = 'E2E Local' }) {
  const workDirectory = await mkdtemp(path.join(os.tmpdir(), 'terminal-gui-sftp-'))
  await chmod(workDirectory, 0o700)
  const paths = {
    hostKey: path.join(workDirectory, 'host_key'),
    userKey: path.join(workDirectory, 'user_key'),
    authorizedKeys: path.join(workDirectory, 'authorized_keys'),
    pidFile: path.join(workDirectory, 'sshd.pid'),
    config: path.join(workDirectory, 'sshd_config'),
  }

  await execFileAsync(SSH_KEYGEN, ['-q', '-t', 'ed25519', '-N', '', '-f', paths.hostKey])
  await execFileAsync(SSH_KEYGEN, ['-q', '-t', 'ed25519', '-N', '', '-f', paths.userKey])
  await chmod(paths.userKey, 0o600)
  const publicKey = (await readFile(`${paths.userKey}.pub`, 'utf8')).trim()
  await writeFile(paths.authorizedKeys, `${publicKey}\n`, { mode: 0o600 })

  const port = await reservePort()
  const username = os.userInfo().username
  await writeFile(paths.config, await sshdConfig({ port, paths, username }), {
    mode: 0o600,
  })

  // sshd requires an absolute config path and refuses a world-writable directory.
  const daemon = spawn(SSHD, ['-D', '-e', '-f', paths.config], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let diagnostics = ''
  daemon.stdout.setEncoding('utf8')
  daemon.stderr.setEncoding('utf8')
  daemon.stdout.on('data', chunk => (diagnostics += chunk))
  daemon.stderr.on('data', chunk => (diagnostics += chunk))

  const ready = await waitForPort(port, Date.now() + 15_000)
  if (!ready) {
    daemon.kill('SIGKILL')
    throw new Error(`sshd did not listen on ${port}:\n${diagnostics}`)
  }

  const databaseFile = await seedSftpHost({
    home,
    privateKeyPath: paths.userKey,
    port,
    username,
    label,
  })

  return {
    port,
    username,
    databaseFile,
    async stop() {
      if (daemon.exitCode === null) {
        daemon.kill('SIGTERM')
        await new Promise(resolve => globalThis.setTimeout(resolve, 200))
        if (daemon.exitCode === null) daemon.kill('SIGKILL')
      }
    },
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
