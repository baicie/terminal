import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { VaultService, toVaultCommandError } from './vault'

beforeEach(() => {
  invoke.mockReset()
})

/**
 * Phase 9.0 P9.0-7.2: the file-level counterpart of the duplicate-column guard.
 *
 * The backend names eleven vault error kinds (`src-tauri/src/errors.rs`
 * `VaultErrorDto`); the front end kept a narrower list and classified everything
 * outside it as `unknown`. A vault whose key is simply absent and a vault whose
 * file cannot be decrypted therefore arrived as the same value, so no caller could
 * narrow its catch to the benign case — and the two credential helpers swallowed
 * all of them while their comments claimed "key not found".
 */
describe('vault error classification', () => {
  it('keeps the backend kind for a key the vault does not hold', () => {
    const error = toVaultCommandError({
      type: 'key_not_found',
      message: 'host:h-1:password',
    })

    expect(error.kind).toBe('key_not_found')
    expect(error.message).toContain('host:h-1:password')
  })

  it('still keeps the kinds that describe a broken vault', () => {
    expect(toVaultCommandError({ type: 'corrupt', message: 'damaged' }).kind).toBe(
      'corrupt',
    )
    expect(toVaultCommandError({ type: 'vault_locked' }).kind).toBe('vault_locked')
    expect(toVaultCommandError({ type: 'decrypt_failed', message: 'x' }).kind).toBe(
      'unknown',
    )
  })
})

describe('vault host credentials', () => {
  it('reads both halves of a stored credential', async () => {
    invoke.mockResolvedValueOnce('secret').mockResolvedValueOnce('-----BEGIN')
    await expect(new VaultService().getHostCredential('h-1')).resolves.toEqual({
      password: 'secret',
      privateKey: '-----BEGIN',
    })
  })

  it('treats a key the vault does not hold as an absent half', async () => {
    invoke
      .mockRejectedValueOnce({ type: 'key_not_found', message: 'host:h-1:password' })
      .mockResolvedValueOnce('-----BEGIN')

    await expect(new VaultService().getHostCredential('h-1')).resolves.toEqual({
      privateKey: '-----BEGIN',
    })
  })

  it('does not report a locked vault as "no stored credential"', async () => {
    invoke.mockRejectedValue({ type: 'vault_locked' })

    await expect(new VaultService().getHostCredential('h-1')).rejects.toThrow(
      /vault_locked/,
    )
  })

  it('does not report a failed delete as deleted', async () => {
    invoke.mockRejectedValue({ type: 'corrupt', message: 'vault file is damaged' })

    await expect(
      new VaultService().deleteHostCredential('h-1'),
    ).rejects.toThrow(/damaged/)
  })
})
