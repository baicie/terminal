// Phase 10.3 WP3 — the credential resolver's output must actually authenticate.
//
// The resolver has unit tests: given a reference, a vault, and a locked/unlocked
// state, it returns the right outcome. What those tests cannot show is whether the
// value it returns is *usable* — a resolver that returns the correct-looking string
// for the wrong kind would pass every unit test and fail every login.
//
// So this drives the real `SessionCredentialResolver` against a real vault-shaped
// provider and feeds its output to the real `ssh` binary talking to a real sshd.
//
// The provider here is an in-memory stand-in for `VaultSecretProvider` (which
// requires the Tauri IPC bridge). It implements the same four operations with the
// same key layout, so the resolver is exercised unchanged; only the storage
// backend differs, and that difference is the part already covered by the vault's
// own tests.
//
// What this proves: reference → resolver → key material → OpenSSH accepts it.
// What it does not: that the desktop app's Rust session drives the handshake.
// `SSH_VAULT_REAL_E2E` therefore stays NOT_RUN — see the audit report.

import { spawn } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// @ts-expect-error - no declaration file for the smoke sshd fixture
import { startTerminalSmokeSshd } from '../../../../../../scripts/terminal-smoke-sshd.mjs'

import {
  SessionCredentialResolver,
  vaultKey,
} from '@/service/credential-boundary'
import type {
  CredentialKind,
  CredentialRef,
  CredentialResource,
  SecretProvider,
} from '@/service/credential-boundary'

const SUPPORTED = process.platform === 'darwin' || process.platform === 'linux'

/**
 * A vault with the real key layout and the real four operations.
 *
 * Deliberately not a mock of the resolver: `read` distinguishes "absent" from
 * "failed" exactly as `VaultSecretProvider` does, because the resolver's behaviour
 * depends on that distinction.
 */
class InMemoryVault implements SecretProvider {
  private readonly entries = new Map<string, string>()
  locked = false
  /** Kinds whose read should throw, to model a decrypt failure. */
  readonly failing = new Set<CredentialKind>()

  private key(resource: CredentialResource, version: number, kind: CredentialKind) {
    return vaultKey(resource, version, kind)
  }

  async isAvailable(): Promise<boolean> {
    return !this.locked
  }

  async read(
    resource: CredentialResource,
    version: number,
    kind: CredentialKind,
  ): Promise<string | undefined> {
    if (this.locked) throw new Error('vault is locked')
    if (this.failing.has(kind)) throw new Error('vault could not decrypt this entry')
    return this.entries.get(this.key(resource, version, kind))
  }

  async write(
    resource: CredentialResource,
    version: number,
    kind: CredentialKind,
    value: string,
  ): Promise<void> {
    this.entries.set(this.key(resource, version, kind), value)
  }

  async remove(
    resource: CredentialResource,
    version: number,
    kind: CredentialKind,
  ): Promise<void> {
    this.entries.delete(this.key(resource, version, kind))
  }

  /** Seed a secret the way `persistKeySecrets` would. */
  seed(
    resource: CredentialResource,
    version: number,
    kind: CredentialKind,
    value: string,
  ): void {
    this.entries.set(this.key(resource, version, kind), value)
  }
}

interface SshdHandle {
  port: number
  username: string
  knownHostsPath: string
  identityKey: string
  stop: () => Promise<void>
}

