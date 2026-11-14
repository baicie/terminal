#!/usr/bin/env node
/**
 * Cross-platform process and path helpers for the GUI E2E harness.
 *
 * ## Why this module exists
 *
 * The first version called `spawnSync('pnpm', [...])` and `spawnSync('npx', [...])`
 * directly. On Windows those are `.cmd` shims, and `CreateProcess` cannot execute a
 * `.cmd` — the call fails with `error.code === 'ENOENT'` and `status === null`.
 * The launcher then did `process.exit(frontend.status ?? 1)`, which turns "could
 * not start the tool" into a silent exit 1 with no output. CI showed exactly that:
 *
 *     01:44:44.035  [gui-e2e] building frontend with the GUI E2E probe
 *     01:44:44.139  ##[error]Process completed with exit code 1
 *
 * 104 ms, no error text. That is the shape of a failed spawn reported as a failed
 * build.
 *
 * ## What it does instead
 *
 * 1. Resolve the real executable: on Windows append `.cmd` for pnpm/npx and run it
 *    through `cmd.exe /d /s /c` (Node's documented behaviour for `.cmd` files), so
 *    no Bash or PowerShell is required.
 * 2. Never drop a spawn error. Every failure carries `error`, `errno`, `syscall`,
 *    `path`, `status` and `signal`.
 * 3. Resolve the app binary per platform (`terminal.exe` on Windows).
 * 4. Detect the embedded WebDriver marker by reading the file as a Buffer, so a
 *    missing `strings(1)` cannot be mistaken for a missing feature.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export const IS_WINDOWS = process.platform === 'win32'

/**
 * The marker the embedded WebDriver plugin writes once its server is listening.
 * Kept here so the launcher and any future check share one literal.
 */
export const WEBDRIVER_READY_MARKER = 'tauri-plugin-webdriver is ready'

/**
 * Resolve a Node-managed CLI (`pnpm`, `npx`, …) into something Windows can start.
 *
 * On POSIX the name is passed through untouched. On Windows the shim is
 * `<name>.cmd` and must be run via `cmd.exe /d /s /c`, otherwise `spawnSync`
 * returns ENOENT — which is the bug this function exists to prevent.
 */
export function resolveCliCommand(command, args) {
  if (!IS_WINDOWS) return { file: command, args, shell: false }
  const shim = command.endsWith('.cmd') || command.endsWith('.exe') ? command : `${command}.cmd`
  // `/d` skips AutoRun, `/s` + the outer quotes preserve quoting exactly,
  // `/c` runs the command. This is Node's documented form for `.cmd` files.
  return {
    file: process.env.COMSPEC ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${shim} ${args.map(quoteForCmd).join(' ')}"`],
    shell: false,
  }
}

/** Quote one argument for `cmd.exe` when it contains spaces or quotes. */
function quoteForCmd(value) {
  const text = String(value)
  if (text === '') return '""'
  if (!/[\s"^&|<>]/.test(text)) return text
  // cmd.exe strips one layer of quotes; doubling inner quotes is the accepted
  // way to survive that without switching to PowerShell.
  return `"${text.replaceAll('"', '""')}"`
}

/**
 * Run a command and report exactly what happened.
 *
 * Returns `{ ok, status, signal, error }` where `error` is a structured
 * description of a spawn failure — never `undefined` when something went wrong.
 */
export function runCommand(command, args, options = {}) {
  const { file, args: argv, shell } = resolveCliCommand(command, args)
  const result = spawnSync(file, argv, {
    stdio: 'inherit',
    shell,
    ...options,
  })

  if (result.error) {
    return {
      ok: false,
      status: result.status,
      signal: result.signal,
      error: {
        message: result.error.message,
        // `code` is the ENOENT/EPERM/EACCES discriminator; `errno` is the numeric
        // form on some platforms only.
        code: result.error.code ?? null,
        errno: result.error.errno ?? null,
        syscall: result.error.syscall ?? null,
        path: result.error.path ?? file,
      },
      command: `${file} ${argv.join(' ')}`,
    }
  }

  if (result.status !== 0) {
    return {
      ok: false,
      status: result.status,
      signal: result.signal,
      error: null,
      command: `${file} ${argv.join(' ')}`,
    }
  }

  return { ok: true, status: 0, signal: null, error: null, command: `${file} ${argv.join(' ')}` }
}

/** Format a failed run so the CI log carries the whole story. */
export function describeFailure(label, outcome) {
  const lines = [`${label} failed`]
  lines.push(`  command: ${outcome.command}`)
  lines.push(`  status:  ${outcome.status}`)
  lines.push(`  signal:  ${outcome.signal}`)
  if (outcome.error) {
    lines.push(`  spawn error: ${outcome.error.message}`)
    lines.push(`    code:   ${outcome.error.code}`)
    lines.push(`    errno:  ${outcome.error.errno}`)
    lines.push(`    syscall:${outcome.error.syscall}`)
    lines.push(`    path:   ${outcome.error.path}`)
  }
  return lines.join('\n')
}

/**
 * Where the built app binary lives for this platform.
 *
 * Cargo writes `terminal` on POSIX and `terminal.exe` on Windows; a harness that
 * hardcodes the former reports "no binary" on Windows even after a good build.
 */
export function appBinaryPath(root) {
  const name = IS_WINDOWS ? 'terminal.exe' : 'terminal'
  return path.join(root, 'src-tauri/target/release', name)
}

/**
 * Does this binary contain the embedded WebDriver server?
 *
 * Reads the file as a Buffer and searches for the readiness marker. The previous
 * version shelled out to `strings(1)`, which does not exist on Windows — so the
 * check returned false there for a reason that had nothing to do with the build,
 * and the launcher refused to run a perfectly good binary.
 */
export function binaryHasWebDriver(binaryPath) {
  if (!existsSync(binaryPath)) return { present: false, reason: 'binary missing' }
  try {
    const bytes = readFileSync(binaryPath)
    // The marker is ASCII; searching the raw bytes avoids any decoding assumptions
    // about a 30 MB Rust binary.
    const found = bytes.includes(Buffer.from(WEBDRIVER_READY_MARKER, 'utf8'))
    return {
      present: found,
      reason: found ? 'marker present' : 'marker absent (built without --features gui-e2e?)',
    }
  } catch (error) {
    return { present: false, reason: `unreadable: ${error.message}` }
  }
}

/**
 * Environment variables that must point at the throwaway profile.
 *
 * Windows keeps user state in `USERPROFILE`, `APPDATA` and `LOCALAPPDATA`, not
 * only `HOME`. Setting `HOME` alone leaves the app reading the developer's real
 * Vault, SQLite database and SSH keys — which is exactly what the isolation
 * requirement forbids.
 */
export function isolatedProfileEnv(home) {
  return {
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData/Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData/Local'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local/share'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
  }
}
