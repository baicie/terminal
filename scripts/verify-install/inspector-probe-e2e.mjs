#!/usr/bin/env node
// Inspector probe acceptance: the exact command strings the frontend sends, executed
// against a real OpenSSH server.
//
// Starts a throwaway sshd on 127.0.0.1 with its own host key and user key, then runs
// the ignored tests in `src-tauri/src/inspector_probe_e2e_tests.rs`.
//
//   node scripts/verify-install/inspector-probe-e2e.mjs
//
// ## What layer this proves
//
// The probe is a shell command string produced by `server-inspector.ts`. What the
// product depends on at this layer is that a real sshd runs those exact strings on a
// separate exec channel and returns parseable output. This proves that, and nothing
// about the Tauri command wrapper, the React panel, or whether an interactive shell
// stayed unpolluted — those need a running app and a real window.
//
// ## Why the command strings are duplicated here
//
// The Rust side spells them out rather than importing the TypeScript. A test that read
// the product's string would keep passing while the two drifted apart; a literal that
// stops matching is a signal worth having.
//
// Exits 0 only when sshd started, every ignored test passed, and the fixture was
// removed.

import { execFile, spawn } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { connect, createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

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
    'StrictModes no',
    'UsePAM no',
    // Without this, a user rc file could print to the exec channel and corrupt the
    // probe output being parsed.
    'PermitUserRC no',
    'AllowAgentForwarding no',
    'X11Forwarding no',
    'PermitTunnel no',
    'GatewayPorts no',
    'UseDNS no',
    'PrintMotd no',
    'PrintLastLog no',
    'LogLevel VERBOSE',
  ].join('\n')
}

async function main() {
  for (const binary of [SSHD, SSH_KEYGEN]) {
    try {
      await access(binary)
    } catch {
      console.error(`${binary} is not available; the Inspector probe suite needs OpenSSH`)
      process.exit(1)
    }
  }

  // The fixture lives under $HOME: Linux runners mount /tmp in a way that trips
  // StrictModes, which is recorded in the SFTP fixture for the same reason.
  const root = await mkdtemp(path.join(os.homedir(), '.terminal-inspector-e2e-'))
  const username = os.userInfo().username
  const paths = {
    hostKey: path.join(root, 'host_ed25519'),
    userKey: path.join(root, 'user_ed25519'),
    authorizedKeys: path.join(root, 'authorized_keys'),
    pid: path.join(root, 'sshd.pid'),
    config: path.join(root, 'sshd_config'),
  }
  let sshd = null

  try {
    await generateKey(paths.hostKey)
    await generateKey(paths.userKey)
    const publicKey = await readFile(`${paths.userKey}.pub`, 'utf8')
    await writeFile(paths.authorizedKeys, publicKey, { mode: 0o600 })
    await mkdir(path.join(root, 'empty'), { recursive: true })

    const port = await reservePort()
    await writeFile(
      paths.config,
      sshdConfig({ port, paths, username }),
      { mode: 0o600 },
    )

    sshd = spawn(SSHD, ['-D', '-e', '-f', paths.config], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let sshdLog = ''
    sshd.stderr?.on('data', chunk => {
      sshdLog += chunk.toString()
      // Surfaced live with INSPECTOR_E2E_SSHD_LOG: a startup failure and an
      // authentication failure look identical from the client side.
      if (process.env.INSPECTOR_E2E_SSHD_LOG) process.stderr.write(chunk)
    })

    const ready = await waitForPort(port, Date.now() + READY_TIMEOUT_MS)
    if (!ready) {
      console.error('sshd did not start listening; log:\n' + sshdLog)
      process.exit(1)
    }

    console.log(`sshd listening on 127.0.0.1:${port}; running the Inspector probe tests`)
    await execFileAsync(
      'cargo',
      [
        'test',
        '--manifest-path',
        path.join(PROJECT_ROOT, 'src-tauri', 'Cargo.toml'),
        '--lib',
        '--',
        '--ignored',
        'inspector_probe_e2e_tests',
      ],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          INSPECTOR_E2E_PORT: String(port),
          INSPECTOR_E2E_USER: username,
          INSPECTOR_E2E_KEY: paths.userKey,
        },
        stdio: 'inherit',
      },
    )
    console.log('Inspector probe acceptance: PASS against a real OpenSSH server')
  } finally {
    if (sshd && sshd.exitCode === null) {
      sshd.kill('SIGTERM')
      await new Promise(resolve => {
        sshd.once('exit', resolve)
        globalThis.setTimeout(resolve, 2_000)
      })
    }
    await rm(root, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
