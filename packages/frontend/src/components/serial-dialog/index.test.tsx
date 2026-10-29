import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const callOrder: string[] = []
  return {
    callOrder,
    prepare: vi.fn(async () => {
      callOrder.push('prepare')
    }),
    listPorts: vi.fn(async () => [
      { name: '/dev/tty.codex-test', port_type: 'USB' },
    ]),
    connect: vi.fn(async () => {
      callOrder.push('connect')
      return {
        success: true,
        message: 'Connected successfully',
        sessionId: 'serial-test',
      }
    }),
  }
})

vi.mock('@/features/terminal/services/terminal-session-manager', () => ({
  terminalSessionManager: { prepare: mocks.prepare },
}))

vi.mock('@/service/serial', () => ({
  serialService: {
    listPorts: mocks.listPorts,
    connect: mocks.connect,
  },
}))

import SerialDialog from './index'

it('prepares serial event listeners before opening the backend port', async () => {
  const onConnect = vi.fn()
  render(<SerialDialog open onClose={vi.fn()} onConnect={onConnect} />)
  const connectButton = screen.getByRole('button', { name: 'Connect' })
  await waitFor(() =>
    expect((connectButton as HTMLButtonElement).disabled).toBe(false),
  )

  fireEvent.click(connectButton)

  await waitFor(() => expect(onConnect).toHaveBeenCalled())
  expect(mocks.callOrder).toEqual(['prepare', 'connect'])
})
