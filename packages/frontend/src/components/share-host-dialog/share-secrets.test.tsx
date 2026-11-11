// Phase 10.3 WP5 — "share credentials" must not report success while sharing none.
//
// The defect:
//
// `handleShare` reads `host.password` and `host.privateKey` to decide what to
// include. Since Phase 10.1 those fields are *always* undefined for a saved host:
// the secret lives in the vault and the row carries only `credentialRef`. The two
// guards are therefore permanently false, so a user who ticks "include password"
// and confirms gets a success toast and shares nothing at all. The recipient sees
// a host with no credential and no indication that one was ever intended.
//
// It is worse than an unencrypted share: it is a silent empty one. The person who
// needed the credential believes their teammate now has it.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'
import i18n from '@/locales'
import { ShareHostDialog } from './index'

const mocks = vi.hoisted(() => ({
  onShare: vi.fn(),
  vaultGet: vi.fn(),
  vaultAvailable: vi.fn(),
  encrypt: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/components/ui/sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@/service/vault-secret-provider', () => ({
  vaultSecretProvider: {
    availability: mocks.vaultAvailable,
    read: mocks.vaultGet,
  },
}))

vi.mock('@/utils/team-encryption', () => ({
  encryptWithPassword: mocks.encrypt,
  validatePasswordStrength: () => ({ ok: true, score: 4 }),
}))

vi.mock('@/service/team-host-data', () => ({
  createShareableTeamHostData: (host: Host) => ({
    id: host.id,
    name: host.name,
    hostname: host.hostname,
    port: host.port,
    username: host.username,
    auth_type: host.authType,
    group_id: host.groupId ?? null,
    tags: host.tags ?? [],
    port_forwards: host.portForwards ?? [],
    jump_host_id: host.jumpHostId ?? null,
  }),
}))

/** A saved host as the store actually holds it: secrets are in the vault. */
const savedHost = {
  id: 'h-1',
  name: 'prod',
  hostname: 'prod.example.test',
  port: 22,
  username: 'deploy',
  authType: 'password',
  isFavorite: false,
  portForwards: [],
  groupId: null,
  tags: [],
  // The row carries the pointer, never the value.
  credentialRef: { kinds: ['password'], provider: 'vault', version: 3 },
} as unknown as Host

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  mocks.onShare.mockResolvedValue(undefined)
  mocks.vaultAvailable.mockResolvedValue({ ok: true })
  mocks.vaultGet.mockResolvedValue('the-real-password')
  mocks.encrypt.mockResolvedValue({ ciphertext: 'enc', salt: 's', iv: 'i' })
})

describe('sharing a host with credentials', () => {
  it('reads the credential from the vault instead of the empty row field', async () => {
    render(
      <ShareHostDialog
        open
        onOpenChange={vi.fn()}
        host={savedHost}
        onShare={mocks.onShare}
      />,
    )

    // The host row has no `password`; the dialog must not conclude there is none.
    expect((savedHost as unknown as { password?: string }).password).toBeUndefined()

    fireEvent.click(screen.getByRole('switch', { name: /include password|密码/i }))
    fireEvent.click(screen.getByRole('button', { name: /share|分享/i }))

    await waitFor(() => expect(mocks.vaultGet).toHaveBeenCalled())
    // The reference names the kind; the vault holds the value.
    expect(mocks.vaultGet).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'host', id: 'h-1' }),
      3,
      'password',
    )
  })

  it('does not report success when the credential cannot be read', async () => {
    mocks.vaultAvailable.mockResolvedValue({ ok: false, state: 'locked' })

    render(
      <ShareHostDialog
        open
        onOpenChange={vi.fn()}
        host={savedHost}
        onShare={mocks.onShare}
      />,
    )

    fireEvent.click(screen.getByRole('switch', { name: /include password|密码/i }))
    fireEvent.click(screen.getByRole('button', { name: /share|分享/i }))

    await waitFor(() => {
      // Nothing was shared, so nothing may claim it was.
      expect(mocks.toastError).toHaveBeenCalled()
    })
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.onShare).not.toHaveBeenCalled()
  })

  it('refuses an unencrypted share that includes a secret', async () => {
    render(
      <ShareHostDialog
        open
        onOpenChange={vi.fn()}
        host={savedHost}
        onShare={mocks.onShare}
      />,
    )

    fireEvent.click(screen.getByRole('switch', { name: /include password|密码/i }))
    // Leave encryption off — this must not write a plaintext secret.
    fireEvent.click(screen.getByRole('button', { name: /share|分享/i }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled())
    // Phase 10.3 WP5 rule: a secret may only travel encrypted, so this must not
    // have been shared at all.
    expect(mocks.onShare).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })
})

describe('sharing only metadata', () => {
  it('succeeds without touching the vault', async () => {
    render(
      <ShareHostDialog
        open
        onOpenChange={vi.fn()}
        host={savedHost}
        onShare={mocks.onShare}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /share|分享/i }))

    await waitFor(() => expect(mocks.onShare).toHaveBeenCalled())
    expect(mocks.vaultGet).not.toHaveBeenCalled()
  })
})

describe('WP-C — asking to share a secret that does not exist is refused', () => {
  it('a host with no credentialRef cannot be shared "with credentials"', async () => {
    const bare = {
      ...savedHost,
      id: 'h-bare',
      credentialRef: null,
      identityFilePath: undefined,
    } as unknown as Host

    render(
      <ShareHostDialog
        open
        onOpenChange={vi.fn()}
        host={bare}
        onShare={mocks.onShare}
      />,
    )

    fireEvent.click(screen.getByRole('switch', { name: /include password|密码/i }))
    fireEvent.click(screen.getByRole('button', { name: /share|分享/i }))

    // The old behaviour: `shareKindsFor` returned [] and the whole credential
    // block was skipped, so this reached `toast.success` having attached nothing.
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled())
    expect(mocks.onShare).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('a corrupt reference cannot be shared "with credentials"', async () => {
    const corrupt = {
      ...savedHost,
      id: 'h-corrupt',
      credentialRef: null,
      credentialRefProblem: { kind: 'malformed', detail: 'not json' },
    } as unknown as Host

    render(
      <ShareHostDialog
        open
        onOpenChange={vi.fn()}
        host={corrupt}
        onShare={mocks.onShare}
      />,
    )

    fireEvent.click(screen.getByRole('switch', { name: /include password|密码/i }))
    fireEvent.click(screen.getByRole('button', { name: /share|分享/i }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled())
    expect(mocks.onShare).not.toHaveBeenCalled()
  })

  it('sharing only metadata still works on such a host', async () => {
    const bare = {
      ...savedHost,
      id: 'h-bare-2',
      credentialRef: null,
      identityFilePath: undefined,
    } as unknown as Host

    render(
      <ShareHostDialog
        open
        onOpenChange={vi.fn()}
        host={bare}
        onShare={mocks.onShare}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /share|分享/i }))

    await waitFor(() => expect(mocks.onShare).toHaveBeenCalled())
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
