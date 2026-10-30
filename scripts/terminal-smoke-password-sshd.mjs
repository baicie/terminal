import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

/**
 * Isolated password-authentication OpenSSH fixture.
 *
 * Password verification without PAM needs a real system account, so this
 * fixture ships two interchangeable backends selected by
 * `TERMINAL_SMOKE_PASSWORD_BACKEND` (`auto` | `docker` | `native`):
 *
 * - `docker` runs stock Debian OpenSSH inside an ephemeral container. The
 *   image is built once per host and reused through the layer cache; every run
 *   uses a fresh, disposable container with a loopback-only port mapping.
 * - `native` (macOS only, no Docker) creates a throwaway system account with
 *   `sysadminctl`, generates a fixture host key and starts the stock
 *   `/usr/sbin/sshd` against a generated config, every privileged step under
 *   `sudo -n`.
 *
 * `auto` keeps Docker wherever a daemon answers, and falls back to `native`
 * on a Docker-less macOS host — exactly the GitHub-hosted macOS runner.
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
  env: process.env,
  // Fixture diagnostics go to stdout, which the workflow captures with
  // `2>&1 | tee`: an sshd that refuses a login has to explain itself in the
  // evidence log, not only in an exception the runner consumes.
  log: line => process.stdout.write(line + '\n'),
  mkdir,
  now: Date.now,
  platform: process.platform,
  processKill: process.kill.bind(process),
  readFile,
  rm,
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
    // A killed `docker build` can leave BuildKit grandchildren holding the
    // stdio pipes open, in which case `close` never arrives and only `exit`
    // does. Waiting on `close` alone made the whole matrix hang forever after
    // a build timeout, so `exit` is treated as terminal as well.
    child.once('exit', (code, signal) => finish({ code, signal, spawnError: null }))
    child.once('close', (code, signal) =>
      finish({ code, signal, spawnError: null }),
    )
  })
}

export async function runDockerCommand(args, options, dependencies, timeoutMs, label) {
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

const runDocker = runDockerCommand

/**
 * Ensures the isolated password OpenSSH image exists locally.
 *
 * `docker build` always re-resolves `FROM debian:bookworm-slim`, so on a host
 * that cannot reach the registry the build fails even though a perfectly good
 * image is already sitting in the local cache. Inspecting first keeps password
 * acceptance runnable offline, which is exactly when it is most useful.
 */
