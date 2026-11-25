import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import '@/locales'
import { SshHostKeyDialog } from './ssh-host-key-dialog'
import { SshHostKeyGateOverlay } from './ssh-host-key-gate-overlay'

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

/**
 * F22 — the gate overlay has to name the step that failed.
 *
 * Measured on a macOS GUI run against a host pointed at a closed port: the pane said
 * "Could not verify the SSH host key" over a message that began
 * `connection failed: connect host-key probe failed:`. Nothing about that is a host-key
 * problem — the machine never opened a socket — and the sentence sends the user to
 * `known_hosts`, which is the one file certainly not at fault.
 *
 * The overlay is the *first* surface a failed connection reaches, because the preflight
 * runs before the session does. That is why the case asserts here rather than only on
 * the terminal error overlay.
 */
describe('SshHostKeyGateOverlay', () => {
  it('names an unreachable server instead of blaming the host key', () => {
    render(
      <SshHostKeyGateOverlay
        status="error"
        error="Connection refused (os error 61)"
        failure="unreachable"
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByTestId('ssh-host-key-gate-title').textContent).toBe(
      'The server did not answer',
    )
    // The precise wording that was wrong: it must not appear for a refused connect.
    expect(screen.queryByText('Could not verify the SSH host key')).toBeNull()
    // The cause stays visible verbatim; the headline explains, it does not replace.
    expect(screen.getByText('Connection refused (os error 61)')).toBeTruthy()
    expect(
      screen.getByTestId('ssh-host-key-gate-error').dataset.failure,
    ).toBe('unreachable')
  })

  it('keeps the host-key sentence when no step could be named', () => {
    /*
     * Two states never ran a probe: no host row, and an unresolvable jump host. They
     * carry no `failure`, and inventing one would relabel a configuration error as a
     * network one.
     */
    render(
      <SshHostKeyGateOverlay
        status="error"
        error="Host info required for remote connection"
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByTestId('ssh-host-key-gate-title').textContent).toBe(
      'Could not verify the SSH host key',
    )
    expect(
      screen.getByTestId('ssh-host-key-gate-error').dataset.failure,
    ).toBe('unspecified')
  })

  it('shows the checking state without a failure headline', () => {
    render(
      <SshHostKeyGateOverlay
        status="checking"
        error={null}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('ssh-host-key-gate-error')).toBeNull()
    expect(screen.getByRole('status')).toBeTruthy()
  })
})
