import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

export const SSHD_READY_MARKER = 'TERMINAL_SMOKE_SSH_READY'
export const SSHD_STOP_GRACE_MS = 3_000

const LOOPBACK = '127.0.0.1'
const SSH = '/usr/bin/ssh'
const SSHD = '/usr/sbin/sshd'
const SSH_KEYGEN = '/usr/bin/ssh-keygen'
const PS = process.platform === 'darwin' ? '/bin/ps' : '/usr/bin/ps'
const COMMAND_TIMEOUT_MS = 10_000
const READY_TIMEOUT_MS = 10_000
const READY_COMMAND = 'terminal-smoke-ready'
const PORT_ATTEMPTS = 4
const CERT_SERIAL = '1'
const CERT_IDENTITY = 'terminal-smoke-cert'

async function reserveLoopbackPort() {
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

const defaultDependencies = {
  chmod,
  mkdir,
  readFile,
  writeFile,
  spawn,
  clearTimeout: globalThis.clearTimeout,
  setTimeout: globalThis.setTimeout,
  now: Date.now,
  listChildProcesses: listDirectChildProcesses,
  platform: process.platform,
  processKill: process.kill.bind(process),
  reservePort: reserveLoopbackPort,
  sleep: milliseconds =>
    new Promise(resolve => globalThis.setTimeout(resolve, milliseconds)),
  userInfo: os.userInfo,
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

async function runProcess(command, args, options, dependencies) {
  let child
  try {
    child = dependencies.spawn(command, args, options)
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
  }, COMMAND_TIMEOUT_MS)
  const status = await waitForClose(child)
  dependencies.clearTimeout(timeout)
  return { ...status, stderr: stderr(), stdout: stdout(), timedOut }
}

async function listDirectChildProcesses(parentPid) {
  const status = await runProcess(
    PS,
    ['-axo', 'pid=,ppid=,pgid='],
    { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
    {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
      spawn,
    },
  )
  if (status.spawnError || status.timedOut || status.code !== 0) {
    throw processFailure('process tree inspection', status)
  }

  const processes = []
  for (const line of status.stdout.split('\n')) {
    if (!line.trim()) continue
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/)
    if (!match) throw new Error('process tree inspection returned invalid data')
    const [, rawPid, rawParentPid, rawProcessGroupId] = match
    if (Number(rawParentPid) !== parentPid) continue
    processes.push({
      pid: Number(rawPid),
      processGroupId: Number(rawProcessGroupId),
    })
  }
  return processes
}

function processFailure(label, status) {
  if (status.spawnError) {
    return new Error(`${label} could not start: ${status.spawnError.message}`)
  }
  if (status.timedOut) return new Error(`${label} timed out`)
  const detail = status.stderr.trim() || status.stdout.trim()
  return new Error(
    `${label} exited with code ${String(status.code)}${detail ? `: ${detail}` : ''}`,
  )
}

async function runChecked(command, args, options, dependencies, label) {
  const status = await runProcess(command, args, options, dependencies)
  if (status.spawnError || status.timedOut || status.code !== 0) {
    throw processFailure(label, status)
  }
}

function startDaemon(configPath, directory, dependencies) {
  let child
  try {
    child = dependencies.spawn(SSHD, ['-D', '-e', '-f', configPath], {
      cwd: directory,
      detached: true,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
  } catch (error) {
    throw new Error(`OpenSSH daemon could not start: ${error.message}`)
  }
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
    throw new Error('OpenSSH daemon did not expose a valid process id')
  }
  const daemon = {
    child,
    closed: false,
    stderr: collectOutput(child.stderr),
  }
  daemon.closePromise = waitForClose(child).then(status => {
    daemon.closed = true
    return status
  })
  return daemon
}

function signalProcessGroup(daemon, signal, dependencies) {
  if (daemon.closed) return
  try {
    dependencies.processKill(-daemon.child.pid, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

async function sessionProcessGroups(daemon, dependencies) {
  const processes = await dependencies.listChildProcesses(daemon.child.pid)
  const groups = new Set()
  for (const process of processes) {
    if (
      !Number.isSafeInteger(process.pid) ||
      process.pid <= 1 ||
      !Number.isSafeInteger(process.processGroupId) ||
      process.processGroupId <= 1
    ) {
      throw new Error('OpenSSH child process metadata is invalid')
    }
    if (process.processGroupId === daemon.child.pid) continue
    if (process.processGroupId !== process.pid) {
      throw new Error('OpenSSH child process is not in an isolated process group')
    }
    groups.add(process.processGroupId)
  }
  return groups
}

function signalSessionProcessGroups(groups, signal, dependencies) {
  for (const processGroupId of groups) {
    try {
      dependencies.processKill(-processGroupId, signal)
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }
}

function closesWithin(daemon, dependencies) {
  if (daemon.closed) return Promise.resolve(true)
  return new Promise(resolve => {
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      dependencies.clearTimeout(timeout)
      resolve(result)
    }
    const timeout = dependencies.setTimeout(
      () => finish(false),
      SSHD_STOP_GRACE_MS,
    )
    daemon.closePromise.then(() => finish(true))
  })
}

async function stopDaemon(daemon, dependencies) {
  if (daemon.closed) return
  const sessionGroups = await sessionProcessGroups(daemon, dependencies)
  signalSessionProcessGroups(sessionGroups, 'SIGTERM', dependencies)
  signalProcessGroup(daemon, 'SIGTERM', dependencies)
  if (await closesWithin(daemon, dependencies)) return
  signalSessionProcessGroups(sessionGroups, 'SIGKILL', dependencies)
  signalProcessGroup(daemon, 'SIGKILL', dependencies)
  await daemon.closePromise
}

function quoteSshdPath(value) {
  if (/[\n\r\0]/.test(value)) {
    throw new Error('terminal smoke paths cannot contain control characters')
  }
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function parsePublicKey(serialized, label) {
  const [kind, body] = serialized.trim().split(/\s+/)
  if (kind !== 'ssh-ed25519' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body ?? '')) {
    throw new Error(`${label} is not an Ed25519 OpenSSH public key`)
  }
  return `${kind} ${body}`
}

function parseCertificate(serialized, label) {
  const [kind, body] = serialized.trim().split(/\s+/)
  if (
    !/^ssh-[^\s]+-cert-v01@openssh\.com$/.test(kind) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(body ?? '')
  ) {
    throw new Error(`${label} is not an OpenSSH certificate`)
  }
  return `${kind} ${body}`
}

async function writeSecure(filePath, contents, mode, dependencies) {
  await dependencies.writeFile(filePath, contents, { encoding: 'utf8', mode })
  await dependencies.chmod(filePath, mode)
}

function daemonConfiguration(paths, port, username, options) {
  const lines = [
    `Port ${port}`,
    `ListenAddress ${LOOPBACK}`,
    `HostKey ${quoteSshdPath(paths.hostKey)}`,
    `PidFile ${quoteSshdPath(paths.pid)}`,
    `AuthorizedKeysFile ${quoteSshdPath(paths.authorizedKeys)}`,
    `AllowUsers ${username}`,
    'PubkeyAuthentication yes',
    'AuthenticationMethods publickey',
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'PermitEmptyPasswords no',
    'PermitRootLogin no',
    'StrictModes yes',
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
  ]
  if (options.mode === 'cert') {
    lines.push(`TrustedUserCAKeys ${quoteSshdPath(paths.caPublicKey)}`)
  }
  if (options.role === 'jump') {
    lines.push(
      'AllowTcpForwarding yes',
      'AllowStreamLocalForwarding no',
      `PermitOpen ${LOOPBACK}:${options.targetPort}`,
      'PermitTTY no',
    )
  } else {
    lines.push(
      'AllowTcpForwarding no',
      'DisableForwarding yes',
      'PermitTTY yes',
    )
  }
  lines.push('')
  return lines.join('\n')
}

function readinessArguments(paths, port, username, mode) {
  const options = [
    'BatchMode=yes',
    'IdentitiesOnly=yes',
    'IdentityAgent=none',
    'PreferredAuthentications=publickey',
    'PasswordAuthentication=no',
    'KbdInteractiveAuthentication=no',
    'StrictHostKeyChecking=yes',
    `UserKnownHostsFile=${paths.knownHosts}`,
    'GlobalKnownHostsFile=/dev/null',
    'ConnectTimeout=2',
  ]
  if (mode === 'cert') {
    options.push(`CertificateFile=${paths.userCertificate}`)
  }
  return [
    '-F',
    '/dev/null',
    '-T',
    ...options.flatMap(option => ['-o', option]),
    '-p',
    String(port),
    '-i',
    paths.userKey,
    `${username}@${LOOPBACK}`,
    READY_COMMAND,
  ]
}

async function waitUntilReady(daemon, paths, port, username, mode, dependencies) {
  const deadline = dependencies.now() + READY_TIMEOUT_MS
  let lastFailure = 'no authentication attempt completed'
  while (dependencies.now() <= deadline) {
    if (daemon.closed) break
    const status = await runProcess(
      SSH,
      readinessArguments(paths, port, username, mode),
      { cwd: paths.directory, shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
      dependencies,
    )
    await Promise.resolve()
    if (
      !daemon.closed &&
      status.code === 0 &&
      status.stdout.trim() === SSHD_READY_MARKER
    ) {
      return
    }
    lastFailure = status.stderr.trim() || status.stdout.trim() || 'no output'
    if (!daemon.closed) await dependencies.sleep(100)
  }
  const daemonDetail = daemon.stderr().trim() || 'no daemon output'
  throw new Error(
    `OpenSSH readiness probe failed: ${lastFailure} (daemon: ${daemonDetail})`,
  )
}

function fixturePaths(runDirectory) {
  const directory = path.join(runDirectory, 'sshd')
  const inDirectory = name => path.join(directory, name)
  return {
    directory,
    authorizedKeys: inDirectory('authorized_keys'),
    caKey: inDirectory('ca_key'),
    caPublicKey: inDirectory('ca_key.pub'),
    config: inDirectory('sshd_config'),
    connection: inDirectory('connection.json'),
    home: inDirectory('home'),
    hostKey: inDirectory('host_key'),
    knownHosts: inDirectory('known_hosts'),
    pid: inDirectory('sshd.pid'),
    userCertificate: inDirectory('user_key-cert.pub'),
    userKey: inDirectory('user_key'),
    wrapper: inDirectory('forced-command.sh'),
  }
}

async function prepareFixture(paths, mode, dependencies) {
  await dependencies.mkdir(paths.directory, { recursive: true, mode: 0o700 })
  await dependencies.mkdir(paths.home, { recursive: true, mode: 0o700 })
  await dependencies.chmod(paths.directory, 0o700)
  await dependencies.chmod(paths.home, 0o700)
  const options = {
    cwd: paths.directory,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  }
  for (const [keyPath, comment] of [
    [paths.hostKey, 'terminal-smoke-host'],
    [paths.userKey, 'terminal-smoke-user'],
  ]) {
    const args = ['-q', '-t', 'ed25519', '-N', '', '-C', comment, '-f', keyPath]
    await runChecked(
      SSH_KEYGEN,
      args,
      options,
      dependencies,
      `ssh-keygen (${comment})`,
    )
    await dependencies.chmod(keyPath, 0o600)
  }
  if (mode === 'cert') {
    await runChecked(
      SSH_KEYGEN,
      ['-q', '-t', 'ed25519', '-N', '', '-C', 'terminal-smoke-ca', '-f', paths.caKey],
      options,
      dependencies,
      `ssh-keygen (certificate authority)`,
    )
    await dependencies.chmod(paths.caKey, 0o600)
  }
  return options
}

async function signUserCertificate(
  paths,
  username,
  forcedCommand,
  dependencies,
) {
  const options = {
    cwd: paths.directory,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  }
  // macOS sshd does not apply authorized_keys `command=` options to
  // certificate authentication, so the isolation policy is embedded in the
  // certificate itself: clear every default permission, keep PTY, force the
  // isolated wrapper, and bind the certificate to the loopback source.
  await runChecked(
    SSH_KEYGEN,
    [
      '-q',
      '-s',
      paths.caKey,
      '-I',
      CERT_IDENTITY,
      '-n',
      username,
      '-z',
      CERT_SERIAL,
      '-V',
      '-1m:+15m',
      '-O',
      'clear',
      '-O',
      'permit-pty',
      '-O',
      `force-command="${forcedCommand}"`,
      '-O',
      `source-address=${LOOPBACK}`,
      `${paths.userKey}.pub`,
    ],
    options,
    dependencies,
    'ssh-keygen (certificate signing)',
  )
  await dependencies.chmod(paths.userCertificate, 0o600)
}

export async function startTerminalSmokeSshd({
  runDirectory,
  mode = 'key',
  role = 'target',
  targetPort,
  connectionExtra = {},
  dependencies: overrides = {},
}) {
  const dependencies = { ...defaultDependencies, ...overrides }
  if (dependencies.platform !== 'darwin' && dependencies.platform !== 'linux') {
    throw new Error('Terminal smoke OpenSSH is only supported on macOS and Linux')
  }
  if (mode !== 'key' && mode !== 'cert') {
    throw new Error(`terminal smoke SSH mode must be key or cert, got ${mode}`)
  }
  if (role !== 'target' && role !== 'jump') {
    throw new Error(
      `terminal smoke SSH role must be target or jump, got ${role}`,
    )
  }
  if (role === 'jump') {
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65_535) {
      throw new Error('terminal smoke jump hosts require a target port')
    }
  }
  if (typeof runDirectory !== 'string' || !path.isAbsolute(runDirectory)) {
    throw new Error('terminal smoke runDirectory must be absolute')
  }
  const username = dependencies.userInfo().username
  if (!/^(?!-)[A-Za-z0-9._-]{1,255}$/.test(username)) {
    throw new Error('terminal smoke username is invalid')
  }

  const paths = fixturePaths(runDirectory)
  const commandOptions = await prepareFixture(paths, mode, dependencies)
  const privateKey = await dependencies.readFile(paths.userKey, 'utf8')
  const userPublicKey = parsePublicKey(
    await dependencies.readFile(`${paths.userKey}.pub`, 'utf8'),
    'terminal smoke user key',
  )
  const expectedHostKey = parsePublicKey(
    await dependencies.readFile(`${paths.hostKey}.pub`, 'utf8'),
    'terminal smoke host key',
  )
  const home = `'${paths.home.replaceAll("'", `'"'"'`)}'`
  const wrapper = `#!/bin/sh\nset -eu\nif [ "\${SSH_ORIGINAL_COMMAND:-}" = "${READY_COMMAND}" ]; then\n  printf '%s\\n' '${SSHD_READY_MARKER}'\n  exit 0\nfi\nexec /usr/bin/env -i HOME=${home} PATH=/usr/bin:/bin TERM="\${TERM:-xterm-256color}" LANG=en_US.UTF-8 LC_CTYPE=en_US.UTF-8 /bin/sh\n`
  await writeSecure(paths.wrapper, wrapper, 0o700, dependencies)
  const forcedCommand = paths.wrapper
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
  if (mode === 'cert') {
    await signUserCertificate(paths, username, forcedCommand, dependencies)
  }
  const authorizedOptions =
    role === 'jump'
      ? `from="${LOOPBACK}",command="${forcedCommand}",no-agent-forwarding,no-X11-forwarding,no-pty`
      : `restrict,pty,from="${LOOPBACK}",command="${forcedCommand}"`
  await writeSecure(
    paths.authorizedKeys,
    `${authorizedOptions} ${userPublicKey}\n`,
    0o600,
    dependencies,
  )

  let daemon
  let port
  try {
    for (let attempt = 1; attempt <= PORT_ATTEMPTS; attempt += 1) {
      port = await dependencies.reservePort()
      if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
        throw new Error('port reservation returned an invalid high port')
      }
      const config = daemonConfiguration(paths, port, username, {
        mode,
        role,
        targetPort,
      })
      await writeSecure(paths.config, config, 0o600, dependencies)
      await writeSecure(
        paths.knownHosts,
        `[${LOOPBACK}]:${port} ${expectedHostKey}\n`,
        0o600,
        dependencies,
      )
      await runChecked(
        SSHD,
        ['-t', '-f', paths.config],
        commandOptions,
        dependencies,
        'OpenSSH configuration validation',
      )
      daemon = startDaemon(paths.config, paths.directory, dependencies)
      try {
        await waitUntilReady(daemon, paths, port, username, mode, dependencies)
        break
      } catch (error) {
        await stopDaemon(daemon, dependencies)
        const conflict = /address already in use/i.test(
          `${error.message}\n${daemon.stderr()}`,
        )
        if (attempt < PORT_ATTEMPTS && conflict) continue
        throw error
      }
    }

    const certificate =
      mode === 'cert'
        ? parseCertificate(
            await dependencies.readFile(paths.userCertificate, 'utf8'),
            'terminal smoke user certificate',
          )
        : null
    const connection = {
      host: LOOPBACK,
      port,
      username,
      authMode: mode === 'cert' ? 'cert' : 'key',
      expectedHostKey,
      privateKey,
      password: null,
      certificate,
      jump: null,
      ...connectionExtra,
    }
    await writeSecure(
      paths.connection,
      `${JSON.stringify(connection)}\n`,
      0o600,
      dependencies,
    )
    let restartPromise
    let stopPromise
    return {
      ...connection,
      configPath: paths.connection,
      /** Raw client identity, unaffected by connectionExtra overrides. */
      identityKey: privateKey,
      restart: () => {
        if (restartPromise) return restartPromise
        restartPromise = (async () => {
          await stopDaemon(daemon, dependencies)
          daemon = startDaemon(paths.config, paths.directory, dependencies)
          try {
            await waitUntilReady(daemon, paths, port, username, mode, dependencies)
          } catch (error) {
            await stopDaemon(daemon, dependencies)
            throw error
          }
        })()
        return restartPromise
      },
      stop: () =>
        (stopPromise ??= (async () => {
          if (restartPromise) await restartPromise.catch(() => {})
          await stopDaemon(daemon, dependencies)
        })()),
    }
  } catch (error) {
    if (daemon !== undefined) await stopDaemon(daemon, dependencies)
    throw error
  }
}
