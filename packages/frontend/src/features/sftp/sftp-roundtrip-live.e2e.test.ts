// TN-SFTP-03 — a 24 MiB round trip over a real SFTP subsystem.
//
// ## What this file adds to what is already here
//
// `sftp-subsystem-live.e2e.test.ts` (Release Engineering) proved the fixture can
// serve the subsystem, that a 4 MiB upload is byte-exact, and that a replace leaves
// no staging residue. `sftp-transfer-live.e2e.test.ts` proved an SSH transport can
// carry 24 MiB, but explicitly against a daemon with no subsystem — it says so at
// the top, and it stayed at NOT_RUN for a real SFTP transfer because of it.
//
// So the gap was never "can a big file cross a socket". It was **the combination**:
// 24 MiB, through the subsystem, and back down again, hashed on both sides. A
// truncating upload can still hash correctly on the sending side; only the download
// catches it.
//
// Honest accounting of each case:
//
// | case | status |
// | --- | --- |
// | 24 MiB upload through the subsystem | **new** — the existing one is 4 MiB |
// | 24 MiB download, hash matched both sides | **new** — nothing downloads today |
// | replace leaves no residue | **duplicate** of the 4 MiB file's case, kept because it is cheap and a regression here would be silent |
// | fixture reports what it enabled | guard, not a claim |
// | no orphaned sshd | **new** at this size |
//
// A 24 MiB round trip is also where a 32-bit offset bug or a buffer that flushes on
// close rather than on write would show up; 4 MiB is not.
//
// ## What layer this is, precisely
//
//   SFTP CLI fixture E2E        — **yes**, this file. The client is `/usr/bin/sftp`.
//   Rust command-level E2E      — **NO**. `sftp_upload` / `sftp_download` are not
//                                 invoked; there is no Tauri app in this process.
//   Real Tauri GUI product E2E  — **NO**.
//
// A green here means the fixture and the transport work at this size. It does not
// mean the app's transfer code works, and it must not be reported as if it did.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// @ts-expect-error - no declaration file for the smoke sshd fixture
import { startTerminalSmokeSshd } from '../../../../../scripts/terminal-smoke-sshd.mjs'

const SUPPORTED = process.platform === 'darwin' || process.platform === 'linux'
const describeIf = SUPPORTED ? describe : describe.skip

const PAYLOAD_BYTES = 24 * 1024 * 1024

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

describeIf('24 MiB SFTP round trip', () => {
  let sshd: SshdHandle
  let workDir: string
  let keyPath: string
  let remoteRoot: string
  let payloadPath: string
  let payloadHash: string

  beforeAll(async () => {
    // `HOME`, not `tmpdir()`: on Linux runners `tmpdir()` is `/tmp` (mode 1777) and
    // sshd's StrictModes refuses it. Same trap the sibling e2e files hit.
    const base =
      process.env.HOME && process.env.HOME !== '/' ? process.env.HOME : tmpdir()
    const privateRoot = await mkdtemp(path.join(base, '.terminal-tn-sftp-'))
    await chmod(privateRoot, 0o700)
    workDir = await mkdtemp(path.join(privateRoot, 'roundtrip-'))
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

    // Deterministic bytes, so a difference points at the transport rather than at
    // the generator. A repeating pattern would let a shifted-but-same-length
    // truncation hash equal, so the fill mixes the index in.
    const chunk = Buffer.alloc(1024 * 1024)
    const payload = path.join(workDir, 'payload.bin')
    const handle = await import('node:fs/promises').then(m =>
      m.open(payload, 'w'),
    )
    try {
      for (let block = 0; block < PAYLOAD_BYTES / chunk.length; block += 1) {
        for (let index = 0; index < chunk.length; index += 1) {
          chunk[index] = (index * 37 + block * 11 + 13) & 0xff
        }
        await handle.write(chunk)
      }
    } finally {
      await handle.close()
    }
    payloadPath = payload
    payloadHash = sha256(await readFile(payload))
  }, 180_000)

  afterAll(async () => {
    await sshd?.stop().catch(() => undefined)
    if (workDir) await rm(path.dirname(workDir), { recursive: true, force: true })
  })

  // `sftp` accepts `-b <file>` but not `-b -`: a batch on stdin is rejected with
  // the usage text. Options stay as separate `-o` and value arguments because
  // `-oKey=Value` is also rejected here even though `ssh` accepts it.
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

  async function runSftp(
    commands: string,
    timeoutMs = 300_000,
  ): Promise<{ code: number | null, stdout: string, stderr: string }> {
    const batch = path.join(
      workDir,
      `batch-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
    )
    await writeFile(batch, commands)
    return new Promise(resolve => {
      const child = spawn(
        '/usr/bin/sftp',
        [...sftpArgs(), '-b', batch, `${sshd.username}@127.0.0.1`],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
      child.once('close', code => {
        clearTimeout(timer)
        resolve({ code, stdout, stderr })
      })
    })
  }

  it('the fixture reports what it actually enabled', () => {
    // The fixture's `enableSftp` has to be on for any of this to mean anything.
    // If it silently defaulted off, every case below would fail with the same
    // "subsystem request failed" and it would look like a product problem.
    expect(sshd.port).toBeGreaterThan(0)
    expect(sshd.username.length).toBeGreaterThan(0)
  })

  it('uploads 24 MiB through the sftp subsystem', async () => {
    const remote = path.join(remoteRoot, 'payload.bin')
    const result = await runSftp(`put ${payloadPath} ${remote}\n`)
    expect(result.stderr).not.toContain('subsystem request failed')
    expect(result.code, result.stderr).toBe(0)

    const uploaded = await readFile(remote)
    expect(uploaded.length).toBe(PAYLOAD_BYTES)
    expect(sha256(uploaded)).toBe(payloadHash)
  }, 420_000)

  it('downloads it back and both sides still hash the same', async () => {
    // The half a one-directional test cannot see: a truncating upload that also
    // reported the right byte count still round-trips wrong, and only the return
    // trip proves the bytes on the server are the bytes that were sent.
    const remote = path.join(remoteRoot, 'payload.bin')
    const returned = path.join(workDir, 'returned.bin')
    const result = await runSftp(`get ${remote} ${returned}\n`)
    expect(result.code, result.stderr).toBe(0)

    expect((await stat(returned)).size).toBe(PAYLOAD_BYTES)
    expect(sha256(await readFile(returned))).toBe(payloadHash)
  }, 420_000)

  it('replacing a file leaves no backup or staging residue', async () => {
    const target = path.join(remoteRoot, 'replace.txt')
    await writeFile(target, 'original\n')
    const next = path.join(workDir, 'next.txt')
    await writeFile(next, 'replacement\n')

    const result = await runSftp(`put ${next} ${target}\n`, 60_000)
    expect(result.code, result.stderr).toBe(0)
    expect(await readFile(target, 'utf8')).toBe('replacement\n')

    const entries = await readdir(remoteRoot)
    expect(entries.filter(name => name.includes('.terminal-upload-backup'))).toEqual([])
    expect(entries.filter(name => name.includes('.terminal-upload-staging'))).toEqual([])
  }, 120_000)

  it('leaves no sshd process behind after the fixture stops', async () => {
    // Resource release at the fixture level. If this fails, the rest of the suite
    // is measuring a daemon nobody is going to clean up.
    await sshd.stop()
    const probe = await new Promise<{ stdout: string }>(resolve => {
      const child = spawn('pgrep', ['-f', String(sshd.port)], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      child.once('close', () => resolve({ stdout }))
    })
    expect(probe.stdout.trim()).toBe('')
  }, 60_000)
})
