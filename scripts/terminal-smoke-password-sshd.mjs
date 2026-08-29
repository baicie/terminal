import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import path from 'node:path'
import process from 'node:process'

/**
 * Isolated password-authentication OpenSSH fixture.
 *
 * Password verification without PAM needs a real system account, so this
 * fixture runs stock Debian OpenSSH inside an ephemeral Docker container.
 * The container image is built once per host and reused through the layer
 * cache; every run uses a fresh, disposable container with a loopback-only
 * port mapping.
 */

export const PASSWORD_SSHD_READY_TIMEOUT_MS = 30_000
export const PASSWORD_SSHD_BUILD_TIMEOUT_MS = 240_000

const LOOPBACK = '127.0.0.1'
const DOCKER = 'docker'
const CONTAINER_PORT = 22
const CONTAINER_USER = 'smokepass'
const CONTAINER_PASSWORD = 'terminal-smoke-password'
const IMAGE_NAME = 'terminal-smoke-password-sshd:latest'
const HOST_KEY_PATH = '/etc/ssh/ssh_host_ed25519_key.pub'

const DOCKERFILE = `FROM debian:bookworm-slim
RUN apt-get update \\
 && apt-get install -y --no-install-recommends openssh-server \\
 && rm -rf /var/lib/apt/lists/* \\
 && mkdir -p /run/sshd \\
 && ssh-keygen -A \\
 && useradd -m -s /bin/sh ${CONTAINER_USER} \\
 && echo '${CONTAINER_USER}:${CONTAINER_PASSWORD}' | chpasswd
COPY sshd_config /etc/ssh/sshd_config
COPY terminal-smoke-shell.sh /usr/local/bin/terminal-smoke-shell.sh
COPY entrypoint.sh /usr/local/bin/terminal-smoke-entrypoint.sh
RUN chmod 755 /usr/local/bin/terminal-smoke-shell.sh /usr/local/bin/terminal-smoke-entrypoint.sh
EXPOSE ${CONTAINER_PORT}
ENTRYPOINT ["/usr/local/bin/terminal-smoke-entrypoint.sh"]
`

const SSHD_CONFIG = `Port ${CONTAINER_PORT}
ListenAddress 0.0.0.0
HostKey /etc/ssh/ssh_host_ed25519_key
PermitRootLogin no
AllowUsers ${CONTAINER_USER}
AuthenticationMethods password
PasswordAuthentication yes
KbdInteractiveAuthentication no
PubkeyAuthentication no
PermitEmptyPasswords no
UsePAM no
PermitTTY yes
ForceCommand /usr/local/bin/terminal-smoke-shell.sh
AllowTcpForwarding no
AllowAgentForwarding no
AllowStreamLocalForwarding no
X11Forwarding no
PermitUserRC no
PrintMotd no
PrintLastLog no
UseDNS no
LogLevel VERBOSE
`

const SHELL_WRAPPER = `#!/bin/sh
set -eu
exec /usr/bin/env -i HOME=/home/${CONTAINER_USER} PATH=/usr/bin:/bin TERM="\${TERM:-xterm-256color}" LANG=C.UTF-8 LC_CTYPE=C.UTF-8 /bin/sh
`

const ENTRYPOINT = `#!/bin/sh
set -eu
chmod 755 /usr/local/bin/terminal-smoke-shell.sh
exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config
`

const defaultDependencies = {
  mkdir,
  now: Date.now,
  platform: process.platform,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  sleep: milliseconds =>
    new Promise(resolve => globalThis.setTimeout(resolve, milliseconds)),
  spawn,
  writeFile,
}

function collectOutput(stream) {
  let output = ''
  stream?.setEncoding('utf8')
  stream?.on('data', chunk => (output += chunk))
  return () => output
}

function waitForClose(child) {
  return new Promise(resolve => {
    let settled = false
    const finish = status => {
      if (!settled) resolve(status)
      settled = true
    }
    child.once('error', spawnError => finish({ spawnError }))
    child.once('close', (code, signal) =>
      finish({ code, signal, spawnError: null }),
    )
  })
}

async function runDocker(args, options, dependencies, timeoutMs, label) {
  let child
  try {
    child = dependencies.spawn(DOCKER, args, options)
  } catch (spawnError) {
    return { code: null, signal: null, spawnError, stderr: '', stdout: '' }
  }
  const stdout = collectOutput(child.stdout)
  const stderr = collectOutput(child.stderr)
  let timedOut = false
  const timeout = dependencies.setTimeout(() => {
    timedOut = true
    try {
      child.kill('SIGKILL')
    } catch {
      // The command closed between the timer and signal.
    }
  }, timeoutMs)
  const status = await waitForClose(child)
  dependencies.clearTimeout(timeout)
  const result = { ...status, stderr: stderr(), stdout: stdout(), timedOut }
  if (result.spawnError || result.timedOut || result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    throw new Error(
      result.spawnError
        ? `${label} could not start: ${result.spawnError.message}`
        : result.timedOut
          ? `${label} timed out after ${timeoutMs} ms`
          : `${label} exited with code ${String(result.code)}${detail ? `: ${detail}` : ''}`,
    )
  }
  return result
}

function probeSshBanner(port, dependencies) {
  return new Promise((resolve, reject) => {
    let settled = false
    let banner = ''
    const socket = connect({ host: LOOPBACK, port }, () => {})
    const finish = (error, value) => {
      if (settled) return
      settled = true
      dependencies.clearTimeout(timeout)
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }
    const timeout = dependencies.setTimeout(() => {
      finish(new Error('password SSH daemon banner timeout'))
    }, 1_000)
    socket.on('data', chunk => {
      banner += chunk.toString('utf8')
      if (banner.startsWith('SSH-2.0-OpenSSH')) finish(null, true)
    })
    socket.on('error', error => finish(error))
    socket.on('close', () =>
      finish(
        banner.startsWith('SSH-2.0-OpenSSH')
          ? null
          : new Error('password SSH daemon closed before presenting a banner'),
        banner.startsWith('SSH-2.0-OpenSSH'),
      ),
    )
  })
}

