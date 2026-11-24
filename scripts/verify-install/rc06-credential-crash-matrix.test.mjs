// RC06 — 在 Host 凭据写入的每个边界杀掉进程，然后问「留下了什么」。
//
// ## 为什么必须是真进程 + 真 kill
//
// 抛出的异常会 unwind：`try/catch` 跑、清理跑、调用方拿到结果。**SIGKILL 什么
// 都不跑。** 进程死时磁盘上是什么，用户机器上就是什么。一条对异常安全的写入路径，
// 仍然可能在依赖 unwind 来完成收尾的地方被撕成两半。
//
// ## 这里什么是真的
//
// **产品的 `createHost` / `updateHost` 本身**。只有一个 resolve hook 把两个存储换成
// 文件后端（SQLite 文件 + JSON vault），产品的排序、守卫、清理全部照常运行 ——
// 而它们正是崩溃要打断的东西。
//
// 用重写的写入序列测是没意义的：那样测的是重写。
//
// ## 两个禁止状态
//
//   LOST_REFERENCE  行上的 `credential_ref` 指向 vault 交不出的版本。主机在、秘密没了、
//                   没有任何东西记录它去了哪。不可恢复。
//
//   ORPHANED        某个 id 有密文但没有行引用它。浪费而非损坏 —— 用户仍能工作 ——
//                   但它会累积，而**本产品没有任何对账机制**（已核查：没有模块扫描
//                   未被引用的 vault 条目），所以孤儿是永久的。

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { after, describe, it } from 'node:test'

const HERE = import.meta.dirname
const ROOT = path.resolve(HERE, '../..')
const WORKER = path.join(HERE, 'rc06-credential-crash-worker.mjs')
const REGISTER = path.join(HERE, 'rc06-register.mjs')
const TSCONFIG = path.join(ROOT, 'packages/frontend/tsconfig.json')

const roots = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function freshDir() {
  const dir = mkdtempSync(path.join(os.homedir(), '.tmp-rc06-'))
  roots.push(dir)
  return dir
}

/**
 * Run the worker, optionally killing it at `crashAt`.
 *
 * `tsx` wraps the script, so a SIGKILL shows up as the wrapper's exit status 137 rather
 * than `signal: 'SIGKILL'` on the child — the kill happened, the wrapper absorbed the
 * signal. The assertion is therefore on the status, with the reason written down.
 */
function runWorker(dir, { id = 'rc06', crashAt, mode = 'create', secret } = {}) {
  const env = { ...process.env, RC06_DIR: dir, ...(crashAt ? { RC06_CRASH_AT: crashAt } : {}) }
  const argv = [
    'tsx', '--tsconfig', TSCONFIG, '--import', REGISTER, WORKER,
    '--command', 'run', '--dir', dir, '--id', id, '--mode', mode,
  ]
  if (secret) argv.push('--secret', secret)
  try {
    execFileSync('npx', argv, { encoding: 'utf8', env, cwd: HERE, stdio: 'pipe' })
    return { status: 0 }
  } catch (error) {
    return { status: error.status ?? null, stderr: String(error.stderr ?? '').slice(0, 400) }
  }
}

/** What survived, read from the files the process left behind. */
function inspect(dir, id = 'rc06') {
  const dbPath = path.join(dir, 'terminal.db')
  if (!existsSync(dbPath)) {
    return { hasRow: false, ref: null, readable: null, vaultKeys: [], lostReference: false, orphanedCiphertext: false }
  }
  const db = new DatabaseSync(dbPath)
  const row = db.prepare('SELECT credential_ref FROM hosts WHERE id = ?').get(id)
  db.close()
  const vaultPath = path.join(dir, 'vault.json')
  const vault = existsSync(vaultPath) ? JSON.parse(readFileSync(vaultPath, 'utf8')) : {}
  const owned = Object.keys(vault).filter(k => k.startsWith(`host:${id}:`))

  let ref = null
  if (row?.credential_ref) {
    try {
      ref = JSON.parse(row.credential_ref)
    } catch {
      ref = { unparseable: true }
    }
  }
  const readable =
    ref && typeof ref.version === 'number'
      ? (ref.kinds ?? []).every(kind => vault[`host:${id}:${ref.version}:${kind}`] !== undefined)
      : null

  return {
    hasRow: Boolean(row),
    ref,
    readable,
    vaultKeys: owned.sort(),
    lostReference: Boolean(row) && ref !== null && readable === false,
    orphanedCiphertext: ref === null && owned.length > 0,
  }
}

