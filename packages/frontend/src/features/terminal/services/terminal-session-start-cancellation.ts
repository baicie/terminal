import type { TerminalRecord } from './terminal-session-manager-types'

interface StartCancellation {
  signal: AbortSignal
  cleanup: () => void
}

export class TerminalSessionStartCancellation {
  private readonly controllers = new WeakMap<
    TerminalRecord,
    Set<AbortController>
  >()

  create(
    record: TerminalRecord,
    parentSignal?: AbortSignal,
  ): StartCancellation {
    const controller = new AbortController()
    const controllers = this.controllers.get(record) ?? new Set()
    controllers.add(controller)
    this.controllers.set(record, controllers)

    const abortFromParent = () => controller.abort(parentSignal?.reason)
    parentSignal?.addEventListener('abort', abortFromParent, { once: true })
    if (parentSignal?.aborted) abortFromParent()

    return {
      signal: controller.signal,
      cleanup: () => {
        parentSignal?.removeEventListener('abort', abortFromParent)
        controllers.delete(controller)
        if (
          controllers.size === 0 &&
          this.controllers.get(record) === controllers
        ) {
          this.controllers.delete(record)
        }
      },
    }
  }

  abort(record: TerminalRecord): void {
    for (const controller of this.controllers.get(record) ?? []) {
      controller.abort()
    }
    this.controllers.delete(record)
  }
}
