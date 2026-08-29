import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  buildFreshTauriBinary,
  cargoTargetDirectory,
  runTerminalSmoke,
} from './run-terminal-smoke.mjs'

/**
 * Runs the full real-SSH authentication matrix against one freshly built
 * Tauri debug binary. Each case launches the desktop app in terminal smoke
 * mode with its own isolated SSH fixture and validates the published result.
 */

const PROJECT_ROOT = new URL('..', import.meta.url).pathname

const CASES = [
  { name: 'key', auth: 'key', reconnect: false },
  { name: 'key-reconnect', auth: 'key', reconnect: true },
  { name: 'password', auth: 'password', reconnect: false },
  { name: 'password-reconnect', auth: 'password', reconnect: true },
  { name: 'agent', auth: 'agent', reconnect: false },
  { name: 'cert', auth: 'cert', reconnect: false },
  { name: 'jump', auth: 'jump', reconnect: false },
]

function formatCaseRow({ name, ok, durationMs, firstConnectionMs, uniqueSessionCount, error }) {
  if (ok) {
    return {
      name,
      ok: true,
      durationMs,
      firstConnectionMs,
      uniqueSessionCount,
    }
  }
  return { name, ok: false, error }
}

export function selectCases(filter) {
  if (filter === undefined || filter === '') return CASES
  const names = filter.split(',').map(name => name.trim())
  const unknown = names.filter(name => !CASES.some(item => item.name === name))
  if (unknown.length > 0) {
    throw new Error(
      `unknown terminal smoke case '${unknown.join("','")}'; expected one of ${CASES.map(item => item.name).join('/')}`,
    )
  }
  return CASES.filter(item => names.includes(item.name))
}

async function main() {
  const cases = selectCases(process.argv[2])

  console.log('Building a fresh Tauri debug binary once for the matrix…')
  const startedAt = Date.now()
  await buildFreshTauriBinary({
    cwd: PROJECT_ROOT,
    env: { ...process.env, VITE_TERMINAL_SMOKE_BUILD: '1' },
  })
  const targetDirectory = await cargoTargetDirectory({
    cwd: PROJECT_ROOT,
    env: process.env,
  })
  console.log(`Build finished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)

  const results = []
  for (const item of cases) {
    const caseStartedAt = Date.now()
    process.stdout.write(`\n[${item.name}] running…`)
    try {
      const result = await runTerminalSmoke({
        cwd: PROJECT_ROOT,
        auth: item.auth,
        reconnect: item.reconnect,
        skipBuild: true,
        targetDirectory,
      })
      results.push(formatCaseRow({ ...item, ...result, ok: true }))
      process.stdout.write(
        ` ok — first connection ${result.firstConnectionMs} ms, ${result.durationMs} ms total\n`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push(formatCaseRow({ ...item, ok: false, error: message }))
      process.stdout.write(` FAILED — ${message}\n`)
    }
    console.log(`[${item.name}] wall time ${((Date.now() - caseStartedAt) / 1000).toFixed(1)}s`)
  }

  const failed = results.filter(result => !result.ok)
  console.log('\nTerminal SSH matrix summary:')
  for (const result of results) {
    if (result.ok) {
      console.log(
        `  ✅ ${result.name}: first connection ${result.firstConnectionMs} ms, ${result.durationMs} ms, ${result.uniqueSessionCount} sessions`,
      )
    } else {
      console.log(`  ❌ ${result.name}: ${result.error}`)
    }
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} terminal smoke case(s) failed.`)
    process.exitCode = 1
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
