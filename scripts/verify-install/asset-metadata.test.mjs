import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  archFromFileName,
  sha256File,
  verifyExpected,
  versionFromFileName,
} from './asset-metadata.mjs'

test('reads the version from a published asset filename', () => {
  assert.equal(
    versionFromFileName('Terminal_0.0.1-dev.2_macos-aarch64.dmg'),
    '0.0.1-dev.2',
  )
  assert.equal(
    versionFromFileName('Terminal_0.0.1-dev.1_linux-x86_64.AppImage'),
    '0.0.1-dev.1',
  )
  assert.equal(versionFromFileName('terminal.app'), null)
})

test('normalizes the architecture from a published asset filename', () => {
  assert.equal(archFromFileName('Terminal_0.0.1-dev.2_macos-aarch64.dmg'), 'arm64')
  assert.equal(archFromFileName('Terminal_0.0.1-dev.2_linux-x86_64.deb'), 'x64')
  assert.equal(archFromFileName('Terminal_0.0.1-dev.2_macos-universal.dmg'), 'universal')
  assert.equal(archFromFileName('Terminal_0.0.1-dev.2.dmg'), null)
})

test('rejects a digest or identity that does not match the artifact', () => {
  assert.deepEqual(
    verifyExpected(
      { sha256: 'a'.repeat(64), version: '0.0.1-dev.1', identifier: 'com.baicie.termius' },
      { sha256: 'b'.repeat(64), version: '0.0.1-dev.2', identifier: 'com.other' },
    ).length,
    3,
  )
  assert.deepEqual(
    verifyExpected(
      { sha256: 'a'.repeat(64), version: '0.0.1-dev.1', identifier: 'com.baicie.termius' },
      { sha256: 'a'.repeat(64), version: '0.0.1-dev.1', identifier: 'com.baicie.termius' },
    ),
    [],
  )
})

test('computes the sha256 of the exact bytes on disk', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'asset-sha-'))
  try {
    const file = path.join(directory, 'asset.bin')
    await writeFile(file, 'phase95\n')
    assert.equal(
      sha256File(file),
      '2adddbf4eb49ac973165545bb3e804357b4aa2fd7570a3c5a4ccc71ddc86947c',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
