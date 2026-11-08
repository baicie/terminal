#!/usr/bin/env node
// Real-server acceptance for the staged SFTP upload.
//
// Starts a throwaway OpenSSH sshd on 127.0.0.1 with its own host key, its own
// user key and `Subsystem sftp internal-sftp`, then runs the ignored Rust test
// `sftp_upload::tests::real_sftp_server_acceptance` against it. Nothing here is
// a mock: the transport is a real TCP SSH session and the server is OpenSSH.
//
//   node scripts/verify-install/sftp-staged-upload-e2e.mjs
//
// Exits 0 only when sshd started, the test passed, and the fixture was removed.

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
    daemon = spawn(SSHD, ['-D', '-e', '-f', paths.config], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let diagnostics = ''
    daemon.stdout.setEncoding('utf8')
    daemon.stderr.setEncoding('utf8')
    daemon.stdout.on('data', chunk => (diagnostics += chunk))
    daemon.stderr.on('data', chunk => (diagnostics += chunk))
    const spawned = new Promise((resolve, reject) => {
      daemon.once('error', reject)
      daemon.once('exit', code => resolve({ code }))
    })

    const ready = await waitForPort(port, Date.now() + READY_TIMEOUT_MS)
    if (!ready) {
      throw new Error(`sshd did not listen on ${port}:\n${diagnostics}`)
    }

    console.log(`sshd listening on 127.0.0.1:${port}; running the Rust acceptance test`)
    const { stdout, stderr } = await execFileAsync(
      'cargo',
      ['test', '--lib', 'real_sftp_server_acceptance', '--', '--ignored', '--nocapture'],
      {
        cwd: path.join(PROJECT_ROOT, 'src-tauri'),
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          SFTP_E2E_PORT: String(port),
          SFTP_E2E_USER: os.userInfo().username,
          SFTP_E2E_KEY: paths.userKey,
          SFTP_E2E_DIR: remoteDirectory,
        },
      },
    )
    process.stdout.write(stdout)
    if (stderr.trim() !== '') process.stderr.write(stderr)

    exitCode = 0
    console.log('SFTP staged upload: PASS against real OpenSSH sftp-server')
  } catch (error) {
    console.error(error.stdout ?? '')
    console.error(error.stderr ?? '')
    console.error(`SFTP staged upload: FAIL — ${error.message}`)
  } finally {
    if (daemon !== null && daemon.exitCode === null) {
      daemon.kill('SIGTERM')
      await new Promise(resolve => globalThis.setTimeout(resolve, 200))
      if (daemon.exitCode === null) daemon.kill('SIGKILL')
    }
    // A scenario makes one fixture directory read-only on purpose; restore the
    // permissions so the fixture can be removed.
    await execFileAsync('/bin/chmod', ['-R', 'u+rwX', workDirectory]).catch(() => {})
    await rm(workDirectory, { recursive: true, force: true })
  }
  return exitCode
}

process.exitCode = await main()
