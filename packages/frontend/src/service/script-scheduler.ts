import type { ScriptRecord } from '@/service/database'

const MAX_TIMER_DELAY_MS = 2_147_483_647
const MIN_INTERVAL_MS = 1000

function parseTimerDelay(
  value: string | null,
  fallback: number,
  minimum: number,
): number | null {
  const text = value?.trim()
  if (!text) return fallback
  if (!/^\d+$/.test(text)) return null
  const delay = Number(text)
  return Number.isSafeInteger(delay) &&
    delay >= minimum &&
    delay <= MAX_TIMER_DELAY_MS
    ? delay
    : null
}

function isCronField(value: string, minimum: number, maximum: number): boolean {
  return value.split(',').every(part => {
    if (part === '*') return true
    const range = part.split('-')
    if (range.length > 2 || range.some(item => !/^\d+$/.test(item))) {
      return false
    }
    const start = Number(range[0])
    const end = Number(range[1] ?? range[0])
    return start >= minimum && end <= maximum && start <= end
  })
}

function isValidCronExpression(value: string | null): boolean {
  const fields = value?.trim().split(/\s+/) ?? []
  const bounds = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ] as const
  return (
    fields.length === bounds.length &&
    fields.every((field, index) =>
      isCronField(field, bounds[index][0], bounds[index][1]),
    )
  )
}

export class ScriptScheduler {
  private scheduleTimerIds = new Map<
    string,
    ReturnType<typeof setTimeout>
  >()
  private runningScriptIds = new Set<string>()

  constructor(
    private readonly executeScript: (scriptId: string) => Promise<unknown>,
  ) {}

  start(script: ScriptRecord): void {
    this.stop(script.id)
    if (!script.enabled) return
    switch (script.schedule_type) {
      case 'once': {
        const delay = parseTimerDelay(script.schedule_value, 0, 0)
        if (delay === null) return
        const timeoutId = setTimeout(() => {
          this.scheduleTimerIds.delete(script.id)
          void this.run(script.id)
        }, delay)
        this.scheduleTimerIds.set(script.id, timeoutId)
        break
      }
      case 'interval': {
        const intervalMs = parseTimerDelay(
          script.schedule_value,
          60000,
          MIN_INTERVAL_MS,
        )
        if (intervalMs === null) return
        this.scheduleTimerIds.set(
          script.id,
          setInterval(() => {
            void this.run(script.id)
          }, intervalMs),
        )
        break
      }
      case 'cron':
        if (!isValidCronExpression(script.schedule_value)) return
        this.scheduleTimerIds.set(
          script.id,
          setInterval(() => {
            this.checkCronAndExecute(script)
          }, 60000),
        )
        break
    }
  }

  stop(scriptId: string): void {
    const timerId = this.scheduleTimerIds.get(scriptId)
    if (timerId !== undefined) {
      clearTimeout(timerId)
      clearInterval(timerId)
      this.scheduleTimerIds.delete(scriptId)
    }
  }

  private async run(scriptId: string): Promise<void> {
    if (this.runningScriptIds.has(scriptId)) return
    this.runningScriptIds.add(scriptId)
    try {
      await this.executeScript(scriptId)
    } catch {
      console.error('[ScriptScheduler] Scheduled script execution failed')
    } finally {
      this.runningScriptIds.delete(scriptId)
    }
  }

  private checkCronAndExecute(script: ScriptRecord): void {
    if (script.schedule_type !== 'cron' || !script.schedule_value) return
    const now = new Date()
    const [min, hour, day, month, weekday] = script.schedule_value
      .trim()
      .split(/\s+/)
    const matches = (pattern: string, current: string): boolean => {
      if (pattern === '*') return true
      if (pattern.includes(','))
        return pattern.split(',').some(part => matches(part, current))
      if (pattern.includes('-')) {
        const [start, end] = pattern.split('-').map(Number)
        const value = Number.parseInt(current, 10)
        return value >= start && value <= end
      }
      return pattern === current
    }
    if (
      matches(min, now.getMinutes().toString()) &&
      matches(hour, now.getHours().toString()) &&
      matches(day, now.getDate().toString()) &&
      matches(month, (now.getMonth() + 1).toString()) &&
      matches(weekday, now.getDay().toString())
    )
      void this.run(script.id)
  }
}
