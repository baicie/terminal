/**
 * Serialised persistence for shortcut bindings.
 *
 * Two saves must never run at once: the slower one can land last and leave the
 * database holding a binding the user already changed away from. Every write waits
 * for the previous one, and the state of the last write is published so the UI can
 * say "saved" or "failed" instead of only writing to the console.
 */

import type { ShortcutPersistState } from './shortcut-persist-state'

export type ShortcutWrite = () => Promise<void>

export class ShortcutWriter {
  /** Tail of the write chain: every save waits for the previous one. */
  private chain: Promise<void> = Promise.resolve()
  private current: ShortcutPersistState = { status: 'idle', error: null }
  private readonly listeners: Array<(state: ShortcutPersistState) => void> = []

  write(run: ShortcutWrite): Promise<void> {
    this.setState({ status: 'pending', error: null })
    const next = this.chain.then(async () => {
      try {
        await run()
        this.setState({ status: 'saved', error: null })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.setState({ status: 'failed', error: message })
        throw error
      }
    })
    // The chain itself must never stay rejected, or every later write is skipped.
    this.chain = next.catch(() => undefined)
    return next
  }

  state(): ShortcutPersistState {
    return { ...this.current }
  }

  onChange(listener: (state: ShortcutPersistState) => void): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index !== -1) this.listeners.splice(index, 1)
    }
  }

  private setState(state: ShortcutPersistState): void {
    this.current = state
    this.listeners.forEach(listener => listener({ ...state }))
  }
}
