import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import '@/locales'
import { QuickConnectDialog } from './quick-connect-dialog'

const target = {
  hostname: 'server.example.com',
  username: 'deploy',
  port: 2202,
}

describe('QuickConnectDialog', () => {
  it('creates a memory-only password profile from the parsed target', () => {
    const onConnect = vi.fn()
    render(
      <QuickConnectDialog
        open
        target={target}
        onOpenChange={vi.fn()}
        onConnect={onConnect}
      />,
    )

    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: /connect/i }))

    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'deploy@server.example.com',
        hostname: 'server.example.com',
        port: 2202,
        username: 'deploy',
        authType: 'password',
        password: 'secret',
      }),
    )
  })

  it('requires a username before connecting a bare hostname', () => {
    const onConnect = vi.fn()
    render(
      <QuickConnectDialog
        open
        target={{ hostname: 'server.example.com', port: 22 }}
        onOpenChange={vi.fn()}
        onConnect={onConnect}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /connect/i }))

    expect(onConnect).not.toHaveBeenCalled()
    expect(screen.getByText('Username is required.')).toBeTruthy()
  })

  it('clears entered credentials when the target changes', () => {
    const onConnect = vi.fn()
    const { rerender } = render(
      <QuickConnectDialog
        open
        target={target}
        onOpenChange={vi.fn()}
        onConnect={onConnect}
      />,
    )
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'must-not-leak' },
    })

    rerender(
      <QuickConnectDialog
        open
        target={{ hostname: 'other.example.com', username: 'root', port: 22 }}
        onOpenChange={vi.fn()}
        onConnect={onConnect}
      />,
    )

    expect(screen.getByLabelText('Password')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Username')).toHaveProperty('value', 'root')
  })
})