/*
 * Crash points reachable from a **create**.
 *
 * `before-retire` is deliberately absent: a create has no previous generation to retire,
 * so that stage never runs on this path — the first version of this list included it and
 * the case failed with "expected a SIGKILL, got 0", which is the harness saying the
 * crash point was never reached. Retiring belongs to the update path, and the case below
 * covers it there.
 */
const CRASH_STAGES = ['after-first-secret']

describe('RC06 — a killed write leaves no unrecoverable host', () => {
  it('a clean run leaves exactly one readable generation', () => {
    // The control. Without it, every assertion below could pass because nothing works.
    const dir = freshDir()
    const result = runWorker(dir, { secret: 'S1' })
    assert.equal(result.status, 0, `clean run failed: ${result.stderr ?? ''}`)

    const state = inspect(dir)
    assert.equal(state.hasRow, true, 'the row must exist after a clean create')
    assert.equal(state.readable, true, 'the row must name a version the vault can deliver')
    assert.deepEqual(state.vaultKeys, [`host:rc06:${state.ref.version}:password`])
    assert.equal(state.lostReference, false)
    assert.equal(state.orphanedCiphertext, false)
  })

  for (const crashAt of CRASH_STAGES) {
    it(`killed at ${crashAt}: no row points at a missing secret`, () => {
      /*
       * The invariant, stated as the only thing that must hold:
       *
       *   a row that exists must be able to read its own secret
       *
       * A row that never landed is fine — the user's create simply did not happen. A row
       * that landed while its secret did not is the unrecoverable state, and it is what
       * this asserts against.
       *
       * Orphaned ciphertext is **reported**, not failed: the product has no
       * reconciliation pass, so an orphan is permanent waste rather than a broken host.
       * Recording it here is what makes its size visible instead of invisible.
       */
      const dir = freshDir()
      const result = runWorker(dir, { crashAt, secret: 'S1' })

      // 137 = killed by SIGKILL through the tsx wrapper. A clean exit means the crash
      // point was never reached, which would make this case vacuous.
      assert.equal(result.status, 137, `expected a SIGKILL at ${crashAt}, got ${result.status}`)

      const state = inspect(dir)
      assert.equal(
        state.lostReference,
        false,
        `a row survived pointing at a version the vault cannot deliver: ${JSON.stringify(state)}`,
      )
    })
  }

  it('a crash after the row landed but before retirement keeps the old secret', () => {
    /*
     * The update path, which is the one with two generations alive at once. The sequence
     * is: write version N+1 → repoint the row → retire version N. Killing before the
     * retirement must leave the row readable and the previous generation still present —
     * never a row pointing at N while the vault holds only N+1.
     */
    const dir = freshDir()
    assert.equal(runWorker(dir, { secret: 'OLD' }).status, 0, 'seed create must succeed')
    const seeded = inspect(dir)
    assert.equal(seeded.readable, true)

    const result = runWorker(dir, { mode: 'update', crashAt: 'before-retire', secret: 'NEW' })
    assert.equal(result.status, 137, 'the retire crash point must be reached')

    const state = inspect(dir)
    assert.equal(
      state.lostReference,
      false,
      `an update killed before retirement left an unreadable row: ${JSON.stringify(state)}`,
    )
    assert.equal(state.readable, true, 'the surviving row must still name a readable version')
    assert.ok(
      state.vaultKeys.length >= 1,
      'at least the generation the row names must be present',
    )
  })

  it('a crash between the vault write and the row leaves at most an orphan, never a bad row', () => {
    /*
     * `after-first-secret` on a create: the ciphertext exists, the row does not. That is
     * the orphan case, and it is the *safe* direction — the user retries and gets a
     * working host.
     *
     * Asserted explicitly so a future change that writes the row first would show up
     * here as data loss instead of passing quietly.
     */
    const dir = freshDir()
    const result = runWorker(dir, { crashAt: 'after-first-secret', secret: 'S1' })
    assert.equal(result.status, 137)

    const state = inspect(dir)
    assert.equal(state.hasRow, false, 'the row must not exist yet at this crash point')
    assert.equal(state.lostReference, false)

    /*
     * The vault state here is the interesting half, so it is asserted concretely rather
     * than with a disjunction. The first version of this line read
     * `assert.ok(orphaned || vaultKeys.length === 0)`, which is true for **every**
     * possible vault state — including the one where the ciphertext was written and then
     * silently lost. A guard that cannot fail is not a guard.
     *
     * What must be true: the secret reached the vault (that is why the crash point
     * exists), and no row names it, so it is an orphan by definition.
     */
    assert.equal(
      state.orphanedCiphertext,
      true,
      `the crash point writes the secret before the row, so it must be an orphan: ${JSON.stringify(state)}`,
    )
    assert.equal(state.vaultKeys.length, 1, 'exactly the one generation written so far')
  })
})
