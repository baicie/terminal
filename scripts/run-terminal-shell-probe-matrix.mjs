import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  assertSmokeInstrumentedBinary,
  buildFreshTauriBinary,
  cargoTargetDirectory,
  resolveBuiltBinary,
} from './run-terminal-smoke.mjs'
import { runShellProbe } from './run-terminal-shell-probe.mjs'
import {
  SUPPORTED_SHELLS,
  SUPPORTED_WINDOWS_SHELLS,
  SUPPORTED_TRANSPORTS,
} from './run-terminal-shell-probe.mjs'

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..')
const CASES = [
  'cat-eof',
  'readline-history',
  'readline-tab',
  'vim-edit',
  'nano-edit',
  'pty-resize',
  'ctrl-c-interrupt',
]

// Mirrors DIALECT_CASES in the frontend dialect module: each Windows shell
// can only run the cases that need neither POSIX line editing nor an editor
// that a stock Windows runner lacks. The keys are kept here rather than
// imported because this runner is plain Node and cannot load the frontend
// module; scripts/shell-probe-dialect-contract.test.mjs asserts the two
// lists stay identical.
const WINDOWS_CASES = {
  powershell: ['cat-eof', 'pty-resize', 'ctrl-c-interrupt'],
  cmd: ['cat-eof', 'ctrl-c-interrupt'],
}

export function casesForShell(shell, requested) {
  if (shell === 'powershell' || shell === 'cmd') {
    const supported = WINDOWS_CASES[shell]
    const usable = requested.filter(name => supported.includes(name))
    // Silently running fewer cases than the operator asked for would be a
    // mislabelled run, so an unsupported combination is an error.
    const unsupported = requested.filter(name => !supported.includes(name))
    if (unsupported.length > 0) {
      throw new Error(
        `shell probe shell '${shell}' does not support case(s) ${unsupported.join("','")}; supported: ${supported.join("','")}`,
      )
    }
    return usable
  }
  return requested
}

export function selectShellProbeCases(filter) {
  if (filter === undefined || filter === '') return [...CASES]
  const names = filter.split(',').map(name => name.trim()).filter(Boolean)
  const unknown = names.filter(name => !CASES.includes(name))
  if (unknown.length > 0) {
    throw new Error(
      `unknown shell probe case '${unknown.join("','")}'; expected one of ${CASES.join('/')}`,
    )
  }
  return CASES.filter(name => names.includes(name))
}

export function shellProbeFilterFromArguments(argumentsList) {
  // Options are separated from the positional case filter so that a flag or
  // its value (for example --shells bash,zsh) is never parsed as a case name.
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === '--') continue
    // Each of these options takes a value that must not be mistaken for the
    // positional case filter.
    if (argument === '--shells' || argument === '--transport') {
      index += 1
      continue
    }
    if (!argument.startsWith('--')) return argument
  }
  return undefined
}

export function shellProbeShellsFromArguments(argumentsList) {
  const optionIndex = argumentsList.indexOf('--shells')
  if (optionIndex < 0) return [undefined]
  const raw = argumentsList[optionIndex + 1]
  if (!raw || raw.startsWith('--')) {
    throw new Error('--shells requires a comma-separated value')
  }
  const shells = raw
    .split(',')
    .map(shell => shell.trim())
    .filter(Boolean)
  // Windows shells are accepted here as well: `--shells powershell` is the
  // only way to ask for the Windows dialect, and rejecting it would make the
  // dialect unreachable no matter what the Windows job asked for. Which shells
  // are actually usable is still decided per platform by assertShellsAvailable.
  const known = [...SUPPORTED_SHELLS, ...SUPPORTED_WINDOWS_SHELLS]
  const unknown = shells.filter(shell => !known.includes(shell))
  if (unknown.length > 0) {
    throw new Error(
      `unknown shell probe shell '${unknown.join("','")}'; expected one of ${known.join('/')}`,
    )
  }
  if (shells.length === 0) {
    throw new Error('--shells requires at least one shell')
  }
  return [...new Set(shells)]
}