async function waitUntilReady(containerName, port, dependencies) {
  const deadline = dependencies.now() + PASSWORD_SSHD_READY_TIMEOUT_MS
  let lastFailure = 'no banner probe completed'
  while (dependencies.now() <= deadline) {
    try {
      if (await probeSshBanner(port, dependencies)) return
    } catch (error) {
      lastFailure = error.message
    }
    try {
      const status = await runDocker(
        ['inspect', '--format', '{{.State.Running}}', containerName],
        { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
        dependencies,
        10_000,
        'docker inspect',
      )
      if (status.stdout.trim() !== 'true') {
        throw new Error('password SSH container is not running')
      }
    } catch (error) {
      if (/not running/i.test(error.message)) throw error
    }
    await dependencies.sleep(100)
  }
  throw new Error(`password OpenSSH readiness probe failed: ${lastFailure}`)
}

async function reserveLoopbackPort(dependencies) {
  const { createServer } = await import('node:net')
  const server = createServer()
  server.unref()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: LOOPBACK, port: 0, exclusive: true }, () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('failed to reserve a numeric loopback port'))
        return
      }
      server.close(error => (error ? reject(error) : resolve(address.port)))
    })
  })
}

function containerName(runDirectory) {
  const suffix = path.basename(runDirectory).slice(0, 32).replace(/[^A-Za-z0-9_.-]/g, '-')
  return `terminal-smoke-password-${suffix}`
}

export async function startTerminalSmokePasswordSshd({
  runDirectory,
  dependencies: overrides = {},
}) {
  const dependencies = { ...defaultDependencies, ...overrides }
  if (dependencies.platform !== 'darwin' && dependencies.platform !== 'linux') {
    throw new Error('Terminal smoke password OpenSSH is only supported on macOS and Linux')
  }
  if (typeof runDirectory !== 'string' || !path.isAbsolute(runDirectory)) {
    throw new Error('terminal smoke runDirectory must be absolute')
  }
  const directory = path.join(runDirectory, 'password-sshd')
  await dependencies.mkdir(directory, { recursive: true })
  await dependencies.writeFile(path.join(directory, 'Dockerfile'), DOCKERFILE, {
    encoding: 'utf8',
  })
  await dependencies.writeFile(path.join(directory, 'sshd_config'), SSHD_CONFIG, {
    encoding: 'utf8',
  })
  await dependencies.writeFile(
    path.join(directory, 'terminal-smoke-shell.sh'),
    SHELL_WRAPPER,
    { encoding: 'utf8' },
  )
  await dependencies.writeFile(
    path.join(directory, 'entrypoint.sh'),
    ENTRYPOINT,
    { encoding: 'utf8' },
  )

  await runDocker(
    ['build', '--quiet', '-t', IMAGE_NAME, directory],
    { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
    dependencies,
    PASSWORD_SSHD_BUILD_TIMEOUT_MS,
    'password OpenSSH image build',
  )

  const name = containerName(runDirectory)
  let port
  let started = false
  try {
    port = await reserveLoopbackPort(dependencies)
    if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
      throw new Error('port reservation returned an invalid high port')
    }
    await runDocker(
      [
        'run',
        '--detach',
        '--rm',
        '--name',
        name,
        '-p',
        `${LOOPBACK}:${port}:${CONTAINER_PORT}`,
        IMAGE_NAME,
      ],
      { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
      dependencies,
      60_000,
      'password OpenSSH container start',
    )
    started = true
    await waitUntilReady(name, port, dependencies)

    const hostKey = await runDocker(
      ['exec', name, 'cat', HOST_KEY_PATH],
      { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
      dependencies,
      10_000,
      'password OpenSSH host key read',
    )
    const expectedHostKey = hostKey.stdout.trim().split(/\s+/).slice(0, 2).join(' ')
    if (!/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(expectedHostKey)) {
      throw new Error('password OpenSSH host key is invalid')
    }

    const connection = {
      host: LOOPBACK,
      port,
      username: CONTAINER_USER,
      authMode: 'password',
      expectedHostKey,
      privateKey: null,
      password: CONTAINER_PASSWORD,
      certificate: null,
      jump: null,
    }
    const configPath = path.join(directory, 'connection.json')
    await dependencies.writeFile(configPath, `${JSON.stringify(connection)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })

    let restartPromise
    let stopPromise
    return {
      ...connection,
      configPath,
      restart: () => {
        if (restartPromise) return restartPromise
        restartPromise = (async () => {
          await runDocker(
            ['restart', name],
            { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
            dependencies,
            30_000,
            'password OpenSSH container restart',
          )
          await waitUntilReady(name, port, dependencies)
        })()
        return restartPromise
      },
      stop: () =>
        (stopPromise ??= (async () => {
          if (restartPromise) await restartPromise.catch(() => {})
          try {
            await runDocker(
              ['rm', '--force', name],
              { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
              dependencies,
              30_000,
              'password OpenSSH container cleanup',
            )
          } catch (error) {
            if (!/No such container/i.test(error.message)) throw error
          }
        })()),
    }
  } catch (error) {
    if (started) {
      try {
        await runDocker(
          ['rm', '--force', name],
          { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
          dependencies,
          30_000,
          'password OpenSSH container cleanup',
        )
      } catch {
        // The original failure is more useful than a cleanup failure.
      }
    }
    throw error
  }
}
