import { useAppStore } from '@/store/app'

type WriteListener = (data: string, targetTabId?: string) => void

class TerminalEmitterService {
  private listeners: Set<WriteListener> = new Set()

  write(data: string, targetTabId?: string): void {
    const target = targetTabId ?? useAppStore.getState().activeTabId
    if (!target) return
    this.listeners.forEach(listener => listener(data, target))
  }

  writeCommand(command: string, targetTabId?: string): void {
    this.write(`${command}\r`, targetTabId)
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
