#!/usr/bin/env node
// Cross-version Team Sync acceptance: historical client A (released tag
// v0.0.1-dev.2) and current client B, both as separate processes, against the
// current Nest server over real HTTP, real PostgreSQL and on-disk SQLite.
//
// The report this writes is the evidence. It records the exact historical
// commit, every phase's exit code and the assertions each phase made, so a
// failure names the phase instead of turning into "flaky".
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {
  HISTORICAL_COMMIT,
  HISTORICAL_TAG,
  prepareHistoricalClient,
} from './prepare-team-sync-a.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const TEAM_SERVER = path.join(ROOT, 'packages/team-server')
const STATE_DIR = process.env.TEAM_SYNC_E2E_STATE_DIR
  ?? mkdtempSync(path.join(os.tmpdir(), 'team-cross-version-'))
const REPORT_PATH = process.env.TEAM_SYNC_E2E_REPORT
  ?? path.join(ROOT, 'team-cross-version-report.json')
const PHASE_TIMEOUT_MS = 8 * 60 * 1000

const steps = []
const reports = new Map()

function readJson(name) {
  const file = path.join(STATE_DIR, name)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function run(name, command, args, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: TEAM_SERVER,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const collect = chunk => {
      output += String(chunk)
      if (output.length > 2_000_000) output = output.slice(-1_000_000)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => child.kill('SIGKILL'), PHASE_TIMEOUT_MS)
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ name, code, signal, output })
    })
  })
}

function step(name, result, detailName) {
  const entry = {
    name,
    ok: result.code === 0,
    exitCode: result.code,
    signal: result.signal,
    detail: detailName === undefined ? null : readJson(detailName),
  }
  if (!entry.ok) entry.outputTail = result.output.slice(-4000)
  steps.push(entry)
  return entry.ok
}

