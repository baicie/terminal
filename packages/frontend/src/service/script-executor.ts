import {
  addScriptExecution,
  getHosts,
  updateScriptExecution,
} from '@/service/database'
import type { Host } from '@/types'
import type { SSHService } from '@/service/ssh'
import type {
  BatchExecutionResult,
  ScriptExecutionResult,
} from './scripts-types'

/** Hosts contacted at once; a batch must not open every session simultaneously. */
const MAX_CONCURRENT_HOSTS = 5
const RETRY_BASE_DELAY_MS = 200
const RETRY_MAX_DELAY_MS = 10_000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Jittered exponential backoff: 50%–100% of base * 2^attempt. */
function retryDelayMs(attempt: number): number {
  const window = Math.min(
    RETRY_BASE_DELAY_MS * 2 ** attempt,
    RETRY_MAX_DELAY_MS,
  )
  return Math.round(window * (0.5 + Math.random() * 0.5))
}

async function executeWithRetry(
  sshService: SSHService,
  host: Parameters<SSHService['execute']>[0],
  command: string,
  timeoutMs: number,
  retryCount: number,
) {
  const attempts = Math.min(Math.max(Math.trunc(retryCount), 0), 10) + 1
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const output = await sshService.execute(host, command, timeoutMs)
      if (output.exitCode === 0 || attempt === attempts - 1) return output
    } catch (error) {
      if (attempt === attempts - 1) throw error
    }
    await sleep(retryDelayMs(attempt))
  }
  throw new Error('Script execution ended without a result')
}

/** Run `run` over `items` with at most `limit` in flight, preserving order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await run(items[index])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  )
  return results
}

async function executeOnHost(
  sshService: SSHService,
  host: Host,
  command: string,
  timeoutMs: number,
  retryCount: number,
): Promise<BatchExecutionResult> {
  const startTime = Date.now()
  const hostExecutionId = await addScriptExecution({
    script_id: '',
    script_name: command.substring(0, 50),
    host_id: host.id,
    host_name: host.name,
    host_address: `${host.hostname}:${host.port}`,
    status: 'running',
    output: null,
    error: null,
    started_at: startTime,
    ended_at: null,
    duration_ms: null,
  })
  try {
    const output = await executeWithRetry(
      sshService,
      host,
      command,
      timeoutMs,
      retryCount,
    )
    const durationMs = Date.now() - startTime
    const status = output.exitCode === 0 ? 'success' : 'failed'
    const fullOutput =
      output.stdout + (output.stderr ? `\n[STDERR]\n${output.stderr}` : '')
    await updateScriptExecution(hostExecutionId, {
      status,
      output: fullOutput,
      ended_at: Date.now(),
      duration_ms: durationMs,
    })
    return {
      hostId: host.id,
      hostName: host.name,
      hostAddress: `${host.hostname}:${host.port}`,
      status,
      output: fullOutput,
      durationMs,
    } as BatchExecutionResult
  } catch (error) {
    const durationMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    await updateScriptExecution(hostExecutionId, {
      status: 'failed',
      error: errorMessage,
      ended_at: Date.now(),
      duration_ms: durationMs,
    })
    return {
      hostId: host.id,
      hostName: host.name,
      hostAddress: `${host.hostname}:${host.port}`,
      status: 'failed' as const,
      error: errorMessage,
      durationMs,
    }
  }
}

export async function executeOnHosts(
  sshService: SSHService,
  command: string,
  hostIds: string[],
  timeoutSeconds = 60,
  retryCount = 0,
): Promise<ScriptExecutionResult> {
  const timeoutMs =
    Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
      ? Math.min(Math.trunc(timeoutSeconds), 86_400) * 1000
      : 60_000
  const hosts = await getHosts()
  const targetHosts = hosts.filter(host => hostIds.includes(host.id))
  if (targetHosts.length === 0)
    return {
      success: false,
      results: [],
      totalHosts: 0,
      successCount: 0,
      failedCount: 0,
    }

  const executionId = await addScriptExecution({
    script_id: '',
    script_name: 'Batch Execution',
    host_id: null,
    host_name: null,
    host_address: null,
    status: 'running',
    output: null,
    error: null,
    started_at: Date.now(),
    ended_at: null,
    duration_ms: null,
  })
  const results = await mapWithConcurrency(
    targetHosts,
    MAX_CONCURRENT_HOSTS,
    host => executeOnHost(sshService, host, command, timeoutMs, retryCount),
  )
  const successCount = results.filter(
    result => result.status === 'success',
  ).length
  const failedCount = results.filter(
    result => result.status === 'failed',
  ).length
  await updateScriptExecution(executionId, {
    status:
      failedCount === 0
        ? 'success'
        : failedCount === results.length
          ? 'failed'
          : 'partial',
    output: JSON.stringify(results),
    ended_at: Date.now(),
    duration_ms: results.reduce((sum, result) => sum + result.durationMs, 0),
  })
  return {
    success: failedCount === 0,
    results,
    totalHosts: targetHosts.length,
    successCount,
    failedCount,
  }
}
