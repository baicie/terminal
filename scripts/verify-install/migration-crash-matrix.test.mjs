// The credential migration, killed mid-flight.
//
// ## Why this needs a real process and a real kill
//
// `runCredentialMigration` takes injectable vault and store, so a unit test can make
// either throw. A thrown error unwinds — the `try/catch` around each row runs, the
// result records a failure, and the process continues. **SIGKILL does none of that.**
// Whatever is on disk when the process dies is what a user's machine has, and no
// cleanup path runs after the last write.
//
// That difference is the whole point. A migration that is safe against exceptions can
// still leave a row with no plaintext and no reference — the unrecoverable state —
// if it clears the column and then dies before writing the reference. Only a real kill
// at a real boundary can show whether that happens.
//
// ## What the invariant is
//
// Every row is in exactly one of:
//
//   plaintext, no ref   — not migrated; a retry takes it
//   no plaintext, ref   — migrated; the secret is in the vault at that version
//
// and never:
//
//   plaintext AND ref   — torn: two copies, and the ref may name an unverified version
//   neither             — lost: the secret is gone
//
// The harness records which state each row is in (`migration-worker.mjs inspect`), and
// these cases assert the two forbidden ones stay empty at every crash point.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '../..')
const WORKER = path.join(ROOT, 'scripts/verify-install/migration-worker.mjs')

/*
 * `node:sqlite` is built in from Node 22.5 (behind a flag). The migration itself is
 * frontend TypeScript run through `tsx`, so this needs both. Skips with the reason
 * rather than failing the suite on a Node that lacks either.
 */