async function waitForServer(child, readyFile, timeoutMs = 180_000) {
  const started = Date.now()
  let output = ''
  child.stdout.on('data', chunk => { output += String(chunk) })
  child.stderr.on('data', chunk => { output += String(chunk) })
  while (Date.now() - started < timeoutMs) {
    if (existsSync(readyFile)) {
      return JSON.parse(readFileSync(readyFile, 'utf8')).base
    }
    if (child.exitCode !== null) {
      throw new Error(`the server exited before it was ready:\n${output.slice(-4000)}`)
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`the server did not become ready:\n${output.slice(-4000)}`)
}

async function call(base, method, route, token, body) {
  const response = await fetch(base + route, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let json = null
  try {
    json = text.length === 0 ? null : JSON.parse(text)
  } catch {
    json = text
  }
  return { status: response.status, json }
}

async function register(base, userId) {
  const result = await call(base, 'POST', '/api/v1/auth/register', null, { userId })
  if (result.status !== 201) {
    throw new Error(`register ${userId} failed with ${result.status}: ${JSON.stringify(result.json)}`)
  }
  return result.json
}

async function bootstrap(base) {
  const a = await register(base, 'cross-version-user-a')
  const b = await register(base, 'cross-version-user-b')
  const team = await call(base, 'POST', '/api/v1/teams', a.token, { name: 'Cross-version team' })
  if (team.status !== 201) throw new Error(`create team failed: ${JSON.stringify(team.json)}`)
  const teamId = team.json.id
  const member = await call(base, 'POST', `/api/v1/teams/${teamId}/members`, a.token, {
    userId: b.userId,
    role: 'MEMBER',
  })
  if (member.status !== 201) throw new Error(`add member failed: ${JSON.stringify(member.json)}`)
  const bootstrapState = {
    base,
    teamId,
    userA: { id: a.userId, token: a.token },
    userB: { id: b.userId, token: b.token },
    dbA: path.join(STATE_DIR, 'historical-a.db'),
    dbB: path.join(STATE_DIR, 'current-peer.db'),
    upgradedDb: path.join(STATE_DIR, 'upgraded-from-a.db'),
  }
  writeFileSync(path.join(STATE_DIR, 'bootstrap.json'), `${JSON.stringify(bootstrapState, null, 2)}\n`)
  return bootstrapState
}

function runVitest(config, env) {
  return run(config, 'pnpm', ['exec', 'vitest', 'run', '--config', config], {
    TEAM_SYNC_E2E_STATE_DIR: STATE_DIR,
    ...env,
  })
}

async function main() {
  let historical = null
  try {
    historical = prepareHistoricalClient()
  } catch (error) {
    steps.push({ name: 'prepare-historical-client', ok: false, error: String(error) })
  }

  // Nest resolves constructor dependencies from `design:paramtypes`, which only
  // tsc emits. Running the server through a transpile-only loader leaves every
  // provider undefined, so the server is built the same way CI builds it and
  // started from dist.
  const build = await run('build-server', 'pnpm', ['build'])
  const built = step('build-server', build)
  const readyFile = path.join(STATE_DIR, 'server-ready.json')
  const server = built
    ? spawn(process.execPath, ['dist/cross-version-server/main.js'], {
        cwd: TEAM_SERVER,
        env: { ...process.env, TEAM_SYNC_E2E_READY_FILE: readyFile },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : null

  let base = null
  try {
    if (server === null) throw new Error('the server build failed')
    base = await waitForServer(server, readyFile)
  } catch (error) {
    steps.push({ name: 'start-server', ok: false, error: String(error) })
  }

  if (historical !== null && base !== null) {
    const state = await bootstrap(base)
    let seedOk = step('a-seed', await runVitest('vitest.cross-version-a.config.ts', {
      TEAM_SYNC_E2E_PHASE: 'seed',
    }), 'a-seed.json')
    let upgradeOk = false
    let peerOk = false
    if (seedOk) {
      upgradeOk = step('b-upgrade', await runVitest('vitest.cross-version-b.config.ts', {
        TEAM_SYNC_E2E_ROLE: 'upgrade',
      }), 'b-upgrade.json')
      peerOk = step('b-peer', await runVitest('vitest.cross-version-b.config.ts', {
        TEAM_SYNC_E2E_ROLE: 'peer',
      }), 'b-peer.json')
    }
    if (seedOk) {
      const seed = readJson('a-seed.json')
      const deletedShareId = seed?.snippetIds?.[0] ?? null
      let deleted = false
      if (deletedShareId !== null) {
        const response = await call(base, 'POST', '/api/v1/sync', state.userA.token, {
          deleteShares: [deletedShareId],
        })
        deleted = response.json?.deleted?.includes(deletedShareId) === true
      }
      writeFileSync(
        path.join(STATE_DIR, 'tombstone.json'),
        `${JSON.stringify({ deletedSnippetId: deletedShareId, deleted }, null, 2)}\n`,
      )
      step('a-verify', await runVitest('vitest.cross-version-a.config.ts', {
        TEAM_SYNC_E2E_PHASE: 'verify',
      }), 'a-verify.json')
    } else {
      steps.push({ name: 'b-upgrade', ok: false, skipped: true })
      steps.push({ name: 'b-peer', ok: false, skipped: true })
      steps.push({ name: 'a-verify', ok: false, skipped: true })
    }
  }

  if (server !== null) {
    server.kill('SIGTERM')
    await new Promise(resolve => setTimeout(resolve, 500))
    if (server.exitCode === null) server.kill('SIGKILL')
  }

  const seed = readJson('a-seed.json')
  const upgrade = readJson('b-upgrade.json')
  const peer = readJson('b-peer.json')
  const verify = readJson('a-verify.json')
  const tombstone = readJson('tombstone.json')
  const allOk = steps.length >= 5 && steps.every(entry => entry.ok === true)
  const dirtyPathOk = upgrade?.details?.dirtyBefore === 1 && upgrade?.details?.dirtyAfter === 0

  const report = {
    kind: 'team-sync-cross-version',
    generatedAt: new Date().toISOString(),
    aClient: {
      tag: HISTORICAL_TAG,
      commit: HISTORICAL_COMMIT,
      tree: historical?.tree ?? null,
    },
    environment: {
      server: 'current AppModule over real PostgreSQL and real HTTP',
      sqlite: 'on-disk SQLite files, one per client',
      processes: 'server, historical client seed/verify, current client upgrade/peer',
      stateDir: STATE_DIR,
    },
    steps,
    observed: {
      seed: seed === null
        ? null
        : {
            ok: seed.ok,
            conflicts: seed.pushConflicts,
            legacyUpdateProbe: seed.legacyUpdateProbe,
          },
      upgrade: upgrade === null ? null : { ok: upgrade.ok, details: upgrade.details },
      peer: peer === null ? null : { ok: peer.ok, details: peer.details },
      tombstone,
      verify: verify === null ? null : { ok: verify.ok, details: verify.details },
    },
    matrix: {
      TEAM_CROSS_VERSION_A_TO_B_VERIFIED: allOk ? 'PASS' : 'FAIL',
      TEAM_CROSS_VERSION_DIRTY_ROW_UPGRADE: dirtyPathOk ? 'PASS' : 'FAIL',
      TEAM_CROSS_VERSION_TOMBSTONE_CONSUMED: verify?.ok === true
        && verify?.details?.deletedSnippetId !== null
        ? 'PASS'
        : 'FAIL',
      TEAM_CROSS_VERSION_TOMBSTONE_RESURRECTION: verify?.ok !== true
        ? 'NOT_RUN'
        : verify?.details?.deletedSnippetStillOnServerAfterHistoricalPush === true
          ? 'DETECTED'
          : 'NOT_DETECTED',
      // Observed in the seed phase: the server was handed the exact payload the
      // historical client sends on its next update and refused it.
      TEAM_CROSS_VERSION_UPDATE_SAFETY: (seed?.legacyUpdateProbe?.conflictIds?.length ?? 0) > 0
        ? 'PASS'
        : 'FAIL',
    },
    failures: steps.filter(entry => !entry.ok).map(entry => entry.name),
    // Facts a reviewer can check without reading the harness: what the old
    // client was told, and what it did with it.
    findings: findingsFrom(verify),
  }
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)

  for (const [key, value] of Object.entries(report.matrix))
    process.stdout.write(`${key}=${value}\n`)
  if (!allOk) {
    process.stdout.write(`team-cross-version failed; report: ${REPORT_PATH}\n`)
    process.exit(1)
  }
  process.stdout.write(`team-cross-version passed; report: ${REPORT_PATH}\n`)
  process.exit(0)
}

function findingsFrom(verify) {
  if (verify?.ok === true) return []
  const error = verify?.details?.syncError
  if (typeof error !== 'string') return []
  if (!error.includes('UNIQUE constraint failed')) return [error]
  return [
    'The historical client applies a full snapshot with a plain INSERT: re-delivering a share it already stores raises UNIQUE and aborts the whole sync.',
    'The current server answers the historical client\'s millisecond cursor with a full resnapshot (the cursor is above the PostgreSQL safe watermark), so every restart with existing data re-delivers every share.',
    'The old client cannot update shares against the current server either: it sends its createdAt as baseVersion, which the server classifies as legacy-timestamp and refuses.',
  ]
}

main().catch((error) => {
  console.error('[team-cross-version] fatal', error)
  process.exit(1)
})
