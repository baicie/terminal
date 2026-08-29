import type { VaultEntry } from '@/service/vault'
import { useCallback, useEffect, useState } from 'react'
import { toast } from '@/components/ui/sonner'
import { vaultService } from '@/service/vault'

export type VaultState = 'loading' | 'unlocked' | 'locked' | 'not_created'

export function useVaultsView() {
  const [vaultState, setVaultState] = useState<VaultState>('loading')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [newEntryKey, setNewEntryKey] = useState('')
  const [newEntryValue, setNewEntryValue] = useState('')
  const [selectedEntry, setSelectedEntry] = useState<VaultEntry | null>(null)
  const [showEntryValue, setShowEntryValue] = useState(false)
  const [creating, setCreating] = useState(false)

  const loadEntries = useCallback(async () => {
    try {
      const keys = await vaultService.list()
      const loadedEntries: VaultEntry[] = []
      for (const key of keys) {
        try {
          const value = await vaultService.get(key)
          loadedEntries.push({ key, value, description: undefined })
        } catch {
          // Skip entries that cannot be read.
        }
      }
      setEntries(loadedEntries)
    } catch (loadError) {
      console.error('Failed to load entries:', loadError)
    }
  }, [])

  const checkVaultStatus = useCallback(async () => {
    setVaultState('loading')
    try {
      const exists = await vaultService.exists()
      if (!exists) {
        setVaultState('not_created')
        return
      }
      const unlocked = await vaultService.isUnlocked()
      setVaultState(unlocked ? 'unlocked' : 'locked')
      if (unlocked) void loadEntries()
    } catch (statusError) {
      console.error('Failed to check vault status:', statusError)
      setVaultState('not_created')
    }
  }, [loadEntries])

  useEffect(() => {
    void checkVaultStatus()
  }, [checkVaultStatus])

  const handleCreate = async () => {
    if (!password) return setError('Password is required')
    if (password.length < 8) {
      return setError('Password must be at least 8 characters')
    }
    if (password !== confirmPassword) return setError('Passwords do not match')

    setError(null)
    setCreating(true)
    try {
      await vaultService.create(password)
      setVaultState('unlocked')
      setPassword('')
      setConfirmPassword('')
      toast.success('Vault created successfully')
    } catch (createError) {
      console.error('Failed to create vault:', createError)
      setError('Failed to create vault: ' + String(createError))
      setVaultState('not_created')
    } finally {
      setCreating(false)
    }
  }

  const handleUnlock = async () => {
    if (!password) return setError('Password is required')
    setError(null)
    try {
      await vaultService.unlock(password)
      setVaultState('unlocked')
      setPassword('')
      void loadEntries()
      toast.success('Vault unlocked successfully')
    } catch (unlockError) {
      console.error('Failed to unlock vault:', unlockError)
      setError('Invalid password')
    }
  }

  const handleLock = async () => {
    try {
      await vaultService.lock()
      setVaultState('locked')
      setEntries([])
      setSelectedEntry(null)
      toast.info('Vault locked')
    } catch (lockError) {
      console.error('Failed to lock vault:', lockError)
    }
  }

  const handleAddEntry = async () => {
    if (!newEntryKey || !newEntryValue) {
      toast.error('Key and value are required')
      return
    }
    try {
      await vaultService.set(newEntryKey, newEntryValue)
      setNewEntryKey('')
      setNewEntryValue('')
      void loadEntries()
      toast.success('Entry added successfully')
    } catch (addError) {
      console.error('Failed to add entry:', addError)
      toast.error('Failed to add entry: ' + String(addError))
    }
  }

  const handleDeleteEntry = async (key: string) => {
    try {
      await vaultService.delete(key)
      void loadEntries()
      if (selectedEntry?.key === key) setSelectedEntry(null)
      toast.success('Entry deleted')
    } catch (deleteError) {
      console.error('Failed to delete entry:', deleteError)
      toast.error('Failed to delete entry: ' + String(deleteError))
    }
  }

  const handleCopyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Copied to clipboard')
    } catch {
      toast.error('Failed to copy')
    }
  }

  return {
    vaultState,
    password,
    confirmPassword,
    showPassword,
    entries,
    error,
    newEntryKey,
    newEntryValue,
    selectedEntry,
    showEntryValue,
    creating,
    setPassword,
    setConfirmPassword,
    setShowPassword,
    setNewEntryKey,
    setNewEntryValue,
    setSelectedEntry,
    setShowEntryValue,
    handleCreate,
    handleUnlock,
    handleLock,
    handleAddEntry,
    handleDeleteEntry,
    handleCopyValue,
  }
}
