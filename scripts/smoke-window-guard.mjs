#!/usr/bin/env node
// Keeps the smoke-test app window small and parked in a screen corner while the
// real-machine matrix runs. The runners activate the app on purpose (the
// frontmost assertion is what proves the window is really on screen), so the
// window cannot be hidden - it can only be made less intrusive.
//
// This file is intentionally absent from FINGERPRINT_PATHS in
// scripts/check-verification-evidence.mjs: it never touches the app, the
// runners or the evidence, so adding or editing it cannot invalidate a capture.
//
// It needs Accessibility permission for the app that runs it, because moving
// another process's window is exactly what that permission gates.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const APP_PATTERN = /\/src-tauri\/target\/(?:debug|release)\/terminal$/
const OK_RESULTS = new Set(['resized', 'kept', 'absent', 'no-window'])
const ACCESSIBILITY_MARKERS = ['-1743', '-1728', '-25211', 'not allowed assistive', '不允许辅助访问']
const DEFAULT_WIDTH = 640
const DEFAULT_HEIGHT = 420
const DEFAULT_MARGIN = 16
const DEFAULT_INTERVAL_MS = 600

const GEOMETRY_SCRIPT = [
  'on run argv',
  '  set targetPid to (item 1 of argv) as integer',
  '  set targetWidth to (item 2 of argv) as integer',
  '  set targetHeight to (item 3 of argv) as integer',
  '  set targetX to (item 4 of argv) as integer',
  '  set targetY to (item 5 of argv) as integer',
  '  tell application "System Events"',
  '    set matches to (every process whose unix id is targetPid)',
  '    if (count of matches) is 0 then return "absent"',
  '    set targetProcess to item 1 of matches',
  '    set report to ""',
  '    repeat with targetWindow in (every window of targetProcess)',
  '      try',
  '        set currentSize to size of targetWindow',
  '        set currentPosition to position of targetWindow',
  '        set size of targetWindow to {targetWidth, targetHeight}',
  '        set position of targetWindow to {targetX, targetY}',
  '        if currentSize is {targetWidth, targetHeight} and currentPosition is {targetX, targetY} then',
  '          set report to report & "kept"',
  '        else',
  '          set report to report & "resized"',
  '        end if',
  '      on error errorMessage',
  '        set report to report & "denied:" & errorMessage',
  '      end try',
  '    end repeat',
  '    if report is "" then return "no-window"',
  '    return report',
  '  end tell',
  'end run',
].join('\n')

function parseArgs(argv) {
  const options = {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    margin: DEFAULT_MARGIN,
    corner: 'bottom-right',
    intervalMs: DEFAULT_INTERVAL_MS,
    once: false,
    verbose: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      index += 1
      return argv[index]
    }
    if (arg === '--width') options.width = Number(next())
    else if (arg === '--height') options.height = Number(next())
    else if (arg === '--margin') options.margin = Number(next())
    else if (arg === '--corner') options.corner = next()
    else if (arg === '--interval') options.intervalMs = Number(next())
    else if (arg === '--once') options.once = true
    else if (arg === '--verbose') options.verbose = true
    else if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    } else {
      console.error(`unknown argument: ${arg}`)
      printUsage()
      process.exit(2)
    }
  }
  if (!['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(options.corner)) {
    console.error(`unknown corner: ${options.corner}`)
    process.exit(2)
  }
  for (const key of ['width', 'height', 'margin', 'intervalMs']) {
    const value = options[key]
    if (!Number.isFinite(value) || value < 0) {
      console.error(`invalid --${key === 'intervalMs' ? 'interval' : key}`)
      process.exit(2)
    }
  }
  return options
}

function printUsage() {
  console.log(`Usage: node scripts/smoke-window-guard.mjs [options]

Run this in a second terminal while a smoke matrix runs; it keeps the test
window small and out of the way.

  --width <px>      window width  (default ${DEFAULT_WIDTH})
  --height <px>     window height (default ${DEFAULT_HEIGHT})
  --margin <px>     gap from the screen edge (default ${DEFAULT_MARGIN})
  --corner <name>   top-left | top-right | bottom-left | bottom-right
                    (default bottom-right)
  --interval <ms>   poll interval (default ${DEFAULT_INTERVAL_MS})
  --once            adjust whatever is on screen, then exit
  --verbose         print every poll, not only changes
  -h, --help        show this message

Moving another process's window needs Accessibility permission. The first run
tells you exactly which app to grant it to.`)
}

function accessibilityHint(responsible) {
  const target = responsible ?? 'the terminal you run this from'
  return [
    'Accessibility permission is missing, so the window cannot be moved.',
    `Grant it to: ${target}`,
    'System Settings > Privacy & Security > Accessibility, add or enable that app,',
    'then run this script again (macOS only re-checks after the app restarts).',
  ].join('\n')
}

