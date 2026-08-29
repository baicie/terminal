import type { VaultEntry } from '@/service/vault'
import { useCallback, useEffect, useState } from 'react'
import { toast } from '@/components/ui/sonner'
import { vaultService } from '@/service/vault'
import { useHostStore } from '@/store/host'

export function useVaultsContainer() {
  const hosts = useHostStore(state => state.hosts)
  const [searchQuery, setSearchQuery] = useState('')
  const [vaultExists, setVaultExists] = useState<boolean | null>(null)
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [selectedEntry, setSelectedEntry] = useState<VaultEntry | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false)
  const [addEntryDialogOpen, setAddEntryDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [entryToDelete, setEntryToDelete] = useState<VaultEntry | null>(null)
  const [changePasswordDialogOpen, setChangePasswordDialogOpen] =
    useState(false)
  const [masterPassword, setMasterPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [entryKey, setEntryKey] = useState('')
  const [entryValue, setEntryValue] = useState('')
  const [entryDescription, setEntryDescription] = useState('')

  const loadEntries = useCallback(async () => {
    try {
      const keys = await vaultService.list()
      const loadedEntries: VaultEntry[] = []
      for (const key of keys) {
        try {
          const value = await vaultService.get(key)
          loadedEntries.push({ key, value, description: undefined })
        } catch {
          // The entry may have been deleted while the list was loading.
        }
      }
      setEntries(loadedEntries)
    } catch (error) {
      console.error('Failed to load vault entries:', error)
    }
  }, [])

  const checkVaultStatus = useCallback(async () => {
    setLoading(true)
    try {
      const exists = await vaultService.exists()
      setVaultExists(exists)
      if (exists) {
        const unlocked = await vaultService.isUnlocked()
        setIsUnlocked(unlocked)
        if (unlocked) await loadEntries()
      }
    } catch (error) {
      console.error('Failed to check vault status:', error)
    } finally {
      setLoading(false)
    }
  }, [loadEntries])

  useEffect(() => {
    void checkVaultStatus()
  }, [checkVaultStatus])

  const handleCreateVault = async () => {
    if (!masterPassword || masterPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    if (masterPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    try {
      await vaultService.create(masterPassword)
      toast.success('Vault created successfully')
      setVaultExists(true)
      setIsUnlocked(true)
      setCreateDialogOpen(false)
      setMasterPassword('')
      setConfirmPassword('')
      await loadEntries()
    } catch (error) {
      toast.error('Failed to create vault: ' + String(error))
    }
  }

  const handleUnlock = async () => {
    if (!masterPassword) {
      toast.error('Please enter the password')
      return
    }
    try {
      await vaultService.unlock(masterPassword)
      toast.success('Vault unlocked')
      setIsUnlocked(true)
      setUnlockDialogOpen(false)
      setMasterPassword('')
      await loadEntries()
    } catch (error) {
      toast.error('Failed to unlock vault: ' + String(error))
    }
  }

  const handleLock = async () => {
    try {
      await vaultService.lock()
      toast.success('Vault locked')
      setIsUnlocked(false)
      setEntries([])
      setSelectedEntry(null)
    } catch (error) {
      toast.error('Failed to lock vault: ' + String(error))
    }
  }

  const handleAddEntry = async () => {
    if (!entryKey.trim() || !entryValue.trim()) {
      toast.error('Key and value are required')
      return
    }
    try {
      await vaultService.set(entryKey, entryValue)
      toast.success('Entry added successfully')
      setAddEntryDialogOpen(false)
      setEntryKey('')
      setEntryValue('')
      setEntryDescription('')
      await loadEntries()
    } catch (error) {
      toast.error('Failed to add entry: ' + String(error))
    }
  }

  const handleDeleteEntry = async () => {
    if (!entryToDelete) return
    try {
      await vaultService.delete(entryToDelete.key)
      toast.success('Entry deleted')
      setEntries(current =>
        current.filter(entry => entry.key !== entryToDelete.key),
      )
      if (selectedEntry?.key === entryToDelete.key) setSelectedEntry(null)
      setDeleteDialogOpen(false)
      setEntryToDelete(null)
    } catch (error) {
      toast.error('Failed to delete entry: ' + String(error))
    }
  }

  const handleChangePassword = async () => {
    if (!masterPassword || !newPassword || newPassword !== confirmNewPassword) {
      toast.error('Passwords do not match or are empty')
      return
    }
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters')
      return
    }
    try {
      await vaultService.changePassword(masterPassword, newPassword)
      toast.success('Password changed successfully')
      setChangePasswordDialogOpen(false)
      setMasterPassword('')
      setNewPassword('')
      setConfirmNewPassword('')
    } catch (error) {
      toast.error('Failed to change password: ' + String(error))
    }
  }

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Copied to clipboard')
    } catch {
      toast.error('Failed to copy')
    }
  }

  const handleAutofillHost = async (hostId: string) => {
    if (!hosts.some(host => host.id === hostId)) return
    try {
      const credentials = await vaultService.getHostCredential(hostId)
      if (credentials.password) {
        setEntryKey('host:' + hostId + ':password')
        setEntryValue(credentials.password)
      }
      if (credentials.privateKey) {
        setEntryKey('host:' + hostId + ':privateKey')
        setEntryValue(credentials.privateKey)
      }
      setAddEntryDialogOpen(true)
    } catch {
      toast.error('No credentials found for this host')
    }
  }

  const filteredEntries = entries.filter(entry =>
    entry.key.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return {
    searchQuery,
    vaultExists,
    isUnlocked,
    loading,
    filteredEntries,
    selectedEntry,
    showPassword,
    createDialogOpen,
    unlockDialogOpen,
    addEntryDialogOpen,
    deleteDialogOpen,
    entryToDelete,
    changePasswordDialogOpen,
    masterPassword,
    confirmPassword,
    newPassword,
    confirmNewPassword,
    entryKey,
    entryValue,
    entryDescription,
    setSearchQuery,
    setSelectedEntry,
    setShowPassword,
    setCreateDialogOpen,
    setUnlockDialogOpen,
    setAddEntryDialogOpen,
    setDeleteDialogOpen,
    setEntryToDelete,
    setChangePasswordDialogOpen,
    setMasterPassword,
    setConfirmPassword,
    setNewPassword,
    setConfirmNewPassword,
    setEntryKey,
    setEntryValue,
    setEntryDescription,
    handleCreateVault,
    handleUnlock,
    handleLock,
    handleAddEntry,
    handleDeleteEntry,
    handleChangePassword,
    handleCopy,
    handleAutofillHost,
  }
}

export type VaultsContainerController = ReturnType<typeof useVaultsContainer>
