import { useAppStore } from '@/store/app'
import {
  terminalWriteBus,
  type TerminalWriteListener,
} from './terminal-write-bus'

class TerminalEmitterService {
  write(data: string, targetTabId?: string): void {
    const target = targetTabId ?? useAppStore.getState().activeTabId
    if (!target) return
    terminalWriteBus.emit(data, target)
  }

  writeCommand(command: string, targetTabId?: string): void {
    this.write(`${command}\r`, targetTabId)
  }

  onWrite(listener: TerminalWriteListener): () => void {
    return terminalWriteBus.onWrite(listener)
  }

  removeListener(listener: TerminalWriteListener): void {
    terminalWriteBus.removeListener(listener)
  }
}

export const terminalEmitter = new TerminalEmitterService()
