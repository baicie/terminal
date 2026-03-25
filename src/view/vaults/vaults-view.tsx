import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Shield,
  Lock,
  Unlock,
  KeyRound,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  AlertCircle,
  Copy,
  Server,
  Loader2,
} from 'lucide-react'
import { vaultService, type VaultEntry } from '@/service/vault'
import { toast } from '@/components/ui/sonner'

type VaultState = 'loading' | 'unlocked' | 'locked' | 'not_created'

const VaultsView: React.FC = () => {
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

  useEffect(() => {
    checkVaultStatus()
  }, [])

  const checkVaultStatus = async () => {
    setVaultState('loading')
    try {
      const exists = await vaultService.exists()
      if (!exists) {
        setVaultState('not_created')
      } else {
        const unlocked = await vaultService.isUnlocked()
        setVaultState(unlocked ? 'unlocked' : 'locked')
        if (unlocked) {
          loadEntries()
        }
      }
    } catch (err) {
      console.error('Failed to check vault status:', err)
      setVaultState('not_created')
    }
  }

  const loadEntries = async () => {
    try {
      const keys = await vaultService.list()
      const loadedEntries: VaultEntry[] = []
      for (const key of keys) {
        try {
          const value = await vaultService.get(key)
          loadedEntries.push({ key, value, description: undefined })
        } catch {
          // Skip entries that can't be read
        }
      }
      setEntries(loadedEntries)
    } catch (err) {
      console.error('Failed to load entries:', err)
    }
  }

  const handleCreate = async () => {
    if (!password) {
      setError('Password is required')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setError(null)
    setCreating(true)

    try {
      await vaultService.create(password)
      setVaultState('unlocked')
      setPassword('')
      setConfirmPassword('')
      toast.success('Vault created successfully')
    } catch (err) {
      console.error('Failed to create vault:', err)
      setError(`Failed to create vault: ${err}`)
      setVaultState('not_created')
    } finally {
      setCreating(false)
    }
  }

  const handleUnlock = async () => {
    if (!password) {
      setError('Password is required')
      return
    }

    setError(null)

    try {
      await vaultService.unlock(password)
      setVaultState('unlocked')
      setPassword('')
      loadEntries()
      toast.success('Vault unlocked successfully')
    } catch (err) {
      console.error('Failed to unlock vault:', err)
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
    } catch (err) {
      console.error('Failed to lock vault:', err)
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
      loadEntries()
      toast.success('Entry added successfully')
    } catch (err) {
      console.error('Failed to add entry:', err)
      toast.error(`Failed to add entry: ${err}`)
    }
  }

  const handleDeleteEntry = async (key: string) => {
    try {
      await vaultService.delete(key)
      loadEntries()
      if (selectedEntry?.key === key) {
        setSelectedEntry(null)
      }
      toast.success('Entry deleted')
    } catch (err) {
      console.error('Failed to delete entry:', err)
      toast.error(`Failed to delete entry: ${err}`)
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

  if (vaultState === 'loading') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Shield className="h-12 w-12 mx-auto text-muted-foreground animate-pulse" />
          <p className="mt-2 text-muted-foreground">Loading vault...</p>
        </div>
      </div>
    )
  }

  if (vaultState === 'not_created') {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center space-y-2">
            <Shield className="h-16 w-16 mx-auto text-primary" />
            <h2 className="text-2xl font-semibold">Create Your Vault</h2>
            <p className="text-muted-foreground">
              Securely store sensitive data like passwords, SSH keys, and API
              tokens using AES-256 encryption.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-password">Master Password</Label>
              <div className="relative">
                <Input
                  id="create-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter a strong password"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            <Button
              className="w-full"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Vault
                </>
              )}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              Warning: If you forget your master password, your data cannot be
              recovered.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (vaultState === 'locked') {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center space-y-2">
            <Lock className="h-16 w-16 mx-auto text-primary" />
            <h2 className="text-2xl font-semibold">Vault Locked</h2>
            <p className="text-muted-foreground">
              Enter your master password to unlock the vault and access your
              secure data.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="unlock-password">Master Password</Label>
              <div className="relative">
                <Input
                  id="unlock-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      handleUnlock()
                    }
                  }}
                  placeholder="Enter your master password"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            <Button className="w-full" onClick={handleUnlock}>
              <Unlock className="h-4 w-4 mr-2" />
              Unlock Vault
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Unlock className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold">Vault</h2>
            <p className="text-xs text-muted-foreground">
              {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={handleLock}>
          <Lock className="h-4 w-4 mr-2" />
          Lock
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/2 border-r flex flex-col">
          <div className="p-4 border-b space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add New Entry
            </h4>
            <Input
              placeholder="Key (e.g., server-password)"
              value={newEntryKey}
              onChange={e => setNewEntryKey(e.target.value)}
            />
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="Value"
                value={newEntryValue}
                onChange={e => setNewEntryValue(e.target.value)}
              />
              <Button size="icon" onClick={handleAddEntry}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {entries.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <KeyRound className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>No entries yet</p>
                <p className="text-sm">Add your first secure entry above</p>
              </div>
            ) : (
              <div className="divide-y">
                {entries.map(entry => (
                  <div
                    key={entry.key}
                    className={`flex items-center justify-between p-3 hover:bg-muted/50 cursor-pointer ${
                      selectedEntry?.key === entry.key ? 'bg-muted' : ''
                    }`}
                    onClick={() => setSelectedEntry(entry)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium truncate">{entry.key}</p>
                        {entry.description && (
                          <p className="text-xs text-muted-foreground truncate">
                            {entry.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={e => {
                        e.stopPropagation()
                        handleDeleteEntry(entry.key)
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="w-1/2 flex flex-col">
          {selectedEntry ? (
            <>
              <div className="p-4 border-b">
                <h4 className="font-medium flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  Entry Details
                </h4>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="space-y-2">
                  <Label>Key</Label>
                  <div className="p-3 bg-muted rounded-lg font-mono text-sm break-all">
                    {selectedEntry.key}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Value</Label>
                  <div className="flex gap-2">
                    <div className="flex-1 p-3 bg-muted rounded-lg font-mono text-sm break-all">
                      {showEntryValue ? selectedEntry.value : '••••••••••••'}
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setShowEntryValue(!showEntryValue)}
                    >
                      {showEntryValue ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleCopyValue(selectedEntry.value)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {selectedEntry.description && (
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <p className="text-sm text-muted-foreground">
                      {selectedEntry.description}
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <KeyRound className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>Select an entry to view details</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default VaultsView