const sqlite = await import('node:sqlite').catch(() => null)
const tsx = (() => {
  try {
    execFileSync(path.join(ROOT, 'node_modules/.bin/tsx'), ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

if (sqlite === null || !tsx) {
  test(
    'credential migration crash matrix',
    { skip: sqlite === null ? 'node:sqlite is unavailable' : 'tsx is unavailable' },
    () => {},
  )
} else {
  describeCrashMatrix()
}

function describeCrashMatrix() {
  /** A throwaway database and vault directory. */
  function workspace() {
    const dir = mkdtempSync(path.join(tmpdir(), 'migration-crash-'))
    return {
      db: path.join(dir, 'terminal.db'),
      vault: path.join(dir, 'vault'),
      stages: path.join(dir, 'stages.log'),
      dir,
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    }
  }

  const tsxBin = path.join(ROOT, 'node_modules/.bin/tsx')

  /**
   * Run the worker. Returns `{ status, signal, killedBySignal, stdout }`.
   *
   * ## Why `signal` is not enough
   *
   * The worker is TypeScript, so it runs under `tsx`. `tsx` spawns node and exits with
   * the child's code, which means a SIGKILL to *the node process* surfaces to
   * `spawnSync` as `status: 137` (128 + 9) and `signal: null` — the signal was absorbed
   * by the wrapper, not delivered to the process the parent is watching.
   *
   * Measured: `{"status":137,"signal":null}` for every crash point. Asserting
   * `signal === 'SIGKILL'` fails for the right reason — the kill did happen, the parent
   * just cannot see it as a signal.
   *
   * So `killedBySignal` accepts either shape. What must never be accepted is a clean
   * exit: `status: 0` would mean the process finished normally and nothing was tested.
   */
  function worker(...args) {
    const result = spawnSync(tsxBin, [WORKER, ...args], {
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '--experimental-sqlite' },
    })
    const status = result.status
    const signal = result.signal
    return {
      status,
      signal,
      stdout: String(result.stdout ?? ''),
      // 137 = 128 + 9 (SIGKILL), the shape a wrapped child produces.
      killedBySignal: signal === 'SIGKILL' || status === 137,
    }
  }

  /** The worker's own view of what is on disk. */
  function inspect(ws) {
    const out = worker('inspect', '--db', ws.db, '--vault', ws.vault)
    const line = out.stdout
      .split('\n')
      .filter(entry => entry.trim().startsWith('{'))
      .pop()
    assert.ok(line, `inspect produced no JSON: ${out.stdout}`)
    return JSON.parse(line)
  }

  /**
   * The invariant, asserted after whatever happened.
   *
   * `lost` is checked first and separately: it is the unrecoverable case, and its
   * message should say so rather than being one of two entries in a combined list.
   */
  function assertNothingLost(state, where) {
    assert.deepEqual(state.lost, [], `${where}: a host lost its secret with no reference (unrecoverable)`)
    assert.deepEqual(state.keysLost, [], `${where}: a key lost its secret with no reference (unrecoverable)`)
  }

  function assertNothingTorn(state, where) {
    /*
     * Torn is *recoverable* — a retry overwrites the same version — but it means the
     * crash landed between two writes that were supposed to be one statement. The
     * production store does them in one `UPDATE`, so this must not happen; if it does,
     * the harness and the product disagree about atomicity and that is worth failing on.
     */
    assert.deepEqual(state.torn, [], `${where}: a host kept both plaintext and a reference`)
    assert.deepEqual(state.keysTorn, [], `${where}: a key kept both plaintext and a reference`)
  }

  /** A database with two hosts and two keys, nothing migrated. */
  function seeded() {
    const ws = workspace()
    const seed = worker('seed', '--db', ws.db, '--vault', ws.vault, '--rows', '2')
    assert.equal(seed.status, 0, `seed failed: ${seed.stdout}`)
    return ws
  }

  test('an uninterrupted run migrates everything and loses nothing', () => {
    const ws = seeded()
    try {
      const run = worker('run', '--db', ws.db, '--vault', ws.vault, '--stage-log', ws.stages)
      assert.equal(run.killedBySignal, false, 'a clean run must not be signalled')
      const state = inspect(ws)
      assertNothingLost(state, 'clean run')
      assertNothingTorn(state, 'clean run')
      assert.ok(state.hosts.every(host => !host.hasPlaintext && host.hasRef), 'all hosts migrated')
      assert.ok(state.keys.every(key => !key.hasPlaintext && key.hasRef), 'all keys migrated')
    } finally {
      ws.cleanup()
    }
  })

  /*
   * ## The crash points
   *
   * Each name is a boundary the worker reports through `--stage-log`. The interesting
   * ones are around `commitHost`/`commitKey`, because that is the single statement that
   * clears the plaintext and writes the reference — the only place a row could end up
   * half-migrated.
   */
  for (const crashAt of [
    'read-plaintext',
    'plan',
    'execute:before-commit:h0',
    'execute:after-commit:h0',
    'execute:before-commit:k0',
    'execute:after-commit:k0',
    'done',
  ]) {
    test(`killed at ${crashAt} leaves no row lost and no row torn`, () => {
      const ws = seeded()
      try {
        const run = worker(
          'run', '--db', ws.db, '--vault', ws.vault,
          '--stage-log', ws.stages, '--crash-at', crashAt,
        )
        /*
         * A real kill, observed from the parent.
         *
         * The exact shape (`signal: 'SIGKILL'` vs `status: 137`) depends on whether a
         * wrapper sits between the parent and the process that killed itself. Both mean
         * the process did not finish; `status: 0` would mean the crash point was never
         * reached and the test would be describing a run that completed.
         */
        assert.ok(
          run.killedBySignal,
          `expected a real kill at ${crashAt}, got status=${run.status} signal=${run.signal}`,
        )

        // The stage log proves the kill happened *at* the requested point.
        const log = readFileSync(ws.stages, 'utf8')
        assert.ok(
          log.includes(crashAt),
          `the worker never reached ${crashAt}; log was:\n${log}`,
        )

        const state = inspect(ws)
        assertNothingLost(state, `crash at ${crashAt}`)
        assertNothingTorn(state, `crash at ${crashAt}`)
        /*
         * Every row is in one of the two allowed states. Stated as a property rather
         * than a count: how far the run got depends on the crash point, and pinning
         * a number would make the test change every time the loop order does.
         */
        for (const host of state.hosts) {
          const plaintextOnly = host.hasPlaintext && !host.hasRef
          const migrated = !host.hasPlaintext && host.hasRef
          assert.ok(
            plaintextOnly || migrated,
            `${host.id} is in neither allowed state: ${JSON.stringify(host)}`,
          )
        }
      } finally {
        ws.cleanup()
      }
    })

    test(`a retry after ${crashAt} converges without loss`, () => {
      const ws = seeded()
      try {
        worker(
          'run', '--db', ws.db, '--vault', ws.vault,
          '--stage-log', ws.stages, '--crash-at', crashAt,
        )
        /*
         * ## Why the retry is the real test
         *
         * The production design has no in-memory progress record: the row itself is the
         * state (`credential-migration-run.test.ts` calls this out for the failure
         * path). A crash therefore needs no recovery step beyond running again — but
         * that only holds if a crashed run leaves rows a second run can pick up.
         *
         * A row that lost its plaintext without a reference would look "already
         * migrated" to the planner and be skipped forever. That is the failure this
         * case exists to catch, and it is invisible to the crash case above.
         */
        const retry = worker('run', '--db', ws.db, '--vault', ws.vault, '--stage-log', ws.stages)
        assert.equal(retry.killedBySignal, false, `the retry must not be killed: status=${retry.status}`)

        const state = inspect(ws)
        assertNothingLost(state, `retry after ${crashAt}`)
        assertNothingTorn(state, `retry after ${crashAt}`)
        assert.ok(
          state.hosts.every(host => !host.hasPlaintext && host.hasRef),
          `every host must be migrated after the retry: ${JSON.stringify(state.hosts)}`,
        )
        assert.ok(
          state.keys.every(key => !key.hasPlaintext && key.hasRef),
          `every key must be migrated after the retry: ${JSON.stringify(state.keys)}`,
        )

        // And the secret really is in the vault, not merely referenced.
        assert.ok(state.vault.length > 0, 'the vault must hold the moved secrets')
        assert.ok(
          existsSync(ws.vault),
          'the vault directory must exist after a converged retry',
        )
      } finally {
        ws.cleanup()
      }
    })
  }
}