function looksLikeAccessibilityDenial(text) {
  return ACCESSIBILITY_MARKERS.some(marker => text.includes(marker))
}

async function psTable() {
  const { stdout } = await execFileAsync('ps', ['-Ao', 'pid=,ppid=,command='], {
    maxBuffer: 16 * 1024 * 1024,
  })
  const rows = []
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)
    if (!match) continue
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3].trim() })
  }
  return rows
}

function bundleName(command) {
  const match = command.match(/^(.+?)\.app\/Contents\/MacOS\//)
  if (!match) return null
  return match[1].split('/').pop()
}

// The app macOS blames for a TCC denial is the outermost ancestor bundle, not
// this node process, so walk up until the process tree leaves a .app bundle.
async function responsibleApp(rows) {
  const byPid = new Map(rows.map(row => [row.pid, row]))
  let current = process.pid
  let outermost = null
  for (let depth = 0; depth < 32; depth += 1) {
    const row = byPid.get(current)
    if (!row) break
    const name = bundleName(row.command)
    if (name) outermost = name
    if (row.ppid === current || row.ppid <= 1) break
    current = row.ppid
  }
  return outermost
}

async function runningAppPids(rows) {
  const pids = []
  for (const row of rows) {
    if (!APP_PATTERN.test(row.command)) continue
    pids.push(row.pid)
  }
  return pids
}

async function screenBounds() {
  try {
    const { stdout } = await execFileAsync('osascript', [
      '-e',
      'tell application "Finder" to get bounds of window of desktop',
    ])
    const parts = stdout.trim().split(',').map(value => Number(value.trim()))
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      return { width: parts[2], height: parts[3] }
    }
  } catch {
    // Fall through to the conservative default below.
  }
  return { width: 1440, height: 900 }
}

function anchor(bounds, options) {
  const left = options.margin
  const top = options.margin
  const right = Math.max(left, bounds.width - options.width - options.margin)
  const bottom = Math.max(top, bounds.height - options.height - options.margin)
  switch (options.corner) {
    case 'top-left':
      return { x: left, y: top }
    case 'top-right':
      return { x: right, y: top }
    case 'bottom-left':
      return { x: left, y: bottom }
    default:
      return { x: right, y: bottom }
  }
}

async function applyToWindow(pid, position, options) {
  const { stdout } = await execFileAsync('osascript', [
    '-e',
    GEOMETRY_SCRIPT,
    String(pid),
    String(options.width),
    String(options.height),
    String(position.x),
    String(position.y),
  ])
  return stdout.trim()
}

async function tick(state, options) {
  const rows = await psTable()
  const pids = await runningAppPids(rows)
  if (pids.length === 0) {
    if (options.verbose && state.seenApp) {
      console.log('no smoke app window right now')
      state.seenApp = false
      state.announced.clear()
    }
    return
  }
  state.seenApp = true
  const bounds = await screenBounds()
  const position = anchor(bounds, options)
  for (const pid of pids) {
    let result
    try {
      result = await applyToWindow(pid, position, options)
    } catch (error) {
      const message = String(error.stderr ?? error.message ?? error).trim()
      if (looksLikeAccessibilityDenial(message)) {
        console.error(accessibilityHint(await responsibleApp(rows)))
        process.exit(3)
      }
      console.error(`pid ${pid}: ${message}`)
      continue
    }
    const denied = result.includes('denied:')
    if (denied && looksLikeAccessibilityDenial(result)) {
      console.error(accessibilityHint(await responsibleApp(rows)))
      process.exit(3)
    }
    if (denied) {
      console.error(`pid ${pid}: window refused the move (${result})`)
      continue
    }
    if (!OK_RESULTS.has(result)) {
      console.error(`pid ${pid}: unexpected result ${JSON.stringify(result)}`)
      continue
    }
    const key = `${pid}:${result}`
    if (result === 'resized' || options.verbose) {
      console.log(
        `pid ${pid}: ${result} -> ${options.width}x${options.height} at ${position.x},${position.y} (${options.corner})`,
      )
    }
    state.announced.add(key)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const state = { announced: new Set(), seenApp: false }
  await tick(state, options)
  if (options.once) return
  console.log(`watching every ${options.intervalMs} ms; Ctrl+C to stop`)
  let stopping = false
  process.on('SIGINT', () => {
    stopping = true
    console.log('\nstopped')
    process.exit(0)
  })
  while (!stopping) {
    await new Promise(resolve => setTimeout(resolve, options.intervalMs))
    if (stopping) break
    try {
      await tick(state, options)
    } catch (error) {
      console.error(`poll failed: ${error.message}`)
    }
  }
}

main().catch(error => {
  console.error(error.stack ?? String(error))
  process.exit(1)
})
