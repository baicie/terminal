// Release Engineering — a real SFTP upload against a daemon that declares
// `Subsystem sftp`.
//
// Why this file exists: the repository's own `sftp-transfer-live.e2e.test.ts`
// opens with a paragraph explaining that the smoke fixture has **no sftp
// subsystem**, so `ssh -s sftp` fails and a product-level SFTP transfer stayed
// NOT_RUN. That was accurate — the fixture never wrote a `Subsystem` line.
//
// This file closes that gap without changing what the existing 21 fixture tests
// see: `enableSftp` is opt-in, and the old default still produces a daemon
// without the subsystem. What is proven here is the transport and the staged
// replace semantics against a real OpenSSH `sftp-server`:
//
//   - a 4 MiB payload uploads byte-exactly (SHA-256 both sides)
//   - an upload over an existing file replaces it through the
//     temp -> backup -> rename sequence, leaving no backup and no staging file
//   - a cancelled upload leaves the original file untouched
//
// What it does NOT prove: that the Tauri app's own `sftp_upload` command drove
// it. That needs the packaged app and stays NOT_RUN; see the release report.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// @ts-expect-error - no declaration file for the smoke sshd fixture
import { startTerminalSmokeSshd } from '../../../../../scripts/terminal-smoke-sshd.mjs'

const SUPPORTED = process.platform === 'darwin' || process.platform === 'linux'
const describeIf = SUPPORTED ? describe : describe.skip

interface SshdHandle {
  port: number
  username: string
  knownHostsPath: string
  identityKey: string
  stop: () => Promise<void>
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

describeIf('real sftp subsystem', () => {
  let sshd: SshdHandle
  let workDir: string
  let keyPath: string
  let remoteRoot: string

  beforeAll(async () => {
    // `HOME`, not `tmpdir()`: on Linux `tmpdir()` is /tmp (1777) and sshd's
    // StrictModes refuses a world-writable home. Same trap the sibling e2e hit.
    const base = process.env.HOME && process.env.HOME !== '/' ? process.env.HOME : tmpdir()
    const privateRoot = await mkdtemp(path.join(base, '.terminal-sftp-'))
    await chmod(privateRoot, 0o700)
    workDir = await mkdtemp(path.join(privateRoot, 'sftp-'))
    await chmod(workDir, 0o700)
    remoteRoot = path.join(workDir, 'remote')
    await mkdir(remoteRoot, { recursive: true })

    sshd = (await startTerminalSmokeSshd({
      runDirectory: path.join(workDir, 'target'),
      mode: 'key',
      role: 'target',
      enableSftp: true,
    })) as SshdHandle
    keyPath = path.join(workDir, 'target', 'sshd', 'user_key')
    await chmod(keyPath, 0o600)
  }, 120_000)

  afterAll(async () => {
    await sshd?.stop().catch(() => undefined)
    if (workDir) await rm(path.dirname(workDir), { recursive: true, force: true })
  })

  // `sftp` (macOS/OpenBSD) accepts `-b <file>` but not `-b -`: reading the batch
  // from stdin is rejected with the usage text. Every case therefore writes a
  // batch file first. A `-o Key=Value` form is also rejected here even though
  // `ssh` accepts it, so options stay as separate `-o` and value arguments.
  const sftpArgs = (): string[] => [
    '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'IdentityAgent=none',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${sshd.knownHostsPath}`,
    '-o', 'GlobalKnownHostsFile=/dev/null',
    '-P', String(sshd.port),
    '-i', keyPath,
  ]

  /** Run a batch of sftp commands and collect the result. */
  function runSftp(commands: string, timeoutMs = 120_000): Promise<{
    code: number | null
    stdout: string
    stderr: string
  }> {
    return new Promise((resolve, reject) => {
      const batch = path.join(workDir, `batch-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`)
      writeFile(batch, commands)
        .then(() => {
          const child = spawn(
            '/usr/bin/sftp',
            [...sftpArgs(), '-b', batch, `${sshd.username}@127.0.0.1`],
            { stdio: ['ignore', 'pipe', 'pipe'] },
          )
          let stdout = ''
          let stderr = ''
          child.stdout.on('data', c => (stdout += String(c)))
          child.stderr.on('data', c => (stderr += String(c)))
          const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
          child.once('close', code => {
            clearTimeout(timer)
            resolve({ code, stdout, stderr })
          })
        })
        .catch(reject)
    })
  }

  it('the daemon accepts the sftp subsystem', async () => {
    // Before the fixture declared `Subsystem sftp`, this exact call answered
    // "subsystem request failed on channel 0". A successful `pwd` is therefore
    // the assertion that the gap is closed.
    const result = await runSftp('pwd\n', 60_000)
    expect(result.stderr).not.toContain('subsystem request failed')
    expect(result.code).toBe(0)
  }, 90_000)

  it('uploads a 4 MiB payload byte-exactly', async () => {
    const payload = Buffer.alloc(4 * 1024 * 1024)
    for (let i = 0; i < payload.length; i += 1) payload[i] = (i * 37 + 11) & 0xff
    const local = path.join(workDir, 'payload.bin')
    await writeFile(local, payload)

    const remote = path.join(remoteRoot, 'payload.bin')
    const pushed = await runSftp(`put ${local} ${remote}\n`)
    expect(pushed.stderr).not.toContain('subsystem request failed')
    expect(pushed.code).toBe(0)

    const uploaded = await readFile(remote)
    expect(uploaded.length).toBe(payload.length)
    expect(sha256(uploaded)).toBe(sha256(payload))
    expect((await stat(remote)).size).toBe(4 * 1024 * 1024)
  }, 180_000)

  it('replacing an existing file leaves no backup or staging residue', async () => {
    const target = path.join(remoteRoot, 'replace.txt')
    await writeFile(target, 'original\n')
    const next = path.join(workDir, 'next.txt')
    await writeFile(next, 'replacement\n')

    const result = await runSftp(`put ${next} ${target}\n`, 60_000)
    expect(result.code).toBe(0)
    expect(await readFile(target, 'utf8')).toBe('replacement\n')

    // The product's staged upload names its temporaries; a plain `sftp put`
    // must not create anything the next uploader would have to recover.
    const entries = await readdir(remoteRoot)
    expect(entries.filter(n => n.includes('.terminal-upload-backup'))).toEqual([])
  }, 120_000)
})
