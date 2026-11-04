import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const run = promisify(execFile)

async function withIsolationDirectory(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cold-start-isolation-'))
  try {
    await callback(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function writeSamples(directory, overrides = {}) {
  const forced = {
    ok: false,
    binarySha256: 'a'.repeat(64),
    fixture: { port: 65_000 },
    tempDirectories: {
      home: path.join(directory, 'missing-home'),
      runDirectory: path.join(directory, 'missing-fixture'),
    },
    cleanupErrors: [],
    ...overrides.forced,
  }
  const control = {
    ok: true,
    binarySha256: 'a'.repeat(64),
    fixture: { port: 65_001 },
    stages: [
      {
        stage: 'terminal-mounted',
        atMs: 900,
        detail: 'remote-cold-tab@workspace@remote',
      },
      { stage: 'ssh-connect-start', atMs: 1_000 },
    ],
    ...overrides.control,
  }
  await writeFile(path.join(directory, 'forced.json'), JSON.stringify(forced))
  await writeFile(path.join(directory, 'control.json'), JSON.stringify(control))
}

test('passes when the forced timeout left no directories and the control used a fresh fixture', async () => {
  await withIsolationDirectory(async directory => {
    await writeSamples(directory)
    await run('node', ['scripts/verify-cold-start-isolation.mjs', directory])
    const result = JSON.parse(
      await readFile(path.join(directory, 'result.json'), 'utf8'),
    )
    assert.equal(result.verdict, 'ISOLATION_PASS')
    assert.deepEqual(result.problems, [])
  })
})

test('fails when the forced timeout left its temporary home behind', async () => {
  await withIsolationDirectory(async directory => {
    await writeSamples(directory, {
      forced: {
        tempDirectories: {
          home: directory,
          runDirectory: path.join(directory, 'missing-fixture'),
        },
      },
    })
    await assert.rejects(
      run('node', ['scripts/verify-cold-start-isolation.mjs', directory]),
    )
    const result = JSON.parse(
      await readFile(path.join(directory, 'result.json'), 'utf8'),
    )
    assert.equal(result.verdict, 'ISOLATION_FAIL')
    assert.match(result.problems.join(' '), /left home behind/)
  })
})

test('fails when the control reused the forced fixture port', async () => {
  await withIsolationDirectory(async directory => {
    await writeSamples(directory, {
      control: { fixture: { port: 65_000 } },
    })
    await assert.rejects(
      run('node', ['scripts/verify-cold-start-isolation.mjs', directory]),
    )
  })
})

test('accepts a control that reached SSH but missed the prompt marker', async () => {
  await withIsolationDirectory(async directory => {
    await writeSamples(directory, {
      control: {
        ok: false,
        error: 'the remote shell produced output, but the prompt marker did not complete',
      },
    })
    await run('node', ['scripts/verify-cold-start-isolation.mjs', directory])
    const result = JSON.parse(
      await readFile(path.join(directory, 'result.json'), 'utf8'),
    )
    assert.equal(result.verdict, 'ISOLATION_PASS')
    assert.equal(result.control.ok, false)
    assert.equal(result.control.mountedRemote, true)
    assert.equal(result.control.enteredSsh, true)
  })
})

test('fails when the control never mounted a remote terminal', async () => {
  await withIsolationDirectory(async directory => {
    await writeSamples(directory, {
      control: {
        ok: false,
        stages: [{ stage: 'frontend-boot', atMs: 0 }],
      },
    })
    await assert.rejects(
      run('node', ['scripts/verify-cold-start-isolation.mjs', directory]),
    )
    const result = JSON.parse(
      await readFile(path.join(directory, 'result.json'), 'utf8'),
    )
    assert.equal(result.verdict, 'ISOLATION_FAIL')
    assert.match(result.problems.join(' '), /did not mount a remote terminal/)
  })
})
