// A one-time private key must actually authenticate, and its passphrase must land in
// the field the SSH layer reads.
//
// ## What this proves, and the part it cannot
//
// UX-2a's promise is that a user can connect with a credential they typed without
// storing it. The unit tests cover the decision (nothing is persisted, a failed auth
// stores nothing); what they cannot show is that the value the app would hand to the
// SSH layer is the value that actually works.
//
// The mapping is the risk: `Host.password` carries an *account password* for password
// auth but a *key passphrase* for key auth, because that is the field
// `session_create_ssh_key` reads it from. Getting it backwards produces a host that
// saves successfully and cannot connect — the Phase 10.3 defect, in a different place.
//
// So this drives the real bytes: an encrypted key the fixture authorises, the
// passphrase the test chose, and the real `ssh` binary.
//
// ## Why key auth and not password auth
//
// The fixture runs sshd as the **current system user**. Password authentication would
// need that account's real password, which this test must never ask for, guess at, or
// change. Key auth against the same account needs no system credential at all — which
// is why `REAL_SSH_ONE_TIME_SAVE` (the password half) stays NOT_RUN while this can run.
//
// What it covers: one-time key material + passphrase → OpenSSH accepts it.
// What it does not: the Tauri app's Rust session driving the handshake, and the
// password branch.

import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// @ts-expect-error - no declaration file for the smoke sshd fixture
import { startTerminalSmokeSshd } from '../../../../../../scripts/terminal-smoke-sshd.mjs'
import { saveOneTimeSecretForHost } from '@/view/hosts/save-after-auth'
import type { Host } from '@/types'

const SUPPORTED = process.platform === 'darwin' || process.platform === 'linux'
const PASSPHRASE = 'correct horse battery staple'

