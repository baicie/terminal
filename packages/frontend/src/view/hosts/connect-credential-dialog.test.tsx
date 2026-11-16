// Asking for a credential at connect time, without storing it.
//
// The design rule: `Authenticate` is not `Save`, and a user must be able to
// connect with a typed password without creating a vault first. Before this
// dialog the only connectable hosts were ones with a stored secret.

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'
import i18n from '@/locales'
import { ConnectCredentialDialog } from './connect-credential-dialog'

const base = {
  id: 'h-1',
  name: 'prod',
  hostname: 'prod.test',
  port: 22,
  username: 'deploy',
  authType: 'password',
  credentialRef: null,
  credentialRefProblem: null,
} as unknown as Host

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('connect-time credential dialog', () => {
  it('asks for a password and passes only the typed value', () => {
    const onConnect = vi.fn()
    render(
      <ConnectCredentialDialog host={base} onOpenChange={vi.fn()} onConnect={onConnect} />,
    )

    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'hunter2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    expect(onConnect).toHaveBeenCalledWith({ password: 'hunter2' })
  })

  it('says plainly that nothing is stored', () => {
    // The distinction the whole feature rests on. A form that silently looked like
    // a save would be the "提交表单暗示已保存" behaviour the spec rules out.
    render(
      <ConnectCredentialDialog host={base} onOpenChange={vi.fn()} onConnect={vi.fn()} />,
    )
    expect(
      screen.getByText('This credential is used for this connection only.'),
    ).toBeTruthy()
  })

  it('refuses to submit an empty password', () => {
    const onConnect = vi.fn()
    render(
      <ConnectCredentialDialog host={base} onOpenChange={vi.fn()} onConnect={onConnect} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onConnect).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('takes a private key and an optional passphrase for key auth', () => {
    const onConnect = vi.fn()
    render(
      <ConnectCredentialDialog
        host={{ ...base, authType: 'key' } as unknown as Host}
        onOpenChange={vi.fn()}
        onConnect={onConnect}
      />,
    )

    fireEvent.change(screen.getByLabelText('Private key'), {
      target: { value: '-----BEGIN KEY-----' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    expect(onConnect).toHaveBeenCalledWith({ privateKey: '-----BEGIN KEY-----' })
  })

  it('includes the passphrase when one was typed', () => {
    const onConnect = vi.fn()
    render(
      <ConnectCredentialDialog
        host={{ ...base, authType: 'key' } as unknown as Host}
        onOpenChange={vi.fn()}
        onConnect={onConnect}
      />,
    )

    fireEvent.change(screen.getByLabelText('Private key'), {
      target: { value: 'KEY' },
    })
    fireEvent.change(screen.getByLabelText('Passphrase (optional)'), {
      target: { value: 'phrase' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    expect(onConnect).toHaveBeenCalledWith({ privateKey: 'KEY', passphrase: 'phrase' })
  })

  it('refuses to submit without a key', () => {
    const onConnect = vi.fn()
    render(
      <ConnectCredentialDialog
        host={{ ...base, authType: 'key' } as unknown as Host}
        onOpenChange={vi.fn()}
        onConnect={onConnect}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('offers no field when the auth type resolves nothing of its own', () => {
    // Agent auth never reaches this dialog from the caller, but if it ever did,
    // there is nothing to type and submitting must not fabricate a secret.
    const onConnect = vi.fn()
    render(
      <ConnectCredentialDialog
        host={{ ...base, authType: 'agent' } as unknown as Host}
        onOpenChange={vi.fn()}
        onConnect={onConnect}
      />,
    )
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.queryByLabelText('Private key')).toBeNull()
  })

  it('renders nothing without a host', () => {
    const { container } = render(
      <ConnectCredentialDialog host={null} onOpenChange={vi.fn()} onConnect={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('names the host it is connecting to', () => {
    render(
      <ConnectCredentialDialog host={base} onOpenChange={vi.fn()} onConnect={vi.fn()} />,
    )
    expect(screen.getByText(/prod\.test/)).toBeTruthy()
  })
})
