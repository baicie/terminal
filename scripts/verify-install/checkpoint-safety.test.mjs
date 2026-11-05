import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { delay } from './process-lifecycle.mjs'

const nodeFlag = (() => {
  try {
    execFileSync(process.execPath, ['-e', 'require("node:sqlite")'], { stdio: 'ignore' })
    return []
  } catch {
    return ['--experimental-sqlite']
  }
})()

const sqliteAvailable = (() => {
  try {
    execFileSync(process.execPath, [...nodeFlag, '-e', 'require("node:sqlite")'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

test('checkpoint fails closed while another connection holds a read transaction', { skip: !sqliteAvailable }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'checkpoint-safety-'))
  const db = path.join(dir, 'terminal.db')
  const ready = path.join(dir, 'ready')
  const holder = spawn(process.execPath, [...nodeFlag, '-e', `
    const { DatabaseSync } = require('node:sqlite')
    const fs = require('node:fs')
    const db = new DatabaseSync(${JSON.stringify(db)})
    db.exec('PRAGMA journal_mode=WAL')
    db.exec('CREATE TABLE t(x INTEGER)')
    db.exec('INSERT INTO t VALUES (1)')
    const reader = new DatabaseSync(${JSON.stringify(db)})
    reader.exec('BEGIN')
    reader.prepare('SELECT * FROM t').all()
    fs.writeFileSync(${JSON.stringify(ready)}, '1')
    setInterval(() => {}, 1000)
  `], { stdio: ['ignore', 'ignore', 'inherit'] })
  try {
    for (let index = 0; index < 100 && !existsSync(ready); index += 1) {
      await delay(20)
    }
    assert.equal(existsSync(ready), true, 'holder did not open its read transaction')
    const result = spawnSync(process.execPath, [...nodeFlag,
      path.resolve('scripts/verify-install/data-retention.mjs'),
      'checkpoint', '--db', db,
    ], { encoding: 'utf8' })
    assert.notEqual(result.status, 0, 'busy checkpoint must not report success')
    assert.match(result.stdout + result.stderr, /busy|checkpoint/i)
  } finally {
    holder.kill('SIGKILL')
    await new Promise(resolve => holder.once('close', resolve))
  }
})
