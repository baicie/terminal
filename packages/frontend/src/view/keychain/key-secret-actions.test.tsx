// UX-2a · forgetting a stored key, readable or not.
//
// The keychain could create a key, read its private half, and delete the whole
// key — but had no way to stop storing just the secret. `updateSSHKey` writes
// `credential_ref = COALESCE(?, credential_ref)`, so no edit path drops the
// pointer. A user handing a key to a colleague, or recovering from a pointer this
// build cannot read, had to delete the entry and retype its name, type and
// public half.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SSHKeyRecord } from '@/service/database'
import i18n from '@/locales'
import { KeySecretActions } from './key-secret-actions'

const mocks = vi.hoisted(() => ({
  clearSSHKeyCredential: vi.fn(),
  getSSHKeySecret: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/service/database', () => ({
  clearSSHKeyCredential: mocks.clearSSHKeyCredential,
  getSSHKeySecret: mocks.getSSHKeySecret,
}))

vi.mock('@/components/ui/sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}))

const READABLE = {
  id: 'key-1',
  name: 'deploy',
  key_type: 'ssh-ed25519',
  private_key: null,
  public_key: 'ssh-ed25519 AAAA',
  certificate: null,
  passphrase: null,
  credential_ref: JSON.stringify({ kinds: ['privateKey'], provider: 'vault', version: 2 }),
  is_encrypted: 1,
  created_at: 0,
  updated_at: 0,
} as unknown as SSHKeyRecord

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  mocks.clearSSHKeyCredential.mockResolvedValue(undefined)
})

describe('forgetting a stored key', () => {
  it('offers the action for a readable reference', () => {
    render(<KeySecretActions selectedKey={READABLE} />)
    expect(screen.getByTestId('key-clear-credential')).toBeTruthy()
  })

  it('offers it for a damaged reference and says why', () => {
    // The recovery path. A reference naming a provider this build does not have
    // is non-null, so the actions render — but the user needs to know the key
    // cannot be used and that clearing is the way out, not that a button appeared
    // for no reason.
    render(
      <KeySecretActions
        selectedKey={
          {
            ...READABLE,
            credential_ref: JSON.stringify({
              kinds: ['privateKey'],
              provider: 'system-keychain',
            }),
          } as unknown as SSHKeyRecord
        }
      />,
    )
    expect(screen.getByTestId('key-clear-credential')).toBeTruthy()
    expect(screen.getByTestId('key-credential-damaged')).toBeTruthy()
  })

  it('offers nothing for a public-only key', () => {
    render(
      <KeySecretActions
        selectedKey={{ ...READABLE, credential_ref: null } as unknown as SSHKeyRecord}
      />,
    )
    expect(screen.queryByTestId('key-clear-credential')).toBeNull()
  })

  it('asks first and then calls the service once', async () => {
    const onCleared = vi.fn().mockResolvedValue(undefined)
    render(<KeySecretActions selectedKey={READABLE} onCleared={onCleared} />)

    fireEvent.click(screen.getByTestId('key-clear-credential'))
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /clear|forget|effacer|清除/i }))

    await waitFor(() => expect(mocks.clearSSHKeyCredential).toHaveBeenCalledWith('key-1'))
    await waitFor(() => expect(onCleared).toHaveBeenCalled())
    expect(mocks.toastSuccess).toHaveBeenCalled()
  })

  it('reports a failure and does not claim success', async () => {
    mocks.clearSSHKeyCredential.mockRejectedValue(new Error('database is locked'))
    render(<KeySecretActions selectedKey={READABLE} />)

    fireEvent.click(screen.getByTestId('key-clear-credential'))
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /clear|forget|effacer|清除/i }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled())
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })
})
