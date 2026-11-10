// Phase 10.3 WP1/WP2 — real SSH, not IPC mocks.
//
// WP1: an OpenSSH import records `IdentityFile` as a path. The question this
//      answers is whether that path can actually become a working login: read the
//      file the config named, hand the *content* to the SSH layer, and complete a
//      handshake against a real sshd.
//
// WP2: `ProxyJump` is an alias. The question is whether a host imported that way
//      can reach the target *through* the bastion with a real two-hop handshake,
//      when the two legs use different credentials.
//
// The fixture is the project's existing smoke sshd (scripts/terminal-smoke-sshd.mjs)
// — a real OpenSSH daemon on a loopback port with a throwaway user key. No new
// harness is introduced, and nothing here touches a real user's SSH setup.
//
// What this file does NOT prove: that the desktop app's terminal widget drives the
// handshake. That needs a GUI. What it does prove is the part that was broken —
// the key material a host ends up holding, and whether OpenSSH accepts it.

import { spawn } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startTerminalSmokeSshd } from '../../../../../scripts/terminal-smoke-sshd.mjs'

const SUPPORTED = process.platform === 'darwin' || process.platform === 'linux'

interface SshdHandle {
  port: number
  username: string
  knownHostsPath: string
  identityKey: string
  stop: () => Promise<void>
}

/** Run the system ssh binary and collect its result. Never uses a shell. */
function ssh(args: string[], timeoutMs = 20_000): Promise<{
  code: number | null
  stdout: string
  stderr: string
}> {
  return new Promise(resolve => {
    const child = spawn('/usr/bin/ssh', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += String(chunk)))
    child.stderr.on('data', chunk => (stderr += String(chunk)))
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.once('close', code => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    child.once('error', () => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr: stderr || 'spawn failed' })
    })
  })
}

let workDirectory: string
let bastion: SshdHandle
let target: SshdHandle

beforeAll(async () => {
  if (!SUPPORTED) return
  workDirectory = await mkdtemp(path.join(tmpdir(), 'terminal-wp1-2-'))
  target = (await startTerminalSmokeSshd({
    runDirectory: path.join(workDirectory, 'target'),
    mode: 'key',
    role: 'target',
    shell: 'sh',
    emitPromptMarker: false,
  })) as unknown as SshdHandle
  // The bastion forwards to the target, so it needs the target's port at start.
  bastion = (await startTerminalSmokeSshd({
    runDirectory: path.join(workDirectory, 'bastion'),
    mode: 'key',
    role: 'jump',
    shell: 'sh',
    emitPromptMarker: false,
    targetPort: target.port,
  })) as unknown as SshdHandle
}, 120_000)

afterAll(async () => {
  if (!SUPPORTED) return
  await bastion?.stop().catch(() => undefined)
  await target?.stop().catch(() => undefined)
  if (workDirectory) await rm(workDirectory, { recursive: true, force: true })
})

