#!/usr/bin/env node
/**
 * RC06 — run one real `createHost` / `updateHost`, optionally killed mid-write.
 *
 * Started by `rc06-credential-crash-matrix.test.mjs`; not meant to be run by hand
 * without `--dir`.
 *
 * ## What is real
 *
 * The **product's own** `createHost` / `updateHost` (loaded through a resolve hook that
 * swaps only the two stores), a SQLite file, a JSON vault file, and — when
 * `RC06_CRASH_AT` names a stage — `process.kill(process.pid, 'SIGKILL')`, which unwinds
 * nothing.
 *
 * ## Usage
 *
 *   tsx --tsconfig packages/frontend/tsconfig.json \
 *     --import ./rc06-register.mjs rc06-credential-crash-worker.mjs \
 *     --command run --dir DIR --id ID [--mode create|update] [--secret S]
 */
import process from 'node:process'

const args = {}
for (let i = 2; i < process.argv.length; i += 1) {
  const flag = process.argv[i]
  if (!flag.startsWith('--')) continue
  args[flag.slice(2)] = process.argv[i + 1]
  i += 1
}

const command = args.command
if (command !== 'run') {
  console.error('only `run` is handled here; inspect lives in the test harness')
  process.exit(2)
}

const { createHost, updateHost } = await import('@/service/database/hosts')
const id = args.id ?? 'rc06'
const secret = args.secret ?? 'S1'
const mode = args.mode ?? 'create'

if (mode === 'update') {
  await updateHost(id, { password: secret })
} else {
  await createHost({
    id,
    name: 'rc06',
    hostname: 'rc06.test',
    port: 22,
    username: 'deploy',
    authType: 'password',
    password: secret,
    portForwards: [],
  })
}

// A clean run holds the connection open only long enough to write; SQLite commits each
// statement, so closing here is what a process exit would do anyway.
process.exit(0)
