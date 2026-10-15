import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  assertSmokeInstrumentedBinary,
  buildFreshTauriBinary,
  cargoTargetDirectory,
  resolveBuiltBinary,
  runTerminalSmoke,
} from './run-terminal-smoke.mjs'

/**
 * Runs the full real-SSH authentication matrix against one freshly built
 * Tauri binary. The debug profile is the default; --release measures the
 * profile real users receive. Each case launches the desktop app in terminal
 * smoke mode with its own isolated SSH fixture and validates the result.
 *
 * `--reuse-binary` measures the binary already on disk instead of rebuilding.
 * A rebuild is not reproducible at the byte level, so a matrix that rebuilds
 * always describes a different artifact than a cold-start run measured just
 * before it. Reusing the binary is what lets several evidence files honestly
 * claim the same build.
 */

const PROJECT_ROOT = new URL('..', import.meta.url).pathname

// Generous enough for the slowest observed case (jump-reconnect at ~8.5s) by
// a wide margin, while still turning a stalled case into a bounded failure
// instead of an acceptance run that never returns.
const CASE_TIMEOUT_MS = 300_000
const CASE_CLEANUP_TIMEOUT_MS = 5_000

const CASES = [
  { name: 'key', auth: 'key', reconnect: false },
  { name: 'key-reconnect', auth: 'key', reconnect: true },
  // Holds the host unreachable across several exponential backoff steps
  // (500ms, 1s, 2s, 4s), which is what sleep, a VPN switch or a NAT timeout
  // actually look like. Every other reconnect case bounces sshd and succeeds
  // on the first attempt, so the ladder itself was never exercised end to end.
  { name: 'key-outage-reconnect', auth: 'key', reconnect: true, outageHoldMs: 5_000 },
  {
    name: 'key-outage-wake-reconnect',
    auth: 'key',
    reconnect: true,
    outageHoldMs: 20_000,
    hostWakeRequired: true,
  },
  // Holds the host unreachable across the *first* connection attempt rather
  // than across a reconnect. Every other outage case establishes the session
  // first and only then takes the daemon down, so the first-connect retry
  // ladder was never exercised: the automatic reconnect path is armed by an
  // I/O error on a live session, and a connection that never came up has no
  // session id to fail. A real blip during connect -- a VPN still coming up,
  // DNS not ready, a packet lost during the handshake -- looks like this.
  //
  // It runs as an ordinary single-round case rather than a reconnect case:
  // there is no session to retire, and the reconnect checkpoint is only ever
  // published from an already interactive terminal. What matters is simply
  // that the app reaches `connected` on its own once the host answers again.
  { name: 'key-first-connect-outage', auth: 'key', firstConnectOutageHoldMs: 6_000 },
  { name: 'password', auth: 'password', reconnect: false },
  { name: 'password-reconnect', auth: 'password', reconnect: true },
  { name: 'agent', auth: 'agent', reconnect: false },
  { name: 'agent-reconnect', auth: 'agent', reconnect: true },
  { name: 'cert', auth: 'cert', reconnect: false },
  { name: 'cert-reconnect', auth: 'cert', reconnect: true },
  { name: 'jump', auth: 'jump', reconnect: false },
  { name: 'jump-reconnect', auth: 'jump', reconnect: true },
]

