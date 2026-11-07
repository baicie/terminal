/**
 * Process/database quiescence probes.
 *
 * Only facts that can be observed are marked PASS. A missing lsof/pgrep or an
 * unobservable process tree is NOT_RUN, never a fabricated PASS.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import process from 'node:process'
import { delay } from './process-lifecycle.mjs'

export const QUIESCENCE_FACTS = [
  'PROCESS_EXITED',
  'STREAMS_CLOSED',
  'OWNED_CHILDREN_SETTLED',
  'DB_HANDLES_RELEASED',
]

/**
 * Snapshot every descendant of `pid` before it is signalled. The Tauri app
 * spawns PTY shells and helper processes as children; after the app exits they
 * are reparented, so this must run first.
 */
function windowsChildren(pid) {
  const script = "Get-CimInstance Win32_Process -Filter 'ParentProcessId=" + pid +
    "' -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessId }"
  for (const shell of ['powershell.exe', 'pwsh.exe']) {
    try {
      const output = execFileSync(shell, ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return output.split('\n').map(line => Number(line.trim())).filter(Number.isInteger)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
  }
  throw Object.assign(new Error('neither powershell.exe nor pwsh.exe is available'), { code: 'ENOENT' })
}

export function snapshotDescendants(pid, { pgrep = 'pgrep' } = {}) {
  if (!pid) return { supported: false, pids: [], reason: 'no pid' }
  if (process.platform === 'win32') {
    const seen = new Set()
    const queue = [pid]
    try {
      while (queue.length > 0) {
        const current = queue.shift()
        for (const child of windowsChildren(current)) {
          if (child <= 0 || seen.has(child)) continue
          seen.add(child)
          queue.push(child)
        }
      }
    } catch (error) {
      return { supported: false, pids: [...seen], reason: String(error?.message || error) }
    }
    return { supported: true, pids: [...seen] }
  }
  const seen = new Set()
  const queue = [pid]
  try {
    while (queue.length > 0) {
      const current = queue.shift()
      const output = execFileSync(pgrep, ['-P', String(current)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      for (const line of output.split('\n')) {
        const child = Number(line.trim())
        if (!Number.isInteger(child) || child <= 0 || seen.has(child)) continue
        seen.add(child)
        queue.push(child)
      }
    }
  } catch (error) {
    // pgrep exits 1 when the process has no children; that is a real
    // observation. ENOENT means the probe itself is unavailable.
    if (error?.status === 1 || error?.code === 1) {
      return { supported: true, pids: [...seen] }
    }
    if (error?.code === 'ENOENT') {
      return { supported: false, pids: [...seen], reason: 'pgrep is unavailable' }
    }
    return { supported: false, pids: [...seen], reason: String(error?.message || error) }
  }
  return { supported: true, pids: [...seen] }
}

export function alivePids(pids) {
  const alive = []
  for (const pid of pids || []) {
    try {
      process.kill(pid, 0)
      alive.push(pid)
    } catch (error) {
      // ESRCH: gone. EPERM: exists but owned by another user.
      if (error?.code !== 'ESRCH') alive.push(pid)
    }
  }
  return alive
}

/**
 * Wait briefly for recorded descendants to disappear. A child that is still
 * alive after the grace period is a leak, not a timing artifact.
 */
export async function settledChildren(pids, { timeoutMs = 2_000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs
  let alive = alivePids(pids)
  while (alive.length > 0 && Date.now() < deadline) {
    await delay(intervalMs)
    alive = alivePids(pids)
  }
  return alive
}

export function assessProcessQuiescence(stopResult, { dbHandles = null, aliveChildren = undefined } = {}) {
  const facts = {
    PROCESS_EXITED: stopResult?.exitObserved === true ? 'PASS' : 'FAIL',
    STREAMS_CLOSED: stopResult?.closeObserved === true &&
      stopResult?.stdoutClosed !== false && stopResult?.stderrClosed !== false
      ? 'PASS' : 'FAIL',
    OWNED_CHILDREN_SETTLED: aliveChildren === undefined
      ? 'NOT_RUN'
      : aliveChildren.length === 0 ? 'PASS' : 'FAIL',
    DB_HANDLES_RELEASED: dbHandles === null
      ? 'NOT_RUN'
      : dbHandles.length === 0 ? 'PASS' : 'FAIL',
  }
  const required = ['PROCESS_EXITED', 'STREAMS_CLOSED', 'OWNED_CHILDREN_SETTLED', 'DB_HANDLES_RELEASED']
  const failed = required.filter(name => facts[name] === 'FAIL')
  const missing = required.filter(name => facts[name] === 'NOT_RUN')
  const overall = failed.length > 0 ? 'FAIL' : missing.length > 0 ? 'PARTIAL' : 'PASS'
  return { overall, required, failed, missing, facts, dbHandles: dbHandles || [], aliveChildren: aliveChildren || [] }
}

export function probeDatabaseHandles(dbPaths, { lsof = 'lsof' } = {}) {
  const paths = [...new Set((dbPaths || []).filter(existsSync))]
  if (paths.length === 0) return { supported: true, pids: [] }
  if (process.platform === 'win32') return { supported: false, pids: [] }
  try {
    const output = execFileSync(lsof, ['-nP', '-t', '--', ...paths], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return { supported: true, pids: output ? output.split('\n').map(Number) : [] }
  } catch (error) {
    // lsof exits 1 when no process holds the file; distinguish that from a
    // missing binary. ENOENT means the probe is NOT_RUN.
    if (error?.code === 'ENOENT') return { supported: false, pids: [] }
    if (error?.status === 1 || error?.code === 1) return { supported: true, pids: [] }
    return { supported: false, pids: [], error: String(error?.message || error) }
  }
}

export async function requireQuiescent(stopResult, dbPaths, { label = 'process', childrenTimeoutMs = 2_000 } = {}) {
  const probe = probeDatabaseHandles(dbPaths)
  const owned = stopResult?.ownedChildren
  const aliveChildren = owned?.supported === true
    ? await settledChildren(owned.pids, { timeoutMs: childrenTimeoutMs })
    : undefined
  const assessment = assessProcessQuiescence(stopResult, {
    dbHandles: probe.supported ? probe.pids : null,
    aliveChildren,
  })
  if (assessment.overall === 'FAIL') {
    throw new Error(label + ' quiescence failed: ' + assessment.failed.join(',') +
      (assessment.aliveChildren.length > 0 ? ' (alive children: ' + assessment.aliveChildren.join(',') + ')' : ''))
  }
  return { ...assessment, lsofSupported: probe.supported, ownedChildrenSupported: owned?.supported === true }
}
