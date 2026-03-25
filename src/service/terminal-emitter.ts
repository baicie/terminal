type WriteListener = (data: string) => void

class TerminalEmitterService {
  private listeners: Set<WriteListener> = new Set()

  write(data: string): void {
    this.listeners.forEach(listener => listener(data))
  }

  writeCommand(command: string): void {
    this.write(`${command}\r`)
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