function formatCaseRow({
  name,
  ok,
  durationMs,
  firstConnectionMs,
  uniqueSessionCount,
  binarySha256,
  error,
}) {
  if (ok) {
    return {
      name,
      ok: true,
      durationMs,
      firstConnectionMs,
      uniqueSessionCount,
      binarySha256,
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

export function parseMatrixArguments(argv) {
  const positional = argv.filter(argument => !argument.startsWith('--'))
  return {
    // Options are separated from the positional case filter so that
    // `--release` or `--reuse-binary` is never parsed as a case name.
    filter: positional[0],
    release: argv.includes('--release'),
    reuseBinary: argv.includes('--reuse-binary'),
  }
}

/**
 * Runs every matrix case under an explicit deadline.
 *
 * Awaiting a case directly means a single stalled fixture, port or child
 * process silently cancels every remaining acceptance case and the run never
 * reports anything at all. Bounding each case keeps one bad case contained as
 * a failure row so the rest of the matrix still produces evidence.
 */
export async function runMatrixCases(
  cases,
  {
    runCase,
    caseTimeoutMs = CASE_TIMEOUT_MS,
    cleanupTimeoutMs = CASE_CLEANUP_TIMEOUT_MS,
    onProgress = () => {},
  } = {},
) {
  const results = []
  for (const item of cases) {
    const caseStartedAt = Date.now()
    onProgress({ phase: 'start', item })
    const controller = new AbortController()
    const casePromise = Promise.resolve().then(() =>
      runCase(item, { signal: controller.signal }),
    )
    let timer
    let timedOut = false
    try {
      const result = await Promise.race([
        casePromise,
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => {
              timedOut = true
              const error = new Error(
                `terminal smoke case timed out after ${caseTimeoutMs} ms`,
              )
              controller.abort(error)
              reject(error)
            },
            caseTimeoutMs,
          )
        }),
      ])
      results.push(
        formatCaseRow({ ...item, ...result, ok: true }),
      )
      onProgress({ phase: 'pass', item, result, results })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (timedOut) {
        // A timeout only wins the race; the app may still be unwinding its
        // process and fixture cleanup. Give the aborted case a bounded grace
        // period before starting another case so resources do not overlap.
        await Promise.race([
          casePromise.catch(() => {}),
          new Promise(resolve => {
            const cleanupTimer = setTimeout(resolve, cleanupTimeoutMs)
          }),
        ])
      }
      results.push(formatCaseRow({ ...item, ok: false, error: message }))
      onProgress({ phase: 'fail', item, error: message, results })
    } finally {
      clearTimeout(timer)
      if (!controller.signal.aborted && timedOut) {
        controller.abort(new Error('terminal smoke case timed out'))
      }
      onProgress({
        phase: 'end',
        item,
        wallTimeMs: Date.now() - caseStartedAt,
      })
    }
  }
  return results
}

async function main() {
  const { filter, release, reuseBinary } = parseMatrixArguments(process.argv.slice(2))
  const cases = selectCases(filter)
  const profileLabel = release ? 'release' : 'debug'

  if (reuseBinary) {
    console.log(`Reusing the Tauri ${profileLabel} binary on disk for the matrix…`)
  } else {
    console.log(`Building a fresh Tauri ${profileLabel} binary once for the matrix…`)
  }
  const startedAt = Date.now()
  if (!reuseBinary) {
    await buildFreshTauriBinary({
      cwd: PROJECT_ROOT,
      env: { ...process.env, VITE_TERMINAL_SMOKE_BUILD: '1' },
      release,
    })
  }
  const targetDirectory = await cargoTargetDirectory({
    cwd: PROJECT_ROOT,
    env: process.env,
  })
  console.log(`Build finished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
  const binary = await resolveBuiltBinary({ targetDirectory, release })
  if (reuseBinary) {
    const instrumented = await assertSmokeInstrumentedBinary(binary)
    console.log(
      `Verified the reused binary carries smoke instrumentation ` +
        `(${instrumented.length} smoke/probe chunk(s)).`,
    )
  }
  console.log(`Measured ${profileLabel} binary ${binary.sha256}`)

  const results = await runMatrixCases(cases, {
    runCase: (item, { signal }) =>
      runTerminalSmoke({
        cwd: PROJECT_ROOT,
        auth: item.auth,
        reconnect: item.reconnect,
        ...(item.outageHoldMs === undefined
          ? {}
          : { outageHoldMs: item.outageHoldMs }),
        ...(item.firstConnectOutageHoldMs === undefined
          ? {}
          : { firstConnectOutageHoldMs: item.firstConnectOutageHoldMs }),
        ...(item.hostWakeRequired ? { hostWakeRequired: true } : {}),
        skipBuild: true,
        release,
        targetDirectory,
        signal,
      }),
    onProgress: event => {
      if (event.phase === 'start') {
        process.stdout.write(`\n[${event.item.name}] running…`)
      }
      if (event.phase === 'pass') {
        process.stdout.write(
          ` ok — first connection ${event.result.firstConnectionMs} ms, ${event.result.durationMs} ms total\n`,
        )
      }
      if (event.phase === 'fail') {
        process.stdout.write(` FAILED — ${event.error}\n`)
      }
      if (event.phase === 'end') {
        console.log(
          `[${event.item.name}] wall time ${(event.wallTimeMs / 1000).toFixed(1)}s`,
        )
      }
    },
  })

  for (const result of results) {
    if (result.ok) result.binarySha256 = binary.sha256
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