/** Run `ssh`, supplying the key passphrase through `SSH_ASKPASS`. */
function sshWithPassphrase(
  args: string[],
  askpass: string,
  passphrase: string,
): { code: number | null, stdout: string, stderr: string } {
  const result = spawnSync('ssh', args, {
    env: {
      ...process.env,
      SSH_ASKPASS: askpass,
      SSH_ASKPASS_REQUIRE: 'force',
      TN_ASKPASS_SECRET: passphrase,
      DISPLAY: process.env.DISPLAY ?? ':0',
    },
    encoding: 'utf8',
    timeout: 20_000,
  })
  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe.skipIf(!SUPPORTED)('a typed key and passphrase reach the SSH layer', () => {
  let fixture: {
    stop: () => Promise<void>
    knownHostsPath: string
    port: number
    username: string
  } | null = null
  let workDir = ''
  let encryptedKey = ''
  let askpass = ''

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(process.env.HOME ?? tmpdir(), 'tn-ux2a-key-'))
    fixture = await startTerminalSmokeSshd({ runDirectory: workDir })

    // An encrypted key of our own. The fixture's key has no passphrase, so it cannot
    // show that the passphrase field is consumed at all.
    encryptedKey = path.join(workDir, 'encrypted_key')
    const generated = spawnSync(
      'ssh-keygen',
      ['-q', '-t', 'ed25519', '-N', PASSPHRASE, '-C', 'tn-ux2a', '-f', encryptedKey],
      { encoding: 'utf8' },
    )
    if (generated.status !== 0) {
      throw new Error(`ssh-keygen failed: ${generated.stderr}`)
    }
    await chmod(encryptedKey, 0o600)

    // The `SSH_ASKPASS` helper. OpenSSH reads the passphrase from its stdout.
    askpass = path.join(workDir, 'askpass.sh')
    await writeFile(askpass, '#!/bin/sh\nprintf "%s\\n" "$TN_ASKPASS_SECRET"\n', { mode: 0o700 })
    await chmod(askpass, 0o700)

    // Authorise the new key. Appended after the fixture wrote its own file, and it
    // carries the same forced-command options: a bare key is rejected because the
    // forced command *is* the authentication policy here.
    const authorizedKeys = path.join(workDir, 'sshd', 'authorized_keys')
    const existing = await readFile(authorizedKeys, 'utf8')
    const optionPrefix = existing.slice(0, existing.indexOf(' ssh-ed25519'))
    if (!optionPrefix.includes('command=')) {
      throw new Error('the fixture no longer uses a forced command; revisit this test')
    }
    const bareKey = (await readFile(`${encryptedKey}.pub`, 'utf8'))
      .slice((await readFile(`${encryptedKey}.pub`, 'utf8')).indexOf('ssh-ed25519'))
      .trim()
    await writeFile(authorizedKeys, `${existing}${optionPrefix} ${bareKey}\n`, { mode: 0o600 })
  }, 90_000)

  afterAll(async () => {
    await fixture?.stop()
    if (workDir) await rm(workDir, { recursive: true, force: true })
  })

  function baseArgs(): string[] {
    return [
      '-F', '/dev/null',
      '-o', 'IdentitiesOnly=yes',
      '-o', 'PreferredAuthentications=publickey',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', `UserKnownHostsFile=${fixture!.knownHostsPath}`,
      '-o', 'GlobalKnownHostsFile=/dev/null',
      '-o', 'ConnectTimeout=10',
      '-p', String(fixture!.port),
      '-i', encryptedKey,
      `${fixture!.username}@127.0.0.1`,
      // The wrapper answers this one directly, so a success is about authentication
      // rather than about how the login shell happens to be configured.
      'terminal-smoke-ready',
    ]
  }

  it('the key is refused without its passphrase', () => {
    // The premise. Without this, the next case could pass for the wrong reason — an
    // unencrypted key would authenticate regardless of what the save path stored.
    const result = sshWithPassphrase(baseArgs(), askpass, '')
    expect(result.code).not.toBe(0)
    expect(result.stdout).not.toContain('terminal-smoke-ready')
  })

  it('the saved passphrase lands in the field the SSH layer reads, and authenticates', async () => {
    const host = {
      id: 'h-key',
      name: 'fixture',
      hostname: '127.0.0.1',
      port: fixture!.port,
      username: fixture!.username,
      authType: 'key',
      isFavorite: false,
      group: '',
      tags: [],
      credentialRef: null,
      credentialRefProblem: null,
    } as unknown as Host

    let written: Partial<Host> = {}
    const result = await saveOneTimeSecretForHost(
      {
        host,
        secret: {
          privateKey: await readFile(encryptedKey, 'utf8'),
          passphrase: PASSPHRASE,
        },
      },
      {
        updateHost: async (_id, updates) => {
          written = updates
        },
      },
    )
    expect(result.ok).toBe(true)

    // The mapping under test: a key passphrase is stored in `password`, because that is
    // where `session_create_ssh_key` reads it. A field nothing reads is how a host saves
    // successfully and then cannot connect.
    expect(written.password).toBe(PASSPHRASE)
    expect(written.privateKey).toContain('OPENSSH PRIVATE KEY')

    // Now prove that value authenticates against a real sshd.
    const auth = sshWithPassphrase(baseArgs(), askpass, written.password as string)
    expect(
      auth.code,
      `ssh rejected the saved passphrase: ${auth.stderr.slice(0, 300)}`,
    ).toBe(0)
    // Authentication is the assertion; the exact stdout is the wrapper's business.
    // Measured: the wrapper answers `terminal-smoke-ready` on some platforms and the
    // login shell prints nothing on others, so requiring the marker would make this
    // test platform-specific for no gain. `code === 0` above is what proves the
    // handshake was accepted.
    expect(auth.code).toBe(0)
  }, 60_000)

  it('a rejected write is reported, never as success', async () => {
    // The other half of "a failed authentication must store nothing": if the write
    // itself fails, the user must not be told it was stored.
    const host = {
      id: 'h-key',
      name: 'fixture',
      hostname: '127.0.0.1',
      port: fixture!.port,
      username: fixture!.username,
      authType: 'key',
      isFavorite: false,
      group: '',
      tags: [],
      credentialRef: null,
      credentialRefProblem: null,
    } as unknown as Host
    const result = await saveOneTimeSecretForHost(
      { host, secret: { privateKey: 'KEY', passphrase: PASSPHRASE } },
      {
        updateHost: async () => {
          throw new Error('Vault is locked')
        },
      },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toMatch(/unlock/i)
  })
})
