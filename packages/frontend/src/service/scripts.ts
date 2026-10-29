import type { Host } from '@/types'
import type { ScriptExecutionRecord, ScriptRecord } from '@/service/database'
import type { SSHOutput } from '@/service/ssh'
import {
  clearScriptExecutions,
  createScript,
  deleteScript as dbDeleteScript,
  deleteScriptExecution,
  getEnabledScripts,
  getScriptById,
  getScriptExecutionById,
  getScriptExecutions,
  getScripts,
  searchScripts,
  toggleScriptEnabled,
  updateScript,
} from '@/service/database'
import { SSHService } from '@/service/ssh'
import { executeOnHosts } from './script-executor'
import { ScriptScheduler } from './script-scheduler'
import type { ScriptExecutionResult } from './scripts-types'

export type {
  BatchExecutionResult,
  ScriptExecutionResult,
} from './scripts-types'

export class ScriptService {
  private readonly sshService = new SSHService()
  private readonly scheduler = new ScriptScheduler(scriptId =>
    this.executeScript(scriptId),
  )

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
    await updateScript({
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
    })
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
    if (script && script.enabled) this.startSchedule(script)
    else this.stopSchedule(id)
  }

  async executeScript(scriptId: string): Promise<ScriptExecutionResult> {
    const script = await getScriptById(scriptId)
    if (!script) throw new Error('Script not found')
    if (script.schedule_type === 'once' && script.enabled) {
      this.scheduler.stop(script.id)
      await toggleScriptEnabled(script.id)
    }
    const hostIds: string[] = JSON.parse(script.host_ids || '[]')
    if (hostIds.length === 0)
      return {
        success: false,
        results: [],
        totalHosts: 0,
        successCount: 0,
        failedCount: 0,
      }
    return this.executeOnHosts(
      script.script,
      hostIds,
      script.timeout_seconds,
      script.retry_count,
    )
  }

  async executeOnHosts(
    command: string,
    hostIds: string[],
    timeoutSeconds = 60,
    retryCount = 0,
  ): Promise<ScriptExecutionResult> {
    return executeOnHosts(
      this.sshService,
      command,
      hostIds,
      timeoutSeconds,
      retryCount,
    )
  }
  async executeSingleHost(
    host: Host,
    command: string,
    timeoutMs = 60000,
  ): Promise<SSHOutput> {
    return this.sshService.execute(host, command, timeoutMs)
  }
  startSchedule(script: ScriptRecord): void {
    this.scheduler.start(script)
  }
  stopSchedule(scriptId: string): void {
    this.scheduler.stop(scriptId)
  }

  async initSchedules(): Promise<void> {
    for (const script of await getEnabledScripts()) this.startSchedule(script)
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