export async function ensurePasswordSshdImage(contextDirectory, dependencies) {
  try {
    await runDocker(
      ['image', 'inspect', IMAGE_NAME],
      { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
      dependencies,
      20_000,
      'password OpenSSH image lookup',
    )
    return IMAGE_NAME
  } catch {
    await runDocker(
      ['build', '--quiet', '-t', IMAGE_NAME, contextDirectory],
      { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
      dependencies,
      PASSWORD_SSHD_BUILD_TIMEOUT_MS,
      'password OpenSSH image build',
    )
    return IMAGE_NAME
  }
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

// ---------------------------------------------------------------------------
// Native backend: one throwaway system account plus the stock macOS sshd.
//
// Everything privileged goes through `sudo -n`, so a host whose sudo policy
// would prompt fails with sudo's own stderr instead of hanging on a password
// prompt no CI job can answer.
// ---------------------------------------------------------------------------

export const PASSWORD_SSHD_BACKEND_ENV = 'TERMINAL_SMOKE_PASSWORD_BACKEND'
export const PASSWORD_SSHD_BACKENDS = ['auto', 'docker', 'native']

const SUDO = '/usr/bin/sudo'
const SYSADMINCTL = '/usr/sbin/sysadminctl'
const NATIVE_SSHD = '/usr/sbin/sshd'
const NATIVE_SSH_KEYGEN = '/usr/bin/ssh-keygen'
const NATIVE_LOGIN_SHELL = '/bin/bash'
const NATIVE_ACCOUNT_PREFIX = 'tmsmoke'
const NATIVE_COMMAND_TIMEOUT_MS = 120_000
const NATIVE_KEYGEN_TIMEOUT_MS = 30_000
const NATIVE_STOP_GRACE_MS = 3_000
const NATIVE_PORT_ATTEMPTS = 4
const NATIVE_PLAN_PORT = '<reserved-loopback-port>'
const NATIVE_PLAN_PASSWORD = '<generated-per-run>'

// macOS accounts do not authenticate over sshd unless these three things hold:
// the primary group is staff, the login shell exists, and the directory node
// carries a ShadowHash credential. When any is missing sshd reports the single
// opaque sentence "authentication failed: all methods rejected" and nothing in
// the log says which one it was, so the fixture checks each of them itself and
// fails with the attribute that is wrong.
const NATIVE_DSCL = '/usr/bin/dscl'
const NATIVE_DSEDITGROUP = '/usr/sbin/dseditgroup'
const NATIVE_CHOWN = '/usr/bin/chown'
const NATIVE_CHMOD = '/usr/bin/chmod'
const NATIVE_STAT = '/usr/bin/stat'
const NATIVE_ID = '/usr/bin/id'
const NATIVE_SSH_CLIENT = '/usr/bin/ssh'
const NATIVE_EXPECT = '/usr/bin/expect'
const NATIVE_SSH_ACCESS_GROUP = 'com.apple.access_ssh'
const NATIVE_STAFF_GROUP = 'staff'
const NATIVE_STAFF_GID = '20'
const NATIVE_PROBE_TIMEOUT_MS = 30_000
const NATIVE_ACCOUNT_ATTRIBUTES = [
  'PrimaryGroupID',
  'UserShell',
  'NFSHomeDirectory',
  'AuthenticationAuthority',
]

function sudoArguments(args) {
  return ['-n', ...args]
}

function nativeAccountName() {
  // Random suffix so a run cannot collide with a leftover account, and
  // lower-case hex so sysadminctl never has to parse anything exotic.
  return `${NATIVE_ACCOUNT_PREFIX}${randomBytes(4).toString('hex')}`
}

function nativeAccountPassword() {
  // Generated per run instead of pinned in the repository: a teardown that
  // fails can leave the account behind, and it must not then be unlockable
  // with a password published in this file.
  return randomBytes(16).toString('hex')
}

function nativePasswordPaths(directory) {
  return {
    configPath: path.join(directory, 'sshd_config'),
    connectionPath: path.join(directory, 'connection.json'),
    homePath: path.join(directory, 'home'),
    hostKeyPath: path.join(directory, 'ssh_host_ed25519_key'),
    pidFile: path.join(directory, 'sshd.pid'),
  }
}

function nativeAddUserArguments(username, password, homePath) {
  return [
    '-addUser',
    username,
    '-password',
    password,
    // -GID pins the primary group: without it sysadminctl lets the directory
    // service choose, and an account whose primary group is not staff cannot
    // authenticate through sshd's PAM path.
    '-GID',
    NATIVE_STAFF_GID,
    '-shell',
    NATIVE_LOGIN_SHELL,
    '-home',
    homePath,
  ]
}

function nativeHostKeyArguments(hostKeyPath) {
  // -q -N '': silent and passphrase-free; ed25519 matches the key type the
  // Docker fixture pins in expectedHostKey.
  return ['-q', '-t', 'ed25519', '-N', '', '-f', hostKeyPath]
}

function nativeSshdArguments(configPath) {
  return ['-D', '-e', '-f', configPath]
}

function nativeAuthOnlyArguments(username, password) {
  return sudoArguments([NATIVE_DSCL, '.', '-authonly', username, password])
}

function nativeHomeOwnershipCommands(username, homePath) {
  return [
    {
      args: sudoArguments([
        NATIVE_CHOWN,
        '-R',
        `${username}:${NATIVE_STAFF_GROUP}`,
        homePath,
      ]),
      command: SUDO,
      label: 'hand the fixture home directory to the throwaway account',
    },
    {
      args: sudoArguments([NATIVE_CHMOD, '755', homePath]),
      command: SUDO,
      label: 'make the fixture home directory reachable',
    },
  ]
}

function nativeAttributeReadCommand(username, attribute) {
  return {
    args: sudoArguments([NATIVE_DSCL, '.', '-read', `/Users/${username}`, attribute]),
    command: SUDO,
    label: `read ${attribute}`,
  }
}

function nativeHomeStatCommand(homePath) {
  return {
    args: sudoArguments([NATIVE_STAT, '-f', '%Su:%Sg:%Sp', homePath]),
    command: SUDO,
    label: `check the owner and mode of ${homePath}`,
  }
}

function nativeAccessGroupCheckCommand() {
  return {
    args: sudoArguments([NATIVE_DSCL, '.', '-read', `/Groups/${NATIVE_SSH_ACCESS_GROUP}`]),
    command: SUDO,
    label: `check whether ${NATIVE_SSH_ACCESS_GROUP} restricts sshd logins`,
  }
}

function nativeAccessGroupAddCommand(username) {
  return {
    args: sudoArguments([
      NATIVE_DSEDITGROUP,
      '-o',
      'edit',
      '-a',
      username,
      '-t',
      'user',
      NATIVE_SSH_ACCESS_GROUP,
    ]),
    command: SUDO,
    label: `add ${username} to ${NATIVE_SSH_ACCESS_GROUP} when that group exists`,
  }
}

/**
 * The privileged commands a native run issues once the account exists, in the
 * order it issues them.
 *
 * `--print-plan` renders this list and the run issues the same commands through
 * the named helpers below, so a reviewer reading the plan sees what will really
 * run. The two conditional steps say so: the group edit happens only when the
 * group exists, and the login probe only once the daemon answers.
 */
export function buildNativeAccountSteps({
  username,
  homePath,
  password = NATIVE_PLAN_PASSWORD,
}) {
  return [
    {
      args: nativeAuthOnlyArguments(username, password),
      command: SUDO,
      label: 'verify the account password without SSH (dscl . -authonly)',
    },
    ...nativeHomeOwnershipCommands(username, homePath),
    ...NATIVE_ACCOUNT_ATTRIBUTES.map(attribute =>
      nativeAttributeReadCommand(username, attribute),
    ),
    nativeHomeStatCommand(homePath),
    nativeAccessGroupCheckCommand(),
    nativeAccessGroupAddCommand(username),
    {
      label:
        `probe one real SSH password login as ${username}@${LOOPBACK}:<port> ` +
        'with expect(1), and fail the fixture when sshd rejects it',
    },
  ]
}

/**
 * Renders the fixture sshd_config.
 *
 * Pure on purpose: `--print-plan` prints this exact text without executing
 * anything, so what a reviewer reads there is what a run writes.
 */
export function renderNativeSshdConfig({ port, username, hostKeyPath, pidFile }) {
  return `Port ${port}
ListenAddress ${LOOPBACK}
HostKey ${hostKeyPath}
PidFile ${pidFile}
# One throwaway account, one password, loopback only. The dedicated PidFile
# keeps this daemon away from the system sshd's pid file, and StrictModes off
# lets sshd accept a home directory it did not create.
PasswordAuthentication yes
KbdInteractiveAuthentication no
PubkeyAuthentication no
PermitEmptyPasswords no
UsePAM yes
PermitRootLogin no
AllowUsers ${username}
StrictModes no
PermitTTY yes
UseDNS no
PrintMotd no
PrintLastLog no
LogLevel VERBOSE
`
}

function requestedPasswordSshdBackend(env) {
  const raw = env?.[PASSWORD_SSHD_BACKEND_ENV]
  if (raw === undefined || raw === '') return 'auto'
  if (!PASSWORD_SSHD_BACKENDS.includes(raw)) {
    throw new Error(
      `${PASSWORD_SSHD_BACKEND_ENV} must be one of ${PASSWORD_SSHD_BACKENDS.join(', ')}, got ${JSON.stringify(raw)}`,
    )
  }
  return raw
}

async function dockerDaemonAnswers(dependencies) {
  try {
    await runDocker(
      ['version', '--format', '{{.Server.Version}}'],
      { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
      dependencies,
      20_000,
      'password OpenSSH Docker daemon probe',
    )
    return true
  } catch {
    return false
  }
}

/**
 * Decides which backend this run uses.
 *
 * `docker` is never probed for an explicit request, so the existing Docker
 * call path keeps its exact command sequence.
 */
export async function resolvePasswordSshdBackend({ dependencies }) {
  const requested = requestedPasswordSshdBackend(dependencies.env)
  if (requested === 'docker') return 'docker'
  if (requested === 'native') {
    if (dependencies.platform !== 'darwin') {
      throw new Error(
        `${PASSWORD_SSHD_BACKEND_ENV}=native needs sysadminctl and a sudo-owned sshd, which only exist on macOS; this host is ${dependencies.platform}`,
      )
    }
    return 'native'
  }
  if (await dockerDaemonAnswers(dependencies)) return 'docker'
  if (dependencies.platform === 'darwin') return 'native'
  throw new Error(
    `${PASSWORD_SSHD_BACKEND_ENV}=auto found no reachable Docker daemon, and the native backend only exists on macOS; this host is ${dependencies.platform}`,
  )
}

export function buildNativePasswordSshdPlan({
  directory,
  username,
  platform = process.platform,
  port = NATIVE_PLAN_PORT,
  password = NATIVE_PLAN_PASSWORD,
}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new Error('password fixture plan requires an absolute directory')
  }
  const paths = nativePasswordPaths(directory)
  return {
    accountSteps: buildNativeAccountSteps({
      homePath: paths.homePath,
      password,
      username,
    }),
    cleanupSteps: [
      { label: `SIGTERM the sshd process group, SIGKILL after ${NATIVE_STOP_GRACE_MS} ms` },
      {
        args: sudoArguments([SYSADMINCTL, '-deleteUser', username]),
        command: SUDO,
        label: 'delete the throwaway account',
      },
      { label: `remove ${directory} recursively (host key, config, home, pid file)` },
    ],
    config: renderNativeSshdConfig({
      hostKeyPath: paths.hostKeyPath,
      pidFile: paths.pidFile,
      port,
      username,
    }),
    directory,
    paths,
    platform,
    port,
    steps: [
      {
        args: sudoArguments([
          SYSADMINCTL,
          ...nativeAddUserArguments(username, password, paths.homePath),
        ]),
        command: SUDO,
        label: 'create the throwaway account',
      },
      {
        args: nativeHostKeyArguments(paths.hostKeyPath),
        command: NATIVE_SSH_KEYGEN,
        label: 'generate the fixture host key',
      },
      {
        args: sudoArguments([NATIVE_SSHD, ...nativeSshdArguments(paths.configPath)]),
        command: SUDO,
        label: 'start the loopback password daemon',
      },
    ],
    username,
  }
}

function shellQuote(text) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text
  return `'${text.replaceAll("'", "'\\''")}'`
}

function formatPlanStep(step) {
  if (step.command === undefined) return step.label
  return `${step.label}\n     $ ${[step.command, ...step.args].map(shellQuote).join(' ')}`
}

export function formatNativePasswordSshdPlan(plan) {
  const steps = plan.steps.map(
    (step, index) => `${index + 1}. ${formatPlanStep(step)}`,
  )
  const cleanup = plan.cleanupSteps.map(
    (step, index) => `${index + 1}. ${formatPlanStep(step)}`,
  )
  return [
    '# terminal-smoke-password-sshd native backend plan (dry run)',
    '# Nothing below was executed: no sudo call, no account created, no daemon.',
    '',
    `platform: ${plan.platform}`,
    `fixture directory: ${plan.directory}`,
    `account: ${plan.username}`,
    'account password: 16 random bytes per run, never printed by a real run',
    `listen: ${LOOPBACK}:${plan.port}`,
    'port: 127.0.0.1:0 is bound, the kernel-assigned high port is read back and',
    '      that socket is closed; sshd then binds the same port. The window in',
    '      between is covered by a readiness probe on a real TCP connection, and',
    `      the whole reservation is retried up to ${NATIVE_PORT_ATTEMPTS} times when sshd reports EADDRINUSE.`,
    'sudo: every privileged step is `sudo -n`, so a host without passwordless sudo',
    '      fails with sudo stderr instead of waiting on a prompt.',
    '',
    '## commands, in order',
    ...steps,
    '',
    `## commands once the account exists, in order (home ${plan.paths.homePath})`,
    ...plan.accountSteps.map(
      (step, index) => `${index + 1}. ${formatPlanStep(step)}`,
    ),
    '',
    'The group edit and the login probe are conditional: the edit runs only',
    'when the group exists, and the probe only once the daemon answers.',
    '',
    `## file written before the daemon starts: ${plan.paths.configPath}`,
    plan.config.trimEnd(),
    '',
    `## file written once the daemon answers: ${plan.paths.connectionPath} (mode 0600)`,
    '',
    '## stop() cleanup, in order',
    ...cleanup,
  ].join('\n')
}

/**
 * runDockerCommand's contract for the non-Docker binaries the native backend
 * needs. Deliberately a sibling rather than a shared helper: the Docker path
 * is frozen, so generalising it would mean editing it.
 */
async function runFixtureCommand(command, args, options, dependencies, timeoutMs, label) {
  let child
  try {
    child = dependencies.spawn(command, args, options)
  } catch (spawnError) {
    throw new Error(`${label} could not start: ${spawnError.message}`)
  }
  const stdout = collectOutput(child.stdout)
  const stderr = collectOutput(child.stderr)
  let timedOut = false
  const timeout = dependencies.setTimeout(() => {
    timedOut = true
    try {
      child.kill('SIGKILL')
    } catch {
      // The command closed between the timer and the signal.
    }
  }, timeoutMs)
  const status = await waitForClose(child)
  dependencies.clearTimeout(timeout)
  if (status.spawnError) {
    throw new Error(`${label} could not start: ${status.spawnError.message}`)
  }
  if (timedOut) {
    throw new Error(`${label} timed out after ${timeoutMs} ms: ${stderr().trim()}`)
  }
  if (status.code !== 0) {
    const detail = stderr().trim() || stdout().trim()
    throw new Error(
      `${label} exited with code ${String(status.code)}${detail ? `: ${detail}` : ''}`,
    )
  }
  return { stderr: stderr(), stdout: stdout() }
}

/**
 * runFixtureCommand for commands whose failure is an answer rather than an
 * error: `dscl -read` exits non-zero for an attribute that is simply absent,
 * and a missing `com.apple.access_ssh` group is a legitimate host shape.
 */
async function tryRunFixtureCommand(
  command,
  args,
  options,
  dependencies,
  timeoutMs,
  label,
) {
  try {
    const result = await runFixtureCommand(
      command,
      args,
      options,
      dependencies,
      timeoutMs,
      label,
    )
    return { detail: result.stderr.trim(), ok: true, value: result.stdout.trim() }
  } catch (error) {
    return { detail: error.message, ok: false, value: '' }
  }
}

async function readNativeAccountAttribute(
  username,
  attribute,
  commandOptions,
  dependencies,
) {
  const command = nativeAttributeReadCommand(username, attribute)
  const result = await tryRunFixtureCommand(
    command.command,
    command.args,
    commandOptions,
    dependencies,
    NATIVE_COMMAND_TIMEOUT_MS,
    `password fixture ${attribute} read`,
  )
  if (!result.ok) return ''
  // `dscl . -read /Users/<user> <attribute>` answers "<attribute>: <value>".
  const prefix = attribute + ':'
  return result.value.startsWith(prefix)
    ? result.value.slice(prefix.length).trim()
    : result.value
}

function formatNativeAccountDiagnostics({
  attributes,
  home,
  homePath,
  identity,
  username,
}) {
  return [
    `id ${username}: ${identity.ok ? identity.value : identity.detail}`,
    ...NATIVE_ACCOUNT_ATTRIBUTES.map(
      attribute =>
        `dscl . -read /Users/${username} ${attribute}: ` +
        (attributes[attribute] === '' ? '<missing>' : attributes[attribute]),
    ),
    `${homePath}: ${home.ok ? home.value : home.detail}`,
  ].join('\n')
}

/**
 * Proves the account can verify its own password without sshd in the way.
 *
 * `dscl . -authonly` exercises the same directory-node credential sshd's PAM
 * stack reads, so a failure here is the root cause of "all methods rejected"
 * and can be reported with the attributes that explain it.
 */
async function verifyNativeAccountPassword({
  commandOptions,
  dependencies,
  homePath,
  password,
  username,
}) {
  const authOnly = await tryRunFixtureCommand(
    SUDO,
    nativeAuthOnlyArguments(username, password),
    commandOptions,
    dependencies,
    NATIVE_COMMAND_TIMEOUT_MS,
    'password fixture password verification',
  )
  if (authOnly.ok) {
    dependencies.log(
      `[password-sshd] ${username} accepts its own password (dscl . -authonly)`,
    )
    return
  }
  const attributes = {}
  for (const attribute of NATIVE_ACCOUNT_ATTRIBUTES) {
    attributes[attribute] = await readNativeAccountAttribute(
      username,
      attribute,
      commandOptions,
      dependencies,
    )
  }
  const identity = await tryRunFixtureCommand(
    NATIVE_ID,
    [username],
    commandOptions,
    dependencies,
    NATIVE_COMMAND_TIMEOUT_MS,
    'password fixture account lookup',
  )
  const home = await tryRunFixtureCommand(
    SUDO,
    nativeHomeStatCommand(homePath).args,
    commandOptions,
    dependencies,
    NATIVE_COMMAND_TIMEOUT_MS,
    'password fixture home directory check',
  )
  throw new Error(
    `password fixture account ${username} rejects its own password, which is ` +
      `why every password case fails with "all methods rejected": ` +
      `${authOnly.detail}\n` +
      formatNativeAccountDiagnostics({
        attributes,
        home,
        homePath,
        identity,
        username,
      }),
  )
}

async function fixNativeHomeOwnership({
  commandOptions,
  dependencies,
  homePath,
  username,
}) {
  for (const step of nativeHomeOwnershipCommands(username, homePath)) {
    await runFixtureCommand(
      step.command,
      step.args,
      commandOptions,
      dependencies,
      NATIVE_COMMAND_TIMEOUT_MS,
      `password fixture ${step.label}`,
    )
  }
}

/**
 * Checks the attributes sysadminctl is supposed to have set.
 *
 * sshd answers a wrong primary group, a missing shell or an account without a
 * ShadowHash credential with the same opaque rejection, so each of them is
 * asserted here where the answer names the attribute.
 */
async function verifyNativeAccountAttributes({
  commandOptions,
  dependencies,
  homePath,
  username,
}) {
  const attributes = {}
  for (const attribute of NATIVE_ACCOUNT_ATTRIBUTES) {
    attributes[attribute] = await readNativeAccountAttribute(
      username,
      attribute,
      commandOptions,
      dependencies,
    )
  }
  const home = await tryRunFixtureCommand(
    SUDO,
    nativeHomeStatCommand(homePath).args,
    commandOptions,
    dependencies,
    NATIVE_COMMAND_TIMEOUT_MS,
    'password fixture home directory check',
  )
  const identity = await tryRunFixtureCommand(
    NATIVE_ID,
    [username],
    commandOptions,
    dependencies,
    NATIVE_COMMAND_TIMEOUT_MS,
    'password fixture account lookup',
  )

  const problems = []
  if (attributes.PrimaryGroupID !== NATIVE_STAFF_GID) {
    problems.push(
      `PrimaryGroupID is ${attributes.PrimaryGroupID || '<missing>'}; expected ` +
        `${NATIVE_STAFF_GID} (${NATIVE_STAFF_GROUP})`,
    )
  }
  if (attributes.UserShell !== NATIVE_LOGIN_SHELL) {
    problems.push(
      `UserShell is ${attributes.UserShell || '<missing>'}; expected ${NATIVE_LOGIN_SHELL}`,
    )
  }
  if (!attributes.AuthenticationAuthority.includes('ShadowHash')) {
    problems.push(
      'AuthenticationAuthority carries no ShadowHash entry, so the account has ' +
        'no password sshd could verify',
    )
  }
  const expectedOwner = `${username}:${NATIVE_STAFF_GROUP}`
  if (!home.ok || !home.value.startsWith(expectedOwner)) {
    problems.push(
      `${homePath} is ${home.ok ? home.value : home.detail}; expected it owned by ` +
        `${expectedOwner}`,
    )
  }
  if (problems.length > 0) {
    throw new Error(
      `password fixture account ${username} would be rejected by sshd:\n- ` +
        problems.join('\n- ') +
        '\n' +
        formatNativeAccountDiagnostics({
          attributes,
          home,
          homePath,
          identity,
          username,
        }),
    )
  }
  dependencies.log(
    `[password-sshd] ${username} attributes verified: PrimaryGroupID ` +
      `${attributes.PrimaryGroupID}, UserShell ${attributes.UserShell}, ` +
      `ShadowHash present, home ${home.value}`,
  )
}

/**
 * Adds the account to `com.apple.access_ssh` when that group exists.
 *
 * Apple's sshd refuses every authentication method for an account outside that
 * group and reports only "all methods rejected", which is exactly the failure
 * this fixture used to hit on a hosted runner.
 */
async function ensureNativeSshAccessGroup({
  commandOptions,
  dependencies,
  username,
}) {
  const group = nativeAccessGroupCheckCommand()
  const existing = await tryRunFixtureCommand(
    group.command,
    group.args,
    commandOptions,
    dependencies,
    NATIVE_COMMAND_TIMEOUT_MS,
    'password fixture ssh access group read',
  )
  if (!existing.ok) {
    dependencies.log(
      `[password-sshd] ${NATIVE_SSH_ACCESS_GROUP} is absent on this host, so sshd ` +
        'does not restrict logins by group',
    )
    return false
  }
  const add = nativeAccessGroupAddCommand(username)
  await runFixtureCommand(
    add.command,
    add.args,
    commandOptions,
    dependencies,
    NATIVE_COMMAND_TIMEOUT_MS,
    'password fixture ssh access group membership',
  )
  dependencies.log(
    `[password-sshd] added ${username} to ${NATIVE_SSH_ACCESS_GROUP}`,
  )
  return true
}

function formatSshdDiagnostics(daemon) {
  const stderr = (daemon?.stderr?.() ?? '').trim()
  if (stderr === '') return 'the daemon printed no diagnostics of its own'
  return (
    'daemon diagnostics:\n' +
    stderr
      .split('\n')
      .map(line => '  [password-sshd] ' + line)
      .join('\n')
  )
}

export function renderNativePasswordProbeScript({ password, port, username }) {
  if (!/^[0-9a-f]{32}$/.test(password)) {
    throw new Error('the SSH login probe needs the generated hex account password')
  }
  return [
    `set timeout ${Math.round(NATIVE_PROBE_TIMEOUT_MS / 1000)}`,
    // -F /dev/null keeps the runner's own ssh config out of the probe, and
    // NumberOfPasswordPrompts=1 makes a rejected password fail the probe
    // instead of looping on the prompt.
    `spawn ${NATIVE_SSH_CLIENT} -F /dev/null -o BatchMode=no ` +
      '-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ' +
      '-o PreferredAuthentications=password -o PubkeyAuthentication=no ' +
      `-o NumberOfPasswordPrompts=1 -p ${port} ${username}@${LOOPBACK} ` +
      'echo terminal-smoke-probe-ok',
    'expect {',
    // The prompt, not the word: ssh's own "Permission denied (password)." line
    // also contains it, and answering that would hide the rejection behind a
    // timeout.
    '  -re {[Pp]assword: ?$} {',
    `    send -- "${password}\\r"`,
    '    exp_continue',
    '  }',
    '  "terminal-smoke-probe-ok" { exit 0 }',
    '  timeout { puts "no password prompt or marker from sshd"; exit 2 }',
    '  eof { exit 1 }',
    '}',
    'exit 1',
    '',
  ].join('\n')
}

/**
 * Types the generated password into a real ssh handshake.
 *
 * A banner probe only proves sshd is listening; the account, the password and
 * the group membership are what the matrix actually depends on. `expect` ships
 * with macOS, so this needs nothing installed.
 */
async function probeNativePasswordLogin({
  daemon,
  dependencies,
  directory,
  password,
  port,
  username,
}) {
  const scriptPath = path.join(directory, 'password-probe.exp')
  await dependencies.writeFile(
    scriptPath,
    renderNativePasswordProbeScript({ password, port, username }),
    { encoding: 'utf8', mode: 0o600 },
  )
  try {
    await runFixtureCommand(
      NATIVE_EXPECT,
      ['-f', scriptPath],
      { cwd: directory, shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
      dependencies,
      NATIVE_PROBE_TIMEOUT_MS + 15_000,
      'password SSH login probe',
    )
    dependencies.log(
      `[password-sshd] a real SSH password login as ${username} succeeded before ` +
        'the fixture was handed to a runner',
    )
  } catch (error) {
    throw new Error(
      `password fixture cannot log in as ${username} over SSH, so every password ` +
        `case would fail with "all methods rejected": ${error.message}\n` +
        formatSshdDiagnostics(daemon),
    )
  } finally {
    await dependencies.rm(scriptPath, { force: true })
  }
}

function startNativeSshd(configPath, directory, dependencies) {
  let child
  try {
    child = dependencies.spawn(
      SUDO,
      sudoArguments([NATIVE_SSHD, ...nativeSshdArguments(configPath)]),
      {
        cwd: directory,
        detached: true,
        shell: false,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    )
  } catch (error) {
    throw new Error(`password OpenSSH daemon could not start: ${error.message}`)
  }
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
    throw new Error('password OpenSSH daemon did not expose a valid process id')
  }
  const daemon = { child, closed: false, stderr: collectOutput(child.stderr) }
  forwardSshdDiagnostics(child, dependencies)
  daemon.closePromise = waitForClose(child).then(status => {
    daemon.closed = true
    return status
  })
  return daemon
}

/**
 * Streams sshd's own stderr into the evidence log with a recognisable prefix.
 *
 * `sshd -D -e` writes its diagnostics to stderr and nowhere else, so without
 * this the reason a password login was refused existed only inside a string
 * that a passing run never printed.
 */
function forwardSshdDiagnostics(child, dependencies) {
  if (typeof dependencies.log !== 'function') return
  child.stderr?.setEncoding('utf8')
  let pending = ''
  child.stderr?.on('data', chunk => {
    pending += chunk
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim() !== '') dependencies.log('[password-sshd] ' + line)
    }
  })
}

function signalNativeDaemon(daemon, signal, dependencies) {
  if (daemon.closed) return
  try {
    // detached: the sudo child leads its own process group, so a negative pid
    // reaches the sshd that sudo exec'd as well.
    dependencies.processKill(-daemon.child.pid, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

function nativeDaemonClosesWithin(daemon, timeoutMs, dependencies) {
  if (daemon.closed) return Promise.resolve(true)
  return new Promise(resolve => {
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      dependencies.clearTimeout(timer)
      resolve(result)
    }
    const timer = dependencies.setTimeout(() => finish(false), timeoutMs)
    daemon.closePromise.then(
      () => finish(true),
      () => finish(true),
    )
  })
}

async function stopNativeDaemon(daemon, dependencies) {
  if (daemon === null || daemon === undefined || daemon.closed) return
  signalNativeDaemon(daemon, 'SIGTERM', dependencies)
  if (await nativeDaemonClosesWithin(daemon, NATIVE_STOP_GRACE_MS, dependencies)) return
  signalNativeDaemon(daemon, 'SIGKILL', dependencies)
  if (!(await nativeDaemonClosesWithin(daemon, NATIVE_STOP_GRACE_MS, dependencies))) {
    throw new Error(`password OpenSSH daemon did not exit: ${daemon.stderr().trim()}`)
  }
}

async function waitUntilNativeReady(daemon, port, dependencies) {
  const deadline = dependencies.now() + PASSWORD_SSHD_READY_TIMEOUT_MS
  let lastFailure = 'no banner probe completed'
  while (dependencies.now() <= deadline) {
    if (daemon.closed) {
      const status = await daemon.closePromise
      throw new Error(
        `password OpenSSH daemon exited before serving ${LOOPBACK}:${port} (code ${String(status.code)}): ${daemon.stderr().trim()}`,
      )
    }
    try {
      if (await probeSshBanner(port, dependencies)) return
    } catch (error) {
      lastFailure = error.message
    }
    await dependencies.sleep(100)
  }
  throw new Error(
    `password OpenSSH readiness probe failed: ${lastFailure}: ${daemon.stderr().trim()}`,
  )
}

async function startNativePasswordSshd({ runDirectory, dependencies }) {
  const directory = path.join(runDirectory, 'password-sshd-native')
  const paths = nativePasswordPaths(directory)
  const username = nativeAccountName()
  const password = nativeAccountPassword()
  const commandOptions = { shell: false, stdio: ['ignore', 'pipe', 'pipe'] }
  const state = { accountCreated: false, daemon: null }
  let port

  const cleanup = async () => {
    const failures = []
    try {
      await stopNativeDaemon(state.daemon, dependencies)
    } catch (error) {
      failures.push(`daemon stop failed: ${error.message}`)
    }
    state.daemon = null
    if (state.accountCreated) {
      try {
        await runFixtureCommand(
          SUDO,
          sudoArguments([SYSADMINCTL, '-deleteUser', username]),
          commandOptions,
          dependencies,
          NATIVE_COMMAND_TIMEOUT_MS,
          'password fixture account deletion',
        )
        state.accountCreated = false
      } catch (error) {
        // A repeated stop() deletes an account that is already gone; only a
        // real failure is worth reporting.
        if (/not found|does not exist|no such user|unknown user/i.test(error.message)) {
          state.accountCreated = false
        } else {
          failures.push(error.message)
        }
      }
    }
    try {
      await dependencies.rm(directory, { force: true, recursive: true })
    } catch (error) {
      failures.push(`fixture directory removal failed: ${error.message}`)
    }
    return failures
  }

  try {
    await dependencies.mkdir(paths.homePath, { mode: 0o755, recursive: true })
    await runFixtureCommand(
      NATIVE_SSH_KEYGEN,
      nativeHostKeyArguments(paths.hostKeyPath),
      commandOptions,
      dependencies,
      NATIVE_KEYGEN_TIMEOUT_MS,
      'password fixture host key generation',
    )
    const publicKey = await dependencies.readFile(`${paths.hostKeyPath}.pub`, 'utf8')
    const expectedHostKey = publicKey.trim().split(/\s+/).slice(0, 2).join(' ')
    if (!/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(expectedHostKey)) {
      throw new Error('password fixture host key is invalid')
    }
    await runFixtureCommand(
      SUDO,
      sudoArguments([
        SYSADMINCTL,
        ...nativeAddUserArguments(username, password, paths.homePath),
      ]),
      commandOptions,
      dependencies,
      NATIVE_COMMAND_TIMEOUT_MS,
      'password fixture account creation',
    )
    state.accountCreated = true

    // Fail here, with the attribute that is wrong, instead of fifteen minutes
    // later inside the matrix where sshd only says "all methods rejected".
    await verifyNativeAccountPassword({
      commandOptions,
      dependencies,
      homePath: paths.homePath,
      password,
      username,
    })
    await fixNativeHomeOwnership({
      commandOptions,
      dependencies,
      homePath: paths.homePath,
      username,
    })
    await verifyNativeAccountAttributes({
      commandOptions,
      dependencies,
      homePath: paths.homePath,
      username,
    })
    await ensureNativeSshAccessGroup({ commandOptions, dependencies, username })

    let ready = false
    for (let attempt = 1; attempt <= NATIVE_PORT_ATTEMPTS; attempt += 1) {
      port = await reserveLoopbackPort(dependencies)
      if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
        throw new Error('port reservation returned an invalid high port')
      }
      await dependencies.writeFile(
        paths.configPath,
        renderNativeSshdConfig({
          hostKeyPath: paths.hostKeyPath,
          pidFile: paths.pidFile,
          port,
          username,
        }),
        { encoding: 'utf8', mode: 0o600 },
      )
      state.daemon = startNativeSshd(paths.configPath, directory, dependencies)
      try {
        await waitUntilNativeReady(state.daemon, port, dependencies)
        ready = true
        break
      } catch (error) {
        const conflict = /address already in use/i.test(
          `${error.message}\n${state.daemon.stderr()}`,
        )
        try {
          await stopNativeDaemon(state.daemon, dependencies)
        } catch {
          // The readiness failure is the more useful error.
        }
        state.daemon = null
        if (attempt < NATIVE_PORT_ATTEMPTS && conflict) continue
        throw error
      }
    }
    if (!ready || state.daemon === null) {
      throw new Error('password OpenSSH daemon never became ready')
    }
    await probeNativePasswordLogin({
      daemon: state.daemon,
      dependencies,
      directory,
      password,
      port,
      username,
    })

    const connection = {
      host: LOOPBACK,
      port,
      username,
      authMode: 'password',
      expectedHostKey,
      privateKey: null,
      password,
      certificate: null,
      jump: null,
    }
    await dependencies.writeFile(
      paths.connectionPath,
      `${JSON.stringify(connection)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )

    let restartPromise
    let stopPromise = null
    return {
      ...connection,
      configPath: paths.connectionPath,
      restart: () => {
        if (restartPromise) return restartPromise
        restartPromise = (async () => {
          await stopNativeDaemon(state.daemon, dependencies)
          state.daemon = startNativeSshd(paths.configPath, directory, dependencies)
          try {
            await waitUntilNativeReady(state.daemon, port, dependencies)
          } catch (error) {
            try {
              await stopNativeDaemon(state.daemon, dependencies)
            } catch {
              // The readiness failure is the more useful error.
            }
            state.daemon = null
            throw error
          }
        })()
        return restartPromise
      },
      stop: () => {
        if (stopPromise !== null) {
          // A repeated stop() is a no-op: whatever cleanup failure the first
          // call reported has already been surfaced once.
          return stopPromise.then(
            () => undefined,
            () => undefined,
          )
        }
        stopPromise = (async () => {
          const failures = await cleanup()
          if (failures.length > 0) {
            throw new Error(`password fixture cleanup failed: ${failures.join('; ')}`)
          }
        })()
        return stopPromise
      },
    }
  } catch (error) {
    // The original failure is more useful than a cleanup failure.
    await cleanup()
    throw error
  }
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
  const backend = await resolvePasswordSshdBackend({ dependencies })
  if (backend === 'native') {
    return startNativePasswordSshd({ runDirectory, dependencies })
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

  await ensurePasswordSshdImage(directory, dependencies)

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

async function main(argv) {
  if (!argv.includes('--print-plan')) {
    process.stderr.write(
      'usage: node scripts/terminal-smoke-password-sshd.mjs --print-plan\n' +
        '\nPrints the native (sudo) backend plan without executing anything.\n',
    )
    return 2
  }
  const plan = buildNativePasswordSshdPlan({
    directory: path.join(os.tmpdir(), 'terminal-smoke-print-plan', 'password-sshd-native'),
    username: nativeAccountName(),
  })
  process.stdout.write(`${formatNativePasswordSshdPlan(plan)}\n`)
  return 0
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  process.exitCode = await main(process.argv.slice(2))
}