// The transport under test. 'local' drives a PTY this process spawns; 'ssh'
// drives a real loopback sshd through the same fixture the SSH matrix uses.
// Only 'local' is combined with --shells, because over SSH the login shell
// belongs to the fixture rather than to this process.
export function shellProbeTransportFromArguments(argumentsList) {
  const optionIndex = argumentsList.indexOf('--transport')
  if (optionIndex < 0) return 'local'
  const raw = argumentsList[optionIndex + 1]
  if (!raw || raw.startsWith('--')) {
    throw new Error('--transport requires local or ssh')
  }
  if (!SUPPORTED_TRANSPORTS.includes(raw)) {
    throw new Error(
      'unknown shell probe transport ' +
        raw +
        '; expected one of ' +
        SUPPORTED_TRANSPORTS.join('/'),
    )
  }
  return raw
}

export function shellProbeReusesBinary(argumentsList) {
  return argumentsList.includes('--reuse-binary')
}

function shellExecutableAvailable(shell, platform = process.platform) {
  if (platform === 'win32' && SUPPORTED_WINDOWS_SHELLS.includes(shell)) {
    // cmd and PowerShell share one quoting style, but not one exit-code
    // convention: PowerShell exits non-zero for a failing command, so it is
    // probed with an explicit success command instead of a bare flag.
    const args =
      shell === 'powershell'
        ? ['-NoLogo', '-NoProfile', '-Command', 'exit 0']
        : ['/C', 'exit 0']
    const result = spawnSync(shell, args, { stdio: 'ignore', shell: false })
    return result.error === undefined && result.status === 0
  }
  const result = spawnSync(shell, ['-c', 'exit 0'], {
    stdio: 'ignore',
    shell: false,
  })
  return result.error === undefined && result.status === 0
}

export function assertShellsAvailable(
  shells,
  { isAvailable = shellExecutableAvailable, platform = process.platform } = {},
) {
  const unavailable = shells.filter(
    shell => shell !== undefined && !isAvailable(shell, platform),
  )
  if (unavailable.length > 0) {
    throw new Error(
      `requested shell executable(s) unavailable: ${unavailable.join(', ')}; ` +
        'install them before running the explicit shell matrix',
    )
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const filter = shellProbeFilterFromArguments(argv)
  const cases = selectShellProbeCases(filter)
  const transport = shellProbeTransportFromArguments(argv)
  const reuseBinary = shellProbeReusesBinary(argv)
  const shells = shellProbeShellsFromArguments(argv)
  if (transport === 'ssh' && shells.length > 1) {
    throw new Error('--shells cannot be combined with --transport ssh')
  }
  assertShellsAvailable(shells)
  const release = process.argv.includes('--release')
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
  const binary = await resolveBuiltBinary({ targetDirectory, release })
  if (reuseBinary) {
    const instrumented = await assertSmokeInstrumentedBinary(binary)
    console.log(
      `Verified the reused binary carries smoke instrumentation ` +
        `(${instrumented.length} smoke/probe chunk(s)).`,
    )
  }
  console.log(`Measured ${release ? 'release' : 'debug'} binary ${binary.sha256}`)
  const results = []
  for (const shell of shells) {
    for (const caseName of casesForShell(shell, cases)) {
      const shellLabel = shell === undefined ? 'default' : shell
      process.stdout.write(
        `[${transport}/${shellLabel}/${caseName}] running...`,
      )
      try {
        const result = await runShellProbe({
          cwd: PROJECT_ROOT,
          caseName,
          shell,
          transport,
          skipBuild: true,
          release,
          targetDirectory,
        })
        results.push({
          transport,
          shell: shell ?? null,
          caseName,
          ...result,
          binarySha256: binary.sha256,
        })
        process.stdout.write(` ok (${result.durationMs} ms)\n`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        results.push({
          transport,
          shell: shell ?? null,
          caseName,
          ok: false,
          error: message,
        })
        process.stdout.write(` FAILED: ${message}\n`)
      }
    }
  }
  console.log(JSON.stringify(results, null, 2))
  if (results.length === 0 || results.some(result => result.ok !== true)) {
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
