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
 *
 * `uninitialized` and `corrupt` describe the file itself, decided by
 * `read_vault_file` before any password is checked: a zero-length placeholder
 * left by an interrupted create (recoverable by creating again) and content the
 * format cannot parse (kept byte for byte for manual recovery).
 */
export type VaultErrorKind =
  | 'invalid_password'
  | 'already_exists'
  | 'vault_locked'
  | 'uninitialized'
  | 'corrupt'
  | 'key_not_found'
  | 'unknown'

/**
 * Every kind the backend actually reports, copied from `VaultErrorDto`
 * (`src-tauri/src/errors.rs`).
 *
 * `key_not_found` was missing here, so a vault that simply does not hold a key and a
 * vault whose file cannot be decrypted both arrived as `unknown`. That is what makes
 * a catch unable to name the one benign case it means to swallow — the same
 * misclassification the duplicate-column guard had in Phase 8.9 — and it is why the
 * credential helpers below could only be written as "ignore every failure".
 */
const KNOWN_VAULT_ERROR_KINDS = new Set<string>([
  'invalid_password',
  'already_exists',
  'vault_locked',
  'uninitialized',
  'corrupt',
  'key_not_found',
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
    const password = await this.credentialHalf(`host:${hostId}:password`)
    if (password !== undefined) result.password = password
    const privateKey = await this.credentialHalf(`host:${hostId}:privateKey`)
    if (privateKey !== undefined) result.privateKey = privateKey
    return result
  }

  /**
   * One half of a stored credential, or undefined when the vault holds no such key.
   *
   * Only `key_not_found` is absence. A locked vault, a damaged file and a failed
   * decrypt are all a failure to read a credential the user did store, and answering
   * "there is no credential" for them turns an authentication failure into one with
   * no explanation anywhere.
   */
  private async credentialHalf(key: string): Promise<string | undefined> {
    try {
      return await this.get(key)
    } catch (error) {
      const commandError = toVaultCommandError(error)
      if (commandError.kind === 'key_not_found') return undefined
      throw commandError
    }
  }

  /**
   * Delete host credentials from vault
   */
  async deleteHostCredential(hostId: string): Promise<void> {
    for (const key of [`host:${hostId}:password`, `host:${hostId}:privateKey`]) {
      try {
        await this.delete(key)
      } catch (error) {
        const commandError = toVaultCommandError(error)
        // Deleting a key that is gone already reaches the requested end state. A
        // failed delete of a key that is still there leaves a secret on disk while
        // the caller believes it is gone, which a delete must never report as done.
        if (commandError.kind === 'key_not_found') continue
        throw commandError
      }
    }
  }
}

export const vaultService = new VaultService()
