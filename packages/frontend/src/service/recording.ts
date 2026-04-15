// Terminal Recording Service - Record and replay terminal sessions

import type { Terminal } from '@baicie/xterm'

export interface RecordingFrame {
  timestamp: number
  type: 'input' | 'output' | 'resize'
  data: string
  cols?: number
  rows?: number
}

export interface Recording {
  id: string
  name: string
  startTime: number
  endTime: number
  frames: RecordingFrame[]
  cols: number
  rows: number
}

export type RecordingEventCallback = (frame: RecordingFrame) => void

class TerminalRecordingService {
  private recordings: Map<string, Recording> = new Map()
  private currentRecording: Recording | null = null
  private listener: RecordingEventCallback | null = null

  /**
   * Start recording a terminal session
   */
  startRecording(name: string, cols: number, rows: number): string {
    const id = `recording-${Date.now()}`

    this.currentRecording = {
      id,
      name,
      startTime: Date.now(),
      endTime: 0,
      frames: [],
      cols,
      rows,
    }

    this.recordings.set(id, this.currentRecording)

    return id
  }

  /**
   * Stop recording
   */
  stopRecording(): Recording | null {
    if (!this.currentRecording) return null

    this.currentRecording.endTime = Date.now()
    const recording = this.currentRecording
    this.currentRecording = null

    return recording
  }

  /**
   * Record a frame
   */
  recordFrame(frame: RecordingFrame): void {
    if (!this.currentRecording) return

    this.currentRecording.frames.push(frame)
    this.listener?.(frame)
  }

  /**
   * Set event listener
   */
  setListener(callback: RecordingEventCallback | null): void {
    this.listener = callback
  }

  /**
   * Get recording by ID
   */
  getRecording(id: string): Recording | undefined {
    return this.recordings.get(id)
  }

  /**
   * List all recordings
   */
  listRecordings(): Recording[] {
    return Array.from(this.recordings.values())
  }

  /**
   * Delete recording
   */
  deleteRecording(id: string): boolean {
    return this.recordings.delete(id)
  }

  /**
   * Replay recording on a terminal
   */
  async replayRecording(
    recording: Recording,
    terminal: Terminal,
    onProgress?: (current: number, total: number) => void,
  ): Promise<void> {
    const frames = recording.frames
    const total = frames.length

    for (let i = 0; i < total; i++) {
      const frame = frames[i]

      // Calculate delay based on timestamp
      if (i > 0) {
        const prevFrame = frames[i - 1]
        const delay = Math.min(frame.timestamp - prevFrame.timestamp, 1000)
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }

      // Replay frame
      switch (frame.type) {
        case 'input':
          terminal.write(frame.data)
          break
        case 'output':
          terminal.write(frame.data)
          break
        case 'resize':
          // Terminal resize would need to be handled externally
          break
      }

      onProgress?.(i + 1, total)
    }
  }

  /**
   * Export recording to JSON
   */
  exportRecording(recording: Recording): string {
    return JSON.stringify(recording, null, 2)
  }

  /**
   * Import recording from JSON
   */
  importRecording(json: string): Recording | null {
    try {
      const recording = JSON.parse(json) as Recording
      if (recording.id && recording.frames && recording.name) {
        this.recordings.set(recording.id, recording)
        return recording
      }
    } catch {
      // Invalid JSON
    }
    return null
  }

  /**
   * Create a wrapper around terminal to auto-record
   */
  createRecordingTerminal(
    terminal: Terminal,
    name: string,
    onFrame?: RecordingEventCallback,
  ): { terminal: Terminal; recordingId: string; stop: () => Recording } {
    const recordingId = this.startRecording(name, terminal.cols, terminal.rows)

    // Wrap write method
    const originalWrite = terminal.write.bind(terminal)
    terminal.write = (data: string | Uint8Array) => {
      originalWrite(data)
      const frame: RecordingFrame = {
        timestamp: Date.now(),
        type: 'output',
        data: typeof data === 'string' ? data : new TextDecoder().decode(data),
      }
      this.recordFrame(frame)
      onFrame?.(frame)
    }

    // Listen for resize
    terminal.onResize(({ cols, rows }) => {
      const frame: RecordingFrame = {
        timestamp: Date.now(),
        type: 'resize',
        data: '',
        cols,
        rows,
      }
      this.recordFrame(frame)
      onFrame?.(frame)
    })

    const stop = (): Recording => {
      terminal.write = originalWrite
      return this.stopRecording()!
    }

    return { terminal, recordingId, stop }
  }
}

// Export singleton instance
export const terminalRecording = new TerminalRecordingService()
