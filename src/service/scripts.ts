import {
  type ScriptRecord,
  type ScriptExecutionRecord,
  createScript,
  updateScript,
  deleteScript as dbDeleteScript,
  getScripts,
  getScriptById,
  getEnabledScripts,
  searchScripts,
  toggleScriptEnabled,
  addScriptExecution,
  updateScriptExecution,
  getScriptExecutions,
  getScriptExecutionById,
  deleteScriptExecution,
  clearScriptExecutions,
  type Host,
  getHosts,
} from '@/service/database'
import { SSHService, type SSHOutput } from '@/service/ssh'

export interface BatchExecutionResult {
  hostId: string
  hostName: string
  hostAddress: string
  status: 'success' | 'failed' | 'timeout'
  output?: string
  error?: string
  durationMs: number
}

export interface ScriptExecutionResult {
  success: boolean
  results: BatchExecutionResult[]
  totalHosts: number
  successCount: number
  failedCount: number
}

export class ScriptService {
  private sshService: SSHService
  private scheduleIntervalIds: Map<string, ReturnType<typeof setInterval>> =
    new Map()

  constructor() {
    this.sshService = new SSHService()
  }

  async createScript(data: {
    name: string
    description?: string
    script: string
    hostIds: string[]
    scheduleType?: 'manual' | 'once' | 'interval' | 'cron'
    scheduleValue?: string
    timeoutSeconds?: number
    retryCount?: number
  }): Promise<string> {
    const now = Date.now()
    const script: ScriptRecord = {
      id: crypto.randomUUID(),
      name: data.name,
      description: data.description || null,
      script: data.script,
      host_ids: JSON.stringify(data.hostIds),
      schedule_type: data.scheduleType || 'manual',
      schedule_value: data.scheduleValue || null,
      enabled: 1,
      timeout_seconds: data.timeoutSeconds || 60,
      retry_count: data.retryCount || 0,
      created_at: now,
      updated_at: now,
    }
    await createScript(script)
    return script.id
  }

  async updateScript(
    id: string,
    data: Partial<{
      name: string
      description: string
      script: string
      hostIds: string[]
      scheduleType: 'manual' | 'once' | 'interval' | 'cron'
      scheduleValue: string
      timeoutSeconds: number
      retryCount: number
    }>,
  ): Promise<void> {
    const existing = await getScriptById(id)
    if (!existing) throw new Error('Script not found')

    const script: ScriptRecord = {
      ...existing,
      name: data.name ?? existing.name,
      description: data.description ?? existing.description,
      script: data.script ?? existing.script,
      host_ids: data.hostIds ? JSON.stringify(data.hostIds) : existing.host_ids,
      schedule_type: data.scheduleType ?? existing.schedule_type,
      schedule_value: data.scheduleValue ?? existing.schedule_value,
      timeout_seconds: data.timeoutSeconds ?? existing.timeout_seconds,
      retry_count: data.retryCount ?? existing.retry_count,
      updated_at: Date.now(),
    }
    await updateScript(script)
  }

  async deleteScript(id: string): Promise<void> {
    this.stopSchedule(id)
    await dbDeleteScript(id)
  }

  async getAllScripts(): Promise<ScriptRecord[]> {
    return getScripts()
  }

  async getScript(id: string): Promise<ScriptRecord | null> {
    return getScriptById(id)
  }

  async getEnabledScripts(): Promise<ScriptRecord[]> {
    return getEnabledScripts()
  }

  async searchScripts(query: string): Promise<ScriptRecord[]> {
    return searchScripts(query)
  }

  async toggleEnabled(id: string): Promise<void> {
    await toggleScriptEnabled(id)
    const script = await getScriptById(id)
    if (script && script.enabled) {
      this.startSchedule(script)
    } else {
      this.stopSchedule(id)
    }
  }

  async executeScript(scriptId: string): Promise<ScriptExecutionResult> {
    const script = await getScriptById(scriptId)
    if (!script) throw new Error('Script not found')

    const hostIds: string[] = JSON.parse(script.host_ids || '[]')
    if (hostIds.length === 0) {
      return {
        success: false,
        results: [],
        totalHosts: 0,
        successCount: 0,
        failedCount: 0,
      }
    }

    return this.executeOnHosts(script.script, hostIds, script.timeout_seconds)
  }

