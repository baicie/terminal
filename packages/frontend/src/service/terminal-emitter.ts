import { useAppStore } from '@/store/app'

type WriteListener = (data: string, targetTabId?: string) => void

class TerminalEmitterService {
  private listeners: Set<WriteListener> = new Set()

  write(data: string, targetTabId?: string): void {
    this.listeners.forEach(listener => listener(data, targetTabId))
  }

  writeCommand(command: string, targetTabId?: string): void {
    const target =
      targetTabId ?? useAppStore.getState().activeTabId ?? undefined
    this.write(`${command}\r`, target)
  }

  onWrite(listener: WriteListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  removeListener(listener: WriteListener): void {
    this.listeners.delete(listener)
  }
}

export const terminalEmitter = new TerminalEmitterService()
