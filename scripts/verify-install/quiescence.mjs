/**
 * Process/database quiescence probes.
 *
 * Only facts that can be observed are marked PASS. A missing lsof or an
 * unobservable process tree is NOT_RUN, never a fabricated PASS.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import process from 'node:process'

export const QUIESCENCE_FACTS = [
  'PROCESS_EXITED',
  'STREAMS_CLOSED',
  'OWNED_CHILDREN_SETTLED',
  'DB_HANDLES_RELEASED',
]

export function assessProcessQuiescence(stopResult, { dbHandles = null } = {}) {
  const facts = {
    PROCESS_EXITED: stopResult?.exitObserved === true ? 'PASS' : 'FAIL',
    STREAMS_CLOSED: stopResult?.closeObserved === true &&
      stopResult?.stdoutClosed !== false && stopResult?.stderrClosed !== false
      ? 'PASS' : 'FAIL',
    OWNED_CHILDREN_SETTLED: 'NOT_RUN',
    DB_HANDLES_RELEASED: dbHandles === null
      ? 'NOT_RUN'
      : dbHandles.length === 0 ? 'PASS' : 'FAIL',
  }
  const required = ['PROCESS_EXITED', 'STREAMS_CLOSED', 'DB_HANDLES_RELEASED']
  const failed = required.filter(name => facts[name] === 'FAIL')
  const missing = required.filter(name => facts[name] === 'NOT_RUN')
  const overall = failed.length > 0 ? 'FAIL' : missing.length > 0 ? 'PARTIAL' : 'PASS'
  return { overall, required, failed, missing, facts, dbHandles: dbHandles || [] }
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

export function requireQuiescent(stopResult, dbPaths, { label = 'process' } = {}) {
  const probe = probeDatabaseHandles(dbPaths)
  const assessment = assessProcessQuiescence(stopResult, {
    dbHandles: probe.supported ? probe.pids : null,
  })
  if (assessment.overall === 'FAIL') {
    throw new Error(label + ' quiescence failed: ' + assessment.failed.join(','))
  }
  return { ...assessment, lsofSupported: probe.supported }
}