  async executeOnHosts(
    command: string,
    hostIds: string[],
    _timeoutSeconds = 60,
  ): Promise<ScriptExecutionResult> {
    const hosts = await getHosts()
    const targetHosts = hosts.filter(h => hostIds.includes(h.id))

    if (targetHosts.length === 0) {
      return {
        success: false,
        results: [],
        totalHosts: 0,
        successCount: 0,
        failedCount: 0,
      }
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

    const results: BatchExecutionResult[] = await Promise.all(
      targetHosts.map(async host => {
        const startTime = Date.now()
        const hostExecId = await addScriptExecution({
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
          const output = await this.sshService.execute(host, command)
          const durationMs = Date.now() - startTime
          const status = output.exitCode === 0 ? 'success' : 'failed'
          const fullOutput =
            output.stdout +
            (output.stderr ? `\n[STDERR]\n${output.stderr}` : '')

          await updateScriptExecution(hostExecId, {
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
        } catch (err) {
          const durationMs = Date.now() - startTime
          const errorMsg = err instanceof Error ? err.message : String(err)

          await updateScriptExecution(hostExecId, {
            status: 'failed',
            error: errorMsg,
            ended_at: Date.now(),
            duration_ms: durationMs,
          })

          return {
            hostId: host.id,
            hostName: host.name,
            hostAddress: `${host.hostname}:${host.port}`,
            status: 'failed' as const,
            error: errorMsg,
            durationMs,
          }
        }
      }),
    )

    const successCount = results.filter(r => r.status === 'success').length
    const failedCount = results.filter(r => r.status === 'failed').length

    await updateScriptExecution(executionId, {
      status:
        failedCount === 0
          ? 'success'
          : failedCount === successCount
            ? 'failed'
            : 'success',
      output: JSON.stringify(results),
      ended_at: Date.now(),
      duration_ms: results.reduce((sum, r) => sum + r.durationMs, 0),
    })

    return {
      success: failedCount === 0,
      results,
      totalHosts: targetHosts.length,
      successCount,
      failedCount,
    }
  }

  async executeSingleHost(
    host: Host,
    command: string,
    _timeoutMs = 60000,
  ): Promise<SSHOutput> {
    return this.sshService.execute(host, command)
  }

  startSchedule(script: ScriptRecord): void {
    this.stopSchedule(script.id)

    if (!script.enabled) return

    switch (script.schedule_type) {
      case 'once': {
        const delay = script.schedule_value
          ? parseInt(script.schedule_value, 10)
          : 0
        const timeoutId = setTimeout(() => {
          this.executeScript(script.id)
        }, delay)
        this.scheduleIntervalIds.set(
          script.id,
          timeoutId as unknown as ReturnType<typeof setInterval>,
        )
        break
      }
      case 'interval': {
        const intervalMs = script.schedule_value
          ? parseInt(script.schedule_value, 10)
          : 60000
        const intervalId = setInterval(() => {
          this.executeScript(script.id)
        }, intervalMs)
        this.scheduleIntervalIds.set(script.id, intervalId)
        break
      }
      case 'cron': {
        // Simplified cron: value format "minute hour day month weekday"
        // For simplicity, we'll use a 1-minute interval check
        const intervalId = setInterval(() => {
          this.checkCronAndExecute(script)
        }, 60000)
        this.scheduleIntervalIds.set(script.id, intervalId)
        break
      }
    }
  }

  stopSchedule(scriptId: string): void {
    const intervalId = this.scheduleIntervalIds.get(scriptId)
    if (intervalId) {
      clearInterval(intervalId)
      this.scheduleIntervalIds.delete(scriptId)
    }
  }

  private checkCronAndExecute(script: ScriptRecord): void {
    if (script.schedule_type !== 'cron' || !script.schedule_value) return

    const now = new Date()
    const [min, hour, day, month, weekday] = script.schedule_value.split(' ')
    const currentMin = now.getMinutes().toString()
    const currentHour = now.getHours().toString()
    const currentDay = now.getDate().toString()
    const currentMonth = (now.getMonth() + 1).toString()
    const currentWeekday = now.getDay().toString()

    const matches = (pattern: string, current: string) => {
      if (pattern === '*') return true
      if (pattern.includes(',')) return pattern.split(',').includes(current)
      if (pattern.includes('-')) {
        const [start, end] = pattern.split('-').map(Number)
        const curr = parseInt(current, 10)
        return curr >= start && curr <= end
      }
      return pattern === current
    }

    if (
      matches(min, currentMin) &&
      matches(hour, currentHour) &&
      matches(day, currentDay) &&
      matches(month, currentMonth) &&
      matches(weekday, currentWeekday)
    ) {
      this.executeScript(script.id)
    }
  }

  async initSchedules(): Promise<void> {
    const enabledScripts = await getEnabledScripts()
    for (const script of enabledScripts) {
      this.startSchedule(script)
    }
  }

  async getExecutions(
    scriptId?: string,
    limit = 100,
  ): Promise<ScriptExecutionRecord[]> {
    return getScriptExecutions(scriptId, limit)
  }

  async getExecution(id: string): Promise<ScriptExecutionRecord | null> {
    return getScriptExecutionById(id)
  }

  async deleteExecution(id: string): Promise<void> {
    await deleteScriptExecution(id)
  }

  async clearExecutions(scriptId?: string): Promise<void> {
    await clearScriptExecutions(scriptId)
  }
}

export const scriptService = new ScriptService()