function ssh(args: string[], timeoutMs = 20_000): Promise<{ code: number | null, stderr: string }> {
  return new Promise(resolve => {
    const child = spawn('/usr/bin/ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => (stderr += String(chunk)))
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.once('close', code => {
      clearTimeout(timer)
      resolve({ code, stderr })
    })
    child.once('error', () => {
      clearTimeout(timer)
      resolve({ code: null, stderr: stderr || 'spawn failed' })
    })
  })
}

let workDirectory: string
let sshd: SshdHandle

beforeAll(async () => {
  if (!SUPPORTED) return
  // `$HOME` keeps the fixture off a world-writable parent; the fixture's sshd uses
  // StrictModes and rejects `/tmp` on Linux runners (see ssh-real-connect.e2e).
  const base = process.env.HOME && process.env.HOME !== '/' ? process.env.HOME : tmpdir()
  const privateRoot = await mkdtemp(path.join(base, '.terminal-wp3-'))
  await chmod(privateRoot, 0o700)
  workDirectory = await mkdtemp(path.join(privateRoot, 'run-'))
  sshd = (await startTerminalSmokeSshd({
    runDirectory: path.join(workDirectory, 'sshd'),
    mode: 'key',
    role: 'target',
    shell: 'sh',
    emitPromptMarker: false,
  })) as unknown as SshdHandle
}, 120_000)

afterAll(async () => {
  if (!SUPPORTED) return
  await sshd?.stop().catch(() => undefined)
  if (workDirectory) {
    await rm(path.dirname(workDirectory), { recursive: true, force: true })
  }
})

/** The reference a row would carry for a host that stores one key. */
function keyRef(version: number): CredentialRef {
  return { kinds: ['privateKey'], provider: 'vault', version }
}

/** Authenticate with whatever the resolver returned. */
async function connectWith(
  credential: { password?: string, privateKey?: string },
): Promise<{ code: number | null, stderr: string }> {
  const keyPath = path.join(workDirectory, 'resolved-key')
  await writeFile(keyPath, credential.privateKey ?? '', { mode: 0o600 })
  await chmod(keyPath, 0o600)
  return ssh([
    '-F', '/dev/null',
    '-i', keyPath,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', `UserKnownHostsFile=${sshd.knownHostsPath}`,
    '-o', 'StrictHostKeyChecking=yes',
    '-p', String(sshd.port),
    `${sshd.username}@127.0.0.1`,
    'true',
  ])
}

describe.skipIf(!SUPPORTED)('WP3 — the resolver produces credentials sshd accepts', () => {
  it('a reference resolving to a private key completes a real login', async () => {
    const vault = new InMemoryVault()
    const resource: CredentialResource = { type: 'host', id: 'host-key-1' }
    vault.seed(resource, 4, 'privateKey', sshd.identityKey)

    const resolver = new SessionCredentialResolver(vault)
    const resolved = await resolver.resolve({
      id: 'host-key-1',
      name: 'target',
      hostname: '127.0.0.1',
      port: sshd.port,
      username: sshd.username,
      authType: 'key',
      credentialRef: keyRef(4),
    })

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    // The resolver returns material, not a pointer: this is what the launcher
    // hands to `session_create_ssh_key`.
    expect(resolved.credential.privateKey).toBe(sshd.identityKey)

    const result = await connectWith(resolved.credential)
    expect(result.stderr).not.toMatch(/Permission denied|no such identity|cannot load/i)
    expect(result.code).toBe(0)
  }, 40_000)

  it('a version mismatch yields a failure rather than a wrong-but-plausible key', async () => {
    const vault = new InMemoryVault()
    const resource: CredentialResource = { type: 'host', id: 'host-key-2' }
    // Seeded at version 3; the row points at version 4.
    vault.seed(resource, 3, 'privateKey', sshd.identityKey)

    const resolver = new SessionCredentialResolver(vault)
    const resolved = await resolver.resolve({
      id: 'host-key-2',
      name: 'target',
      hostname: '127.0.0.1',
      port: sshd.port,
      username: sshd.username,
      authType: 'key',
      credentialRef: keyRef(4),
    })

    // The vault holds a *different* generation; the resolver must not fall back to
    // it. Connecting with an older key would be a login the user did not ask for.
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    expect(resolved.message).toMatch(/vault holds none|re-save/i)
  })

  it('a locked vault refuses instead of attempting an empty login', async () => {
    const vault = new InMemoryVault()
    const resource: CredentialResource = { type: 'host', id: 'host-key-3' }
    vault.seed(resource, 1, 'privateKey', sshd.identityKey)
    vault.locked = true

    const resolver = new SessionCredentialResolver(vault)
    const resolved = await resolver.resolve({
      id: 'host-key-3',
      name: 'target',
      hostname: '127.0.0.1',
      port: sshd.port,
      username: sshd.username,
      authType: 'key',
      credentialRef: keyRef(1),
    })

    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    expect(resolved.message).toMatch(/locked|unlock/i)
  })

  it('a decrypt failure is reported as a failure, not as "no credential"', async () => {
    const vault = new InMemoryVault()
    const resource: CredentialResource = { type: 'host', id: 'host-key-4' }
    vault.seed(resource, 1, 'privateKey', sshd.identityKey)
    vault.failing.add('privateKey')

    const resolver = new SessionCredentialResolver(vault)
    const resolved = await resolver.resolve({
      id: 'host-key-4',
      name: 'target',
      hostname: '127.0.0.1',
      port: sshd.port,
      username: sshd.username,
      authType: 'key',
      credentialRef: keyRef(1),
    })

    // "The vault holds none" and "the vault could not decrypt it" are different
    // problems with different fixes; collapsing them sends the user to re-save a
    // credential that is actually intact.
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    expect(resolved.message).not.toMatch(/records a stored .* but the vault holds none/i)
  })

  it('the resolver never returns a value for a kind the reference does not name', async () => {
    const vault = new InMemoryVault()
    const resource: CredentialResource = { type: 'host', id: 'host-key-5' }
    // A password is stored, but the reference names only the key.
    vault.seed(resource, 1, 'password', 'should-never-be-returned')

    const resolver = new SessionCredentialResolver(vault)
    const resolved = await resolver.resolve({
      id: 'host-key-5',
      name: 'target',
      hostname: '127.0.0.1',
      port: sshd.port,
      username: sshd.username,
      authType: 'key',
      credentialRef: { kinds: ['privateKey'], provider: 'vault', version: 1 },
    })

    if (resolved.ok) {
      expect(resolved.credential.password).toBeUndefined()
      expect(resolved.credential.privateKey).toBeUndefined()
    } else {
      // Failing is also correct: the reference promised a key that is not there.
      expect(resolved.message).toMatch(/vault holds none|re-save/i)
    }
  })
})
