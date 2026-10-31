import { invoke } from '@tauri-apps/api/core'

export interface VaultEntry {
  key: string
  value: string
  description?: string
}

/**
 * Error kinds the backend vault commands report.
 *
 * `invalid_password` is decided at unlock time (the vault carries a verifier),
 * and `already_exists` comes from the exclusive create: creating never
 * overwrites, so a second create has to be surfaced, not retried.
 */
export type VaultErrorKind =
  | 'invalid_password'
  | 'already_exists'
  | 'vault_locked'
  | 'unknown'

const KNOWN_VAULT_ERROR_KINDS = new Set<string>([
  'invalid_password',
  'already_exists',
  'vault_locked',
])

/** A vault command rejection with the backend error kind preserved. */
export class VaultCommandError extends Error {
  readonly kind: VaultErrorKind

  constructor(kind: VaultErrorKind, message: string) {
    super(message)
    this.name = 'VaultCommandError'
    this.kind = kind
  }
}

/**
 * Keep the backend `{ type, message }` shape instead of flattening it.
 *
 * Tauri rejects with the serialized `VaultError`, so the kind survives the IPC
 * hop and callers can distinguish "wrong password" from "a vault already
 * exists" instead of matching on message text.
 */
export function toVaultCommandError(error: unknown): VaultCommandError {
  if (error instanceof VaultCommandError) return error

  const payload =
    typeof error === 'object' && error !== null
      ? (error as { type?: unknown; message?: unknown })
      : undefined
  const type = typeof payload?.type === 'string' ? payload.type : ''
  const kind: VaultErrorKind = KNOWN_VAULT_ERROR_KINDS.has(type)
    ? (type as VaultErrorKind)
    : 'unknown'
  const detail =
    typeof payload?.message === 'string' && payload.message.length > 0
      ? payload.message
      : type.length > 0
        ? type
        : String(error)

  return new VaultCommandError(kind, detail)
}

export class VaultService {
  /**
   * Check if vault exists
   */
  async exists(): Promise<boolean> {
    return await invoke<boolean>('vault_exists')
  }

  /**
   * Create a new vault with master password.
   *
   * Never overwrites: an existing vault makes this reject with
   * `already_exists`. Replacing one is a separate, explicit destructive
   * operation that this service deliberately does not expose.
   */
  async create(masterPassword: string): Promise<void> {
    try {
      await invoke('vault_create', { masterPassword })
    } catch (error) {
      throw toVaultCommandError(error)
    }
  }

  /**
   * Unlock vault with master password.
   *
   * The password is checked by the backend before the vault is unlocked, so a
   * wrong password rejects here with `invalid_password` and never later.
   */
  async unlock(masterPassword: string): Promise<void> {
    try {
      await invoke('vault_unlock', { masterPassword })
    } catch (error) {
      throw toVaultCommandError(error)
    }
  }

  /**
   * Lock the vault
   */
  async lock(): Promise<void> {
    await invoke('vault_lock')
  }

  /**
   * Check if vault is unlocked
   */
  async isUnlocked(): Promise<boolean> {
    return await invoke<boolean>('vault_is_unlocked')
  }

  /**
   * Store a value in vault
   */
  async set(key: string, value: string): Promise<void> {
    await invoke('vault_set', { key, value })
  }

  /**
   * Get a value from vault
   */
  async get(key: string): Promise<string> {
    return await invoke<string>('vault_get', { key })
  }

  /**
   * List all keys in vault
   */
  async list(): Promise<string[]> {
    return await invoke<string[]>('vault_list')
  }

  /**
   * Delete a key from vault
   */
  async delete(key: string): Promise<void> {
    await invoke('vault_delete', { key })
  }

  /**
   * Change vault master password
   */
  async changePassword(
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    await invoke('vault_change_password', { oldPassword, newPassword })
  }

  /**
   * Store sensitive host credentials in vault
   */
  async storeHostCredential(
    hostId: string,
    password?: string,
    privateKey?: string,
  ): Promise<void> {
    if (password) {
      await this.set(`host:${hostId}:password`, password)
    }
    if (privateKey) {
      await this.set(`host:${hostId}:privateKey`, privateKey)
    }
  }

  /**
   * Retrieve host credentials from vault
   */
  async getHostCredential(hostId: string): Promise<{
    password?: string
    privateKey?: string
  }> {
    const result: { password?: string; privateKey?: string } = {}

    try {
      result.password = await this.get(`host:${hostId}:password`)
    } catch {
      // Key not found, ignore
    }

    try {
      result.privateKey = await this.get(`host:${hostId}:privateKey`)
    } catch {
      // Key not found, ignore
    }

    return result
  }

  /**
   * Delete host credentials from vault
   */
  async deleteHostCredential(hostId: string): Promise<void> {
    try {
      await this.delete(`host:${hostId}:password`)
    } catch {
      // Ignore if not found
    }
    try {
      await this.delete(`host:${hostId}:privateKey`)
    } catch {
      // Ignore if not found
    }
  }
}

export const vaultService = new VaultService()
