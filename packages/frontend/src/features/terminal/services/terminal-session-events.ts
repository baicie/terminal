import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ShellOutput, TabType } from '../types'

interface TerminalEventHandlers {
  onOutput: (output: ShellOutput) => void
  onClose: (sessionId: string) => void
  onExit: (sessionId: string, exitCode: number) => void
}

const EVENT_NAMES: Record<
  TabType,
  { data: string; close: string; exit?: string }
> = {
  local: { data: 'local-data', close: 'local-close' },
  remote: { data: 'ssh-data', close: 'ssh-close', exit: 'ssh-exit' },
  serial: { data: 'serial-data', close: 'serial-close' },
}

export class TerminalSessionEvents {
  private readonly channelListeners = new Map<TabType, Promise<UnlistenFn[]>>()

  constructor(private readonly handlers: TerminalEventHandlers) {}

  async ensure(tabType: TabType): Promise<void> {
    const existing = this.channelListeners.get(tabType)
    if (existing) {
      await existing
      return
    }

    const promise = this.create(tabType)
    this.channelListeners.set(tabType, promise)
    try {
      await promise
    } catch (error) {
      this.channelListeners.delete(tabType)
      throw error
    }
  }

  private async create(tabType: TabType): Promise<UnlistenFn[]> {
    const names = EVENT_NAMES[tabType]
    const unlisteners: UnlistenFn[] = []
    try {
      unlisteners.push(
        await listen<ShellOutput>(names.data, event => {
          this.handlers.onOutput(event.payload)
        }),
      )
      unlisteners.push(
        await listen<string>(names.close, event => {
          this.handlers.onClose(event.payload)
        }),
      )
      if (names.exit) {
        unlisteners.push(
          await listen<[string, number]>(names.exit, event => {
            this.handlers.onExit(event.payload[0], event.payload[1])
          }),
        )
      }
      return unlisteners
    } catch (error) {
      for (const unlisten of unlisteners) unlisten()
      throw error
    }
  }
}
