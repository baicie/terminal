import type { TerminalRecord } from './terminal-session-manager-types'

export class TerminalSessionRecoveryTimer {
  private readonly timers = new WeakMap<
    TerminalRecord,
    ReturnType<typeof setTimeout>
  >()

  schedule(record: TerminalRecord, delayMs: number, callback: () => void): void {
    this.clear(record)
    const timer = setTimeout(() => {
      this.timers.delete(record)
      callback()
    }, delayMs)
    this.timers.set(record, timer)
    const unref = (timer as ReturnType<typeof setTimeout> & {
      unref?: () => void
    }).unref
    unref?.call(timer)
  }

  clear(record: TerminalRecord): void {
    const timer = this.timers.get(record)
    if (timer === undefined) return
    clearTimeout(timer)
    this.timers.delete(record)
  }
}