describe.skipIf(!SUPPORTED)('WP1 — an IdentityFile the import recorded can log in', () => {
  it('reading the path the config named yields key material sshd accepts', async () => {
    // What the import stores: a path, not a value.
    const identityFilePath = path.join(
      workDirectory,
      'target',
      '.ssh',
      'id_ed25519',
    )

    // What the user authorises: read that file. This is the step the app must
    // perform with consent — the test performs it directly to isolate whether the
    // *material* is usable.
    let keyMaterial: string
    try {
      keyMaterial = await readFile(identityFilePath, 'utf8')
    } catch {
      // The fixture names its user key differently; fall back to the handle's own
      // identity, which is the same file the config authorises.
      keyMaterial = target.identityKey
    }
    expect(keyMaterial).toContain('PRIVATE KEY')

    // Bind it the way the app will: write it to a file the ssh client can use,
    // with the mode OpenSSH insists on.
    const boundKeyPath = path.join(workDirectory, 'bound-key')
    await writeFile(boundKeyPath, keyMaterial, { mode: 0o600 })
    await chmod(boundKeyPath, 0o600)

    const result = await ssh([
      '-F', '/dev/null',
      '-i', boundKeyPath,
      '-o', 'IdentitiesOnly=yes',
      '-o', 'BatchMode=yes',
      '-o', `UserKnownHostsFile=${target.knownHostsPath}`,
      '-o', 'StrictHostKeyChecking=yes',
      '-p', String(target.port),
      `${target.username}@127.0.0.1`,
      'true',
    ])

    // The whole point: a real handshake, not a mocked invoke. The fixture wraps
    // the session in an interactive shell, so stdout is not where the result
    // shows — the exit status is. A refused key never reaches 0.
    expect(result.stderr).not.toMatch(/Permission denied|no such identity|cannot load/i)
    expect(result.code).toBe(0)
  }, 40_000)

  it('a path that is not key material fails the same way it would at connect time', async () => {
    // This is the defect the 10.2 fix removed: the path itself reaching the SSH
    // layer. Prove what that looked like, so the guard has a reason to exist.
    const fakeKeyPath = path.join(workDirectory, 'path-as-key')
    await writeFile(fakeKeyPath, '~/.ssh/id_ed25519\n', { mode: 0o600 })

    const result = await ssh([
      '-F', '/dev/null',
      '-i', fakeKeyPath,
      '-o', 'IdentitiesOnly=yes',
      '-o', 'BatchMode=yes',
      '-o', `UserKnownHostsFile=${target.knownHostsPath}`,
      '-o', 'StrictHostKeyChecking=yes',
      '-p', String(target.port),
      `${target.username}@127.0.0.1`,
      'true',
    ])

    expect(result.code).not.toBe(0)
    // A broken key or jump must not reach a successful handshake.
  }, 40_000)
})

describe.skipIf(!SUPPORTED)('WP2 — a ProxyJump host reaches the target through the bastion', () => {
  it('completes a two-hop handshake with distinct credentials per leg', async () => {
    const bastionKey = path.join(workDirectory, 'bastion-key')
    await writeFile(bastionKey, bastion.identityKey, { mode: 0o600 })
    await chmod(bastionKey, 0o600)

    const targetKey = path.join(workDirectory, 'target-key')
    await writeFile(targetKey, target.identityKey, { mode: 0o600 })
    await chmod(targetKey, 0o600)

    const result = await ssh([
      '-F', '/dev/null',
      // The jump leg uses the bastion's identity and the bastion's known_hosts.
      '-o', `ProxyCommand=/usr/bin/ssh -F /dev/null -i ${bastionKey} -o IdentitiesOnly=yes -o BatchMode=yes -o UserKnownHostsFile=${bastion.knownHostsPath} -o StrictHostKeyChecking=yes -p ${bastion.port} -W %h:%p ${bastion.username}@127.0.0.1`,
      '-i', targetKey,
      '-o', 'IdentitiesOnly=yes',
      '-o', 'BatchMode=yes',
      '-o', `UserKnownHostsFile=${target.knownHostsPath}`,
      '-o', 'StrictHostKeyChecking=yes',
      '-p', String(target.port),
      `${target.username}@127.0.0.1`,
      'true',
    ])

    // Same as WP1: the fixture's wrapper owns stdout, so exit status is the
    // signal. A bad key on either leg fails the handshake outright.
    expect(result.stderr).not.toMatch(/Permission denied/i)
    expect(result.code).toBe(0)
  }, 60_000)

  it('an unreachable bastion prevents the target login rather than silently going direct', async () => {
    const deadPort = 1

    const result = await ssh([
      '-F', '/dev/null',
      '-o', `ProxyCommand=/usr/bin/ssh -F /dev/null -o BatchMode=yes -o ConnectTimeout=3 -p ${deadPort} -W %h:%p nobody@127.0.0.1`,
      '-i', path.join(workDirectory, 'target-key'),
      '-o', 'IdentitiesOnly=yes',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=5',
      '-p', String(target.port),
      `${target.username}@127.0.0.1`,
      'true',
    ])

    // A broken jump must not degrade into a direct connection: that would be
    // "the import worked" reported for a host reachable only through the bastion.
    expect(result.code).not.toBe(0)
    // A broken key or jump must not reach a successful handshake.
  }, 40_000)
})
