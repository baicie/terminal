import { invoke } from '@tauri-apps/api/core'

export interface VaultEntry {
  key: string
  value: string
  description?: string
}

export class VaultService {
  /**
   * Check if vault exists
   */
  async exists(): Promise<boolean> {
    return await invoke<boolean>('vault_exists')
  }

  /**
   * Create a new vault with master password
   */
  async create(masterPassword: string): Promise<void> {
    await invoke('vault_create', { masterPassword })
  }

  /**
   * Unlock vault with master password
   */
  async unlock(masterPassword: string): Promise<void> {
    await invoke('vault_unlock', { masterPassword })
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
