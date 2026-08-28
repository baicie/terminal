import { invoke } from '@tauri-apps/api/core'

export const terminalSessionTransport = {
  async write(sessionId: string, data: string): Promise<void> {
    await invoke('session_write', { sessionId, data })
  },

  async writeRaw(sessionId: string, data: Uint8Array): Promise<void> {
    await invoke('session_write_raw', { sessionId, data })
  },

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await invoke('session_resize', { sessionId, cols, rows })
  },

  async ackOutput(sessionId: string, bytes: number): Promise<void> {
    await invoke('session_ack_output', { sessionId, bytes })
  },

  async close(sessionId: string): Promise<void> {
    await invoke('session_close', { sessionId })
  },
}
