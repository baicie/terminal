import { invoke } from '@tauri-apps/api/core'
import { beforeEach, expect, it, vi } from 'vitest'
import { terminalSessionTransport } from './terminal-session-transport'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
}))

beforeEach(() => {
  vi.mocked(invoke).mockClear()
})

it('writes terminal text through the session IPC command', async () => {
  await terminalSessionTransport.write('session-1', 'echo ok\r')

  expect(invoke).toHaveBeenCalledWith('session_write', {
    sessionId: 'session-1',
    data: 'echo ok\r',
  })
})

it('writes terminal binary data without converting the bytes', async () => {
  const data = Uint8Array.from([0, 0x80, 0xff])

  await terminalSessionTransport.writeRaw('session-1', data)

  expect(invoke).toHaveBeenCalledWith('session_write_raw', {
    sessionId: 'session-1',
    data,
  })
})

it('resizes the terminal through the session IPC command', async () => {
  await terminalSessionTransport.resize('session-1', 97, 31)

  expect(invoke).toHaveBeenCalledWith('session_resize', {
    sessionId: 'session-1',
    cols: 97,
    rows: 31,
  })
})

it('acknowledges rendered output bytes through the session IPC command', async () => {
  await terminalSessionTransport.ackOutput('session-1', 32_768)

  expect(invoke).toHaveBeenCalledWith('session_ack_output', {
    sessionId: 'session-1',
    bytes: 32_768,
  })
})

it('closes the terminal through the session IPC command', async () => {
  await terminalSessionTransport.close('session-1')

  expect(invoke).toHaveBeenCalledWith('session_close', {
    sessionId: 'session-1',
  })
})
