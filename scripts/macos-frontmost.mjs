import path from 'node:path'

const FRONTMOST_RETRIES = 8
const FRONTMOST_SETTLE_MS = 250
const COMPILE_TIMEOUT_MS = 60_000

export const MACOS_FRONTMOST_SOURCE = `import AppKit
import Foundation
import CoreGraphics

func visibleWindowProcessIdentifier() -> pid_t? {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        return nil
    }
    for window in windows {
        guard let layer = window[kCGWindowLayer as String] as? Int, layer == 0,
              let rawPid = window[kCGWindowOwnerPID as String] as? Int,
              rawPid > 0 else { continue }
        return pid_t(rawPid)
    }
    return nil
}

func runLSAppinfo(_ arguments: [String]) -> String? {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/lsappinfo")
    process.arguments = arguments
    let output = Pipe()
    process.standardOutput = output
    process.standardError = Pipe()
    do {
        try process.run()
        process.waitUntilExit()
    } catch {
        return nil
    }
    guard process.terminationStatus == 0 else { return nil }
    return String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)
}

func lsappinfoFrontProcessIdentifier() -> pid_t? {
    guard let asn = runLSAppinfo(["front"])?.trimmingCharacters(in: .whitespacesAndNewlines),
          !asn.isEmpty,
          let text = runLSAppinfo(["info", "-only", "pid", asn]),
          let marker = text.range(of: "=") else { return nil }
    let digits = text[marker.upperBound...].prefix { $0.isNumber }
    return digits.isEmpty ? nil : pid_t(digits)
}

guard CommandLine.arguments.count >= 2 else { exit(2) }
switch CommandLine.arguments[1] {
case "activate":
    guard CommandLine.arguments.count == 3, let rawPid = Int32(CommandLine.arguments[2]),
          let application = NSRunningApplication(processIdentifier: pid_t(rawPid)) else { exit(3) }
    application.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.25))
case "frontmost":
    // NSWorkspace can briefly report loginwindow while LaunchServices already
    // knows the real frontmost app (notably during unlock and AppKit launch).
    // Prefer the LaunchServices answer for that transient state, then fall
    // back to the window server and AppKit APIs when the command is unavailable.
    let workspaceApplication = NSWorkspace.shared.frontmostApplication
    let workspacePid = workspaceApplication?.processIdentifier
    let workspaceIsLoginWindow = workspaceApplication?.bundleIdentifier == "com.apple.loginwindow"
    let pid = (workspaceIsLoginWindow ? lsappinfoFrontProcessIdentifier() : nil)
        ?? (workspaceApplication == nil ? visibleWindowProcessIdentifier() : nil)
        ?? workspacePid
    guard let pid else { exit(4) }
    print(pid)
default:
    exit(5)
}
`

function collectOutput(stream) {
  let output = ''
  stream?.setEncoding('utf8')
  stream?.on('data', chunk => (output += chunk))
  return () => output
}

function waitForClose(child, dependencies, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let timer
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      dependencies.clearTimeout(timer)
      error ? reject(error) : resolve(value)
    }
    timer = dependencies.setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // The compiler may have exited between the deadline and the signal.
      }
      finish(new Error(`${label} timed out after ${timeoutMs} ms`))
    }, timeoutMs)
    child.once('error', error => finish(new Error(`${label} failed: ${error.message}`)))
    child.once('close', (code, signal) => finish(null, { code, signal }))
  })
}

export async function compileMacFrontmostHelper(directory, dependencies) {
  const sourcePath = path.join(directory, 'macos-frontmost.swift')
  const binaryPath = path.join(directory, 'macos-frontmost')
  await dependencies.writeFile(sourcePath, MACOS_FRONTMOST_SOURCE, {
    encoding: 'utf8',
  })
  let child
  try {
    child = dependencies.spawn('swiftc', ['-O', sourcePath, '-o', binaryPath], {
      cwd: directory,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
  } catch (error) {
    throw new Error(`macOS frontmost helper could not start: ${error.message}`)
  }
  const status = await waitForClose(child, dependencies, COMPILE_TIMEOUT_MS, 'swiftc')
  if (status.code !== 0) {
    throw new Error(`swiftc exited with code ${String(status.code)}`)
  }
  return binaryPath
}

async function runHelper(binaryPath, args, dependencies) {
  let child
  try {
    child = dependencies.spawn(binaryPath, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    throw new Error(`macOS frontmost helper could not start: ${error.message}`)
  }
  const stdout = collectOutput(child.stdout)
  const stderr = collectOutput(child.stderr)
  const status = await waitForClose(
    child,
    dependencies,
    COMPILE_TIMEOUT_MS,
    'macOS frontmost helper',
  )
  return {
    stdout: stdout().trim(),
    stderr: stderr().trim(),
    code: status.code,
  }
}

export async function ensureMacProcessFrontmost(pid, helperPath, dependencies) {
  let lastPid = 'unknown'
  for (let attempt = 1; attempt <= FRONTMOST_RETRIES; attempt += 1) {
    const before = await runHelper(helperPath, ['frontmost'], dependencies)
    if (before.code === 0 && before.stdout === String(pid)) return
    if (before.code !== 0 && before.code !== 4) {
      throw new Error(`macOS frontmost helper exited with code ${String(before.code)}`)
    }
    const activation = await runHelper(helperPath, ['activate', String(pid)], dependencies)
    if (activation.code !== 0 && activation.code !== 3) {
      throw new Error(`macOS frontmost helper exited with code ${String(activation.code)}`)
    }
    await new Promise(resolve =>
      dependencies.setTimeout(resolve, FRONTMOST_SETTLE_MS),
    )
    const after = await runHelper(helperPath, ['frontmost'], dependencies)
    if (after.code === 0) {
      lastPid = after.stdout || 'unknown'
      if (lastPid === String(pid)) return
    } else if (after.code !== 4) {
      throw new Error(`macOS frontmost helper exited with code ${String(after.code)}`)
    }
  }
  throw new Error(
    `expected process ${pid} to be frontmost, got ${lastPid} after ${FRONTMOST_RETRIES} attempts`,
  )
}
