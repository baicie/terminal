import i18n from '@/locales'
import type { VaultEntry } from '@/service/vault'
import { useCallback, useEffect, useState } from 'react'
import { toast } from '@/components/ui/sonner'
import { toVaultCommandError, vaultService } from '@/service/vault'

/**
 * `uninitialized` and `corrupt` are file states, not session states: the first
 * is the zero-length placeholder of an interrupted create (creating again
 * reclaims it), the second is content the format cannot parse (kept byte for
 * byte). Both are reachable only from a command rejection, because
 * `vault_exists` already reports a placeholder as "no vault".
 */
export type VaultState =
  | 'loading'
  | 'unlocked'
  | 'locked'
  | 'not_created'
  | 'uninitialized'
  | 'corrupt'

/**
 * State holds translation keys, never translated text, so switching language
 * re-renders the message without re-running any vault command.
 */
export function useVaultsView() {
  const [vaultState, setVaultState] = useState<VaultState>('loading')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [noticeKey, setNoticeKey] = useState<string | null>(null)
  const [bannerKey, setBannerKey] = useState<string | null>(null)
  const [newEntryKey, setNewEntryKey] = useState('')
  const [newEntryValue, setNewEntryValue] = useState('')
  const [selectedEntry, setSelectedEntry] = useState<VaultEntry | null>(null)
  const [showEntryValue, setShowEntryValue] = useState(false)
  const [creating, setCreating] = useState(false)

  const loadEntries = useCallback(async () => {
    try {
      const keys = await vaultService.list()
      const loaded: VaultEntry[] = []
      for (const key of keys) {
        try {
          const value = await vaultService.get(key)
          loaded.push({ key, value, description: undefined })
        } catch {
          // One unreadable entry must not hide the rest of the vault.
        }
      }
      setEntries(loaded)
    } catch (loadError) {
      console.error('Failed to load vault entries:', toVaultCommandError(loadError).kind)
      setBannerKey('vaults.loadFailed')
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
      console.error('Failed to check vault status:', toVaultCommandError(statusError).kind)
      setBannerKey('vaults.loadFailed')
      // A guessed "create" screen is safe: creating never overwrites, so a wrong
      // guess surfaces as already_exists instead of destroying anything.
      setVaultState('not_created')
    }
  }, [loadEntries])

  useEffect(() => {
    void checkVaultStatus()
  }, [checkVaultStatus])

  /** Route a file-state rejection to its own screen; returns true when handled. */
  const applyFileStateError = useCallback((kind: string): boolean => {
    if (kind === 'uninitialized') {
      setNoticeKey('vaults.uninitialized')
      setErrorKey(null)
      setVaultState('uninitialized')
      return true
    }
    if (kind === 'corrupt') {
      setErrorKey(null)
      setNoticeKey(null)
      setVaultState('corrupt')
      return true
    }
    return false
  }, [])

  const handleCreate = async () => {
    if (!password) return setErrorKey('vaults.passwordRequired')
    if (password.length < 8) return setErrorKey('vaults.passwordMinLength')
    if (password !== confirmPassword) return setErrorKey('vaults.passwordsDoNotMatch')

    setErrorKey(null)
    setCreating(true)
    try {
      await vaultService.create(password)
      setVaultState('unlocked')
      setNoticeKey(null)
      setPassword('')
      setConfirmPassword('')
      toast.success(i18n.t('vaults.vaultCreated'))
      void loadEntries()
    } catch (createError) {
      const vaultError = toVaultCommandError(createError)
      console.error('Failed to create vault:', vaultError.kind)
      if (applyFileStateError(vaultError.kind)) return
      if (vaultError.kind === 'already_exists') {
        // Creating never overwrites: show the vault that exists instead of a
        // create form that cannot succeed.
        setErrorKey('vaults.vaultAlreadyExists')
        setVaultState('locked')
      } else {
        setErrorKey('vaults.vaultCreateFailed')
        setVaultState('not_created')
      }
    } finally {
      setCreating(false)
    }
  }

  const handleUnlock = async () => {
    if (!password) return setErrorKey('vaults.passwordRequired')
    setErrorKey(null)
    try {
      await vaultService.unlock(password)
      setVaultState('unlocked')
      setPassword('')
      void loadEntries()
      toast.success(i18n.t('vaults.vaultUnlocked'))
    } catch (unlockError) {
      const vaultError = toVaultCommandError(unlockError)
      console.error('Failed to unlock vault:', vaultError.kind)
      if (applyFileStateError(vaultError.kind)) return
      setErrorKey(
        vaultError.kind === 'invalid_password'
          ? 'vaults.invalidPassword'
          : 'vaults.vaultUnlockFailed',
      )
    }
  }

  const handleLock = async () => {
    try {
      await vaultService.lock()
      setVaultState('locked')
      setEntries([])
      setSelectedEntry(null)
      toast.info(i18n.t('vaults.vaultLocked'))
    } catch (lockError) {
      console.error('Failed to lock vault:', toVaultCommandError(lockError).kind)
      setBannerKey('vaults.lockFailed')
    }
  }

  const handleAddEntry = async () => {
    if (!newEntryKey || !newEntryValue) {
      setBannerKey('vaults.keyValueRequired')
      return
    }
    try {
      await vaultService.set(newEntryKey, newEntryValue)
      setNewEntryKey('')
      setNewEntryValue('')
      void loadEntries()
      toast.success(i18n.t('vaults.entryAdded'))
    } catch (addError) {
      console.error('Failed to add entry:', toVaultCommandError(addError).kind)
      setBannerKey('vaults.saveFailed')
    }
  }

  const handleDeleteEntry = async (key: string) => {
    try {
      await vaultService.delete(key)
      void loadEntries()
      if (selectedEntry?.key === key) setSelectedEntry(null)
      toast.success(i18n.t('vaults.entryDeleted'))
    } catch (deleteError) {
      console.error('Failed to delete entry:', toVaultCommandError(deleteError).kind)
      setBannerKey('vaults.deleteFailed')
    }
  }

  const handleCopyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(i18n.t('vaults.copiedToClipboard'))
    } catch {
      setBannerKey('vaults.failedCopy')
    }
  }

  const dismissBanner = useCallback(() => setBannerKey(null), [])

  /**
   * Escape closes the transient layer only: the alert first, then the entry
   * detail pane. Returns whether anything was closed so an unrelated Escape
   * keeps travelling to the rest of the app.
   */
  const handleEscape = useCallback((): boolean => {
    if (bannerKey) {
      setBannerKey(null)
      return true
    }
    if (selectedEntry) {
      setSelectedEntry(null)
      return true
    }
    return false
  }, [bannerKey, selectedEntry])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (handleEscape()) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleEscape])

  return {
    vaultState,
    password,
    confirmPassword,
    showPassword,
    entries,
    errorKey,
    noticeKey,
    bannerKey,
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
    dismissBanner,
  }
}
