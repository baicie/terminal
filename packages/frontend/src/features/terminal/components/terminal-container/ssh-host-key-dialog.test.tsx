import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import '@/locales'
import { SshHostKeyDialog } from './ssh-host-key-dialog'

const prompt = {
  status: 'unknown' as const,
  host: 'server.example.com',
  port: 22,
  algorithm: 'ssh-ed25519',
  fingerprint: 'SHA256:abc123',
  publicKey: 'ssh-ed25519 AAAAtest',
}

describe('SshHostKeyDialog', () => {
  it('offers trust-once and persisted trust for an unknown key', () => {
    const onTrustOnce = vi.fn()
    const onTrustAndSave = vi.fn()
    const onCancel = vi.fn()
    render(
      <SshHostKeyDialog
        prompt={prompt}
        saving={false}
        error={null}
        onTrustOnce={onTrustOnce}
        onTrustAndSave={onTrustAndSave}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByText('server.example.com:22')).toBeTruthy()
    expect(screen.getByText('ssh-ed25519')).toBeTruthy()
    expect(screen.getByText('SHA256:abc123')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Trust once' }))
    fireEvent.click(screen.getByRole('button', { name: 'Trust and save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onTrustOnce).toHaveBeenCalledOnce()
    expect(onTrustAndSave).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('strongly blocks a changed key without a bypass action', () => {
    render(
      <SshHostKeyDialog
        prompt={{ ...prompt, status: 'changed' }}
        saving={false}
        error={null}
        onTrustOnce={vi.fn()}
        onTrustAndSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert').dataset.slot).toBe('alert')
    expect(screen.queryByRole('button', { name: 'Trust once' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Trust and save' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('identifies a target key reached through a verified jump host', () => {
    render(
      <SshHostKeyDialog
        prompt={prompt}
        role="target"
        saving={false}
        error={null}
        onTrustOnce={vi.fn()}
        onTrustAndSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(
      screen.getByText(/target reached through the verified jump host/i),
    ).toBeTruthy()
  })

  it('reports persistence errors and prevents duplicate trust actions', () => {
    render(
      <SshHostKeyDialog
        prompt={prompt}
        saving
        error="known_hosts is read-only"
        onTrustOnce={vi.fn()}
        onTrustAndSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert').textContent).toContain(
      'known_hosts is read-only',
    )
    expect(
      (
        screen.getByRole('button', {
          name: 'Trust once',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(
      (
        screen.getByRole('button', {
          name: 'Trust and save',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
})
