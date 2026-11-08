#!/usr/bin/env node
// Real-server acceptance for `-R` remote port forwarding.
//
// Starts a throwaway OpenSSH sshd on 127.0.0.1 with its own host and user keys
// and `AllowTcpForwarding yes`, then runs the ignored Rust test
// `port_forward::tests::remote_forward_real_ssh_e2e`. The server really binds
// the forwarded port and really opens `forwarded-tcpip` channels; the client is
// the production handler and `setup_remote_forward`.
//
//   node scripts/verify-install/remote-forward-e2e.mjs
//
// Exits 0 only when sshd started, the test passed, and the fixture was removed.

import { execFile, spawn } from 'node:child_process'
import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
    'PermitUserRC no',
    'AllowAgentForwarding no',
    'X11Forwarding no',
    'PermitTunnel no',
    'GatewayPorts no',
    'UseDNS no',
    'PrintMotd no',
    'PrintLastLog no',
    'LogLevel VERBOSE',
    // The subject of the test: real remote port forwarding.
    'AllowTcpForwarding yes',
    'PermitOpen any',
  ].join('\n')
}

async function main() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    console.log('SKIP: the remote-forward fixture only runs on macOS and Linux')
    return 0
  }
  await access(SSHD).catch(() => {
    throw new Error(`missing ${SSHD}`)
  })

  const workDirectory = await mkdtemp(path.join(PROJECT_ROOT, '.tmp-remote-forward-e2e-'))
  const paths = {
    hostKey: path.join(workDirectory, 'host_key'),
    userKey: path.join(workDirectory, 'user_key'),
    authorizedKeys: path.join(workDirectory, 'authorized_keys'),
    config: path.join(workDirectory, 'sshd_config'),
    pid: path.join(workDirectory, 'sshd.pid'),
  }
  let daemon = null
  let exitCode = 1

  try {
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

    if (!(await waitForPort(port, Date.now() + READY_TIMEOUT_MS))) {
      throw new Error(`sshd did not listen on ${port}:\n${diagnostics}`)
    }

    console.log(`sshd listening on 127.0.0.1:${port}; running the Rust acceptance test`)
    const { stdout, stderr } = await execFileAsync(
      'cargo',
      ['test', '--lib', 'real_ssh_e2e', '--', '--ignored', '--nocapture'],
      {
        cwd: path.join(PROJECT_ROOT, 'src-tauri'),
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          SSH_E2E_PORT: String(port),
          SSH_E2E_USER: os.userInfo().username,
          SSH_E2E_KEY: paths.userKey,
          SSH_E2E_HOST_KEY: `${paths.hostKey}.pub`,
        },
      },
    )
    process.stdout.write(stdout)
    if (stderr.trim() !== '') process.stderr.write(stderr)
    exitCode = 0
    console.log('Remote port forwarding: PASS against a real OpenSSH sshd')
  } catch (error) {
    console.error(error.stdout ?? '')
    console.error(error.stderr ?? '')
    console.error(`Remote port forwarding: FAIL — ${error.message}`)
  } finally {
    if (daemon !== null && daemon.exitCode === null) {
      daemon.kill('SIGTERM')
      await new Promise(resolve => globalThis.setTimeout(resolve, 200))
      if (daemon.exitCode === null) daemon.kill('SIGKILL')
    }
    await rm(workDirectory, { recursive: true, force: true })
  }
  return exitCode
}

process.exitCode = await main()
