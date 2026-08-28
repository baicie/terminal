export type TerminalWriteListener = (
  data: string,
  targetTabId?: string,
) => void

class TerminalWriteBus {
  private readonly listeners = new Set<TerminalWriteListener>()

  emit(data: string, targetTabId: string): void {
    for (const listener of this.listeners) listener(data, targetTabId)
  }

  onWrite(listener: TerminalWriteListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  removeListener(listener: TerminalWriteListener): void {
    this.listeners.delete(listener)
  }
}

export const terminalWriteBus = new TerminalWriteBus()
