import { useEffect, useState, useCallback } from 'react'
import {
  ViewContainer,
  ViewToolbar,
  ViewContent,
  EmptyState,
} from '@/components/view-container'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from '@/components/ui/sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Key,
  Plus,
  Trash2,
  Search,
  Shield,
  Fingerprint,
  KeyRound,
  FileKey,
  Wand2,
  Loader2,
  Eye,
  EyeOff,
} from 'lucide-react'
import {
  getSSHKeys,
  searchSSHKeys,
  createSSHKey,
  updateSSHKey,
  deleteSSHKey,
  SSHKeyRecord,
} from '@/service/database'
import { sshService } from '@/service/ssh'
import { format } from '@/lib/date-utils'

type KeyFilter = 'all' | 'key' | 'certificate' | 'touchid' | 'fido2'

const getKeyTypeIcon = (keyType: string | null) => {
  switch (keyType) {
    case 'certificate':
      return <Shield className="size-4" />
    case 'touchid':
      return <Fingerprint className="size-4" />
    case 'fido2':
      return <Shield className="size-4" />
    default:
      return <KeyRound className="size-4" />
  }
}

const getKeyTypeLabel = (keyType: string | null): string => {
  switch (keyType) {
    case 'certificate':
      return 'Certificate'
    case 'touchid':
      return 'Touch ID'
    case 'fido2':
      return 'FIDO2'
    default:
      return 'SSH Key'
  }
}

const detectKeyType = (content: string): string | null => {
  if (content.includes('CERTIFICATE')) return 'certificate'
  if (
    content.includes('ssh-rsa') ||
    content.includes('ssh-ed25519') ||
    content.includes('ecdsa-sha2')
  )
    return 'key'
  return null
}

const KeychainView: React.FC = () => {
  const [keys, setKeys] = useState<SSHKeyRecord[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<KeyFilter>('all')
  const [loading, setLoading] = useState(true)
  const [selectedKey, setSelectedKey] = useState<SSHKeyRecord | null>(null)
  const [isNewKey, setIsNewKey] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [keyToDelete, setKeyToDelete] = useState<SSHKeyRecord | null>(null)

  // Form state
  const [formName, setFormName] = useState('')
  const [formKeyType, setFormKeyType] = useState<string>('key')
  const [formPrivateKey, setFormPrivateKey] = useState('')
  const [formPublicKey, setFormPublicKey] = useState('')
  const [formCertificate, setFormCertificate] = useState('')
  const [formPassphrase, setFormPassphrase] = useState('')

  // Generate key state
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false)
  const [genKeyType, setGenKeyType] = useState<string>('ed25519')
  const [genComment, setGenComment] = useState('')
  const [genPassphrase, setGenPassphrase] = useState('')
  const [genConfirmPassphrase, setGenConfirmPassphrase] = useState('')
  const [showGenPassphrase, setShowGenPassphrase] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatedResult, setGeneratedResult] = useState<{
    private_key: string
    public_key: string
    key_type: string
    fingerprint: string
  } | null>(null)
  const [showPrivateKey, setShowPrivateKey] = useState(false)

  const loadKeys = async () => {
    setLoading(true)
    try {
      const data = await getSSHKeys()
      setKeys(data)
    } catch (error) {
      console.error('Failed to load keys:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadKeys()
  }, [])

  const handleSearch = async (query: string) => {
    setSearchQuery(query)
    if (query.trim()) {
      const results = await searchSSHKeys(query)
      setKeys(results)
    } else {
      loadKeys()
    }
  }

  const handleSelectKey = (key: SSHKeyRecord) => {
    setSelectedKey(key)
    setIsNewKey(false)
    setFormName(key.name)
    setFormKeyType(key.key_type || 'key')
    setFormPrivateKey(key.private_key || '')
    setFormPublicKey(key.public_key || '')
    setFormCertificate(key.certificate || '')
    setFormPassphrase(key.passphrase || '')
  }

  const handleNewKey = () => {
    setSelectedKey(null)
    setIsNewKey(true)
    setFormName('')
    setFormKeyType('key')
    setFormPrivateKey('')
    setFormPublicKey('')
    setFormCertificate('')
    setFormPassphrase('')
  }

  const handleSave = async () => {
    if (!formName.trim()) return

    if (isNewKey) {
      const newKey: Omit<SSHKeyRecord, 'created_at' | 'updated_at'> = {
        id: crypto.randomUUID(),
        name: formName,
        key_type: formKeyType,
        private_key: formPrivateKey || null,
        public_key: formPublicKey || null,
        certificate: formCertificate || null,
        passphrase: formPassphrase || null,
        is_encrypted: formPrivateKey ? 0 : 0,
      }
      await createSSHKey(newKey)
    } else if (selectedKey) {
      await updateSSHKey(selectedKey.id, {
        name: formName,
        key_type: formKeyType,
        private_key: formPrivateKey || null,
        public_key: formPublicKey || null,
        certificate: formCertificate || null,
        passphrase: formPassphrase || null,
        is_encrypted: formPrivateKey ? 1 : 0,
      })
    }

    await loadKeys()
    setSelectedKey(null)
    setIsNewKey(false)
  }

  const handleDelete = async () => {
    if (keyToDelete) {
      await deleteSSHKey(keyToDelete.id)
      setKeys(keys.filter(k => k.id !== keyToDelete.id))
      if (selectedKey?.id === keyToDelete.id) {
        setSelectedKey(null)
        setIsNewKey(false)
      }
      setKeyToDelete(null)
      setDeleteDialogOpen(false)
    }
  }

  const handleImportFromFile = useCallback(
    async (field: 'private' | 'public' | 'certificate') => {
      try {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.pem,.key,.pub,.crt,.cert'
        input.onchange = async e => {
          const file = (e.target as HTMLInputElement).files?.[0]
          if (file) {
            const text = await file.text()
            if (field === 'private') {
              setFormPrivateKey(text)
              const detected = detectKeyType(text)
              if (detected) setFormKeyType(detected)
            } else if (field === 'public') {
              setFormPublicKey(text)
            } else {
              setFormCertificate(text)
            }
          }
        }
        input.click()
      } catch (error) {
        console.error('Failed to import file:', error)
      }
    },
    [],
  )

  const handleGenerateKey = async () => {
    if (genPassphrase !== genConfirmPassphrase) {
      toast.error('Passphrases do not match')
      return
    }
    setGenerating(true)
    try {
      const result = await sshService.generateSSHKey(
        genKeyType as
          | 'ed25519'
          | 'rsa'
          | 'rsa4096'
          | 'ecdsa'
          | 'ecdsa-nistp256'
          | 'ecdsa-nistp384'
          | 'ecdsa-nistp521',
        genComment,
        genPassphrase || undefined,
      )
      setGeneratedResult(result)
      toast.success('Key generated successfully')
    } catch (error) {
      console.error('Failed to generate key:', error)
      toast.error(`Failed to generate key: ${error}`)
    } finally {
      setGenerating(false)
    }
  }

  const handleUseGeneratedKey = () => {
    if (!generatedResult) return
    setFormName(genComment || `Generated ${generatedResult.key_type} Key`)
    setFormKeyType('key')
    setFormPrivateKey(generatedResult.private_key)
    setFormPublicKey(generatedResult.public_key)
    setFormCertificate('')
    setFormPassphrase(genPassphrase)
    setIsNewKey(true)
    setSelectedKey(null)
    setGenerateDialogOpen(false)
    setGeneratedResult(null)
    setGenComment('')
    setGenPassphrase('')
    setGenConfirmPassphrase('')
  }

  const handleCloseGenerateDialog = () => {
    setGenerateDialogOpen(false)
    setGeneratedResult(null)
    setGenComment('')
    setGenPassphrase('')
    setGenConfirmPassphrase('')
    setShowGenPassphrase(false)
  }

  const handleCopyToClipboard = (text: string, label: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        toast.success(`${label} copied to clipboard`)
      })
      .catch(() => {
        toast.error('Failed to copy')
      })
  }

  const filteredKeys = keys.filter(key => {
    if (filterType === 'all') return true
    if (filterType === 'key')
      return key.key_type === null || key.key_type === 'key'
    return key.key_type === filterType
  })

  return (
    <ViewContainer className="flex-row">
      {/* Left panel - Key list */}
      <div className="w-80 border-r flex flex-col">
        <ViewToolbar className="flex-col items-stretch gap-2 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search keys..."
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <div className="flex gap-2">
            <Select
              value={filterType}
              onValueChange={v => setFilterType(v as KeyFilter)}
            >
              <SelectTrigger className="flex-1 h-9">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Keys</SelectItem>
                <SelectItem value="key">KEY</SelectItem>
                <SelectItem value="certificate">Certificate</SelectItem>
                <SelectItem value="touchid">Touch ID</SelectItem>
                <SelectItem value="fido2">FIDO2</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleNewKey}>
              <Plus className="size-4 mr-1" data-icon="inline-start" />
              New
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setGenerateDialogOpen(true)}
            >
              <Wand2 className="size-4 mr-1" data-icon="inline-start" />
              Generate
            </Button>
          </div>
        </ViewToolbar>

        <ViewContent className="flex-1 p-0">
          {filteredKeys.length === 0 && !loading ? (
            <EmptyState
              icon={<Key className="size-10" />}
              title="No keys yet"
              description="Add your first SSH key to get started"
              action={
                <Button onClick={handleNewKey}>
                  <Plus className="size-4 mr-1" data-icon="inline-start" />
                  Add Key
                </Button>
              }
              className="py-12"
            />
          ) : (
            <div className="divide-y">
              {filteredKeys.map(key => (
                <div
                  key={key.id}
                  className={`p-4 hover:bg-accent/50 cursor-pointer transition-colors ${
                    selectedKey?.id === key.id
                      ? 'bg-accent border-l-2 border-primary'
                      : ''
                  }`}
                  onClick={() => handleSelectKey(key)}
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-md bg-primary/10 text-primary">
                      {getKeyTypeIcon(key.key_type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{key.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Type: {getKeyTypeLabel(key.key_type)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ViewContent>
      </div>

      {/* Right panel - Key details */}
      <div className="flex-1 flex flex-col">
        {!selectedKey && !isNewKey ? (
          <ViewContent className="flex items-center justify-center">
            <EmptyState
              icon={<Key className="size-12" />}
              title="Select a key"
              description="Choose a key from the list to view or edit details"
            />
          </ViewContent>
        ) : (
          <>
            <ViewToolbar className="justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-md bg-primary/10 text-primary">
                  {getKeyTypeIcon(formKeyType)}
                </div>
                <span className="font-semibold">
                  {isNewKey ? 'New Key' : 'Edit Key'}
                </span>
              </div>
              <div className="flex gap-2">
                {!isNewKey && selectedKey && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      setKeyToDelete(selectedKey)
                      setDeleteDialogOpen(true)
                    }}
                  >
                    <Trash2 className="size-4 mr-1" data-icon="inline-start" />
                    Delete
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!formName.trim()}
                >
                  Save
                </Button>
              </div>
            </ViewToolbar>

            <ViewContent className="p-6">
              <div className="max-w-2xl space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="name">Label *</Label>
                  <Input
                    id="name"
                    placeholder="Add a label..."
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Key Type</Label>
                  <Select value={formKeyType} onValueChange={setFormKeyType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select key type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="key">KEY</SelectItem>
                      <SelectItem value="certificate">Certificate</SelectItem>
                      <SelectItem value="touchid">Touch ID</SelectItem>
                      <SelectItem value="fido2">FIDO2</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {formKeyType === 'key' || formKeyType === 'certificate' ? (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="privateKey">Private Key *</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleImportFromFile('private')}
                        >
                          <FileKey
                            className="size-4 mr-1"
                            data-icon="inline-start"
                          />
                          Import from file
                        </Button>
                      </div>
                      <Textarea
                        id="privateKey"
                        placeholder="Paste private key content or import from file..."
                        value={formPrivateKey}
                        onChange={e => setFormPrivateKey(e.target.value)}
                        className="font-mono text-xs h-32"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="publicKey">Public Key</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleImportFromFile('public')}
                        >
                          <FileKey
                            className="size-4 mr-1"
                            data-icon="inline-start"
                          />
                          Import from file
                        </Button>
                      </div>
                      <Textarea
                        id="publicKey"
                        placeholder="Paste public key content..."
                        value={formPublicKey}
                        onChange={e => setFormPublicKey(e.target.value)}
                        className="font-mono text-xs h-24"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="passphrase">Passphrase</Label>
                      <Input
                        id="passphrase"
                        type="password"
                        placeholder="Enter passphrase for encrypted key..."
                        value={formPassphrase}
                        onChange={e => setFormPassphrase(e.target.value)}
                      />
                    </div>
                  </>
                ) : null}

                {formKeyType === 'certificate' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="certificate">Certificate</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleImportFromFile('certificate')}
                      >
                        <FileKey
                          className="size-4 mr-1"
                          data-icon="inline-start"
                        />
                        Import from file
                      </Button>
                    </div>
                    <Textarea
                      id="certificate"
                      placeholder="Paste certificate content..."
                      value={formCertificate}
                      onChange={e => setFormCertificate(e.target.value)}
                      className="font-mono text-xs h-24"
                    />
                  </div>
                )}

                {!isNewKey && selectedKey && (
                  <div className="pt-4 border-t">
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>
                        Created:{' '}
                        {format(selectedKey.created_at, 'MMM dd, yyyy HH:mm')}
                      </div>
                      <div>
                        Updated:{' '}
                        {format(selectedKey.updated_at, 'MMM dd, yyyy HH:mm')}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </ViewContent>
          </>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete SSH Key</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the key "{keyToDelete?.name}"?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setKeyToDelete(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Generate SSH Key Dialog */}
      <Dialog
        open={generateDialogOpen}
        onOpenChange={handleCloseGenerateDialog}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="size-5" />
              Generate SSH Key
            </DialogTitle>
          </DialogHeader>

          {!generatedResult ? (
            <div className="space-y-4 overflow-y-auto flex-1">
              <div>
                <Label htmlFor="gen-type">Key Type</Label>
                <Select value={genKeyType} onValueChange={setGenKeyType}>
                  <SelectTrigger id="gen-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ed25519">
                      Ed25519 (Recommended)
                    </SelectItem>
                    <SelectItem value="rsa4096">RSA 4096-bit</SelectItem>
                    <SelectItem value="rsa">RSA 2048-bit</SelectItem>
                    <SelectItem value="ecdsa-nistp256">ECDSA P-256</SelectItem>
                    <SelectItem value="ecdsa-nistp384">ECDSA P-384</SelectItem>
                    <SelectItem value="ecdsa-nistp521">ECDSA P-521</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="gen-comment">Comment / Label</Label>
                <Input
                  id="gen-comment"
                  placeholder="user@hostname"
                  value={genComment}
                  onChange={e => setGenComment(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="gen-passphrase">Passphrase (optional)</Label>
                <div className="relative">
                  <Input
                    id="gen-passphrase"
                    type={showGenPassphrase ? 'text' : 'password'}
                    placeholder="Enter passphrase"
                    value={genPassphrase}
                    onChange={e => setGenPassphrase(e.target.value)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 size-7"
                    onClick={() => setShowGenPassphrase(!showGenPassphrase)}
                  >
                    {showGenPassphrase ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div>
                <Label htmlFor="gen-confirm-passphrase">
                  Confirm Passphrase
                </Label>
                <Input
                  id="gen-confirm-passphrase"
                  type={showGenPassphrase ? 'text' : 'password'}
                  placeholder="Confirm passphrase"
                  value={genConfirmPassphrase}
                  onChange={e => setGenConfirmPassphrase(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4 overflow-y-auto flex-1">
              <div className="rounded-md bg-green-500/10 border border-green-500/30 p-3 text-sm text-green-600 dark:text-green-400">
                Key generated successfully! Type: {generatedResult.key_type}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Fingerprint</Label>
                  <span className="text-xs text-muted-foreground font-mono truncate ml-2">
                    {generatedResult.fingerprint}
                  </span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Public Key</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() =>
                      handleCopyToClipboard(
                        generatedResult.public_key,
                        'Public key',
                      )
                    }
                  >
                    Copy
                  </Button>
                </div>
                <Textarea
                  readOnly
                  value={generatedResult.public_key}
                  className="h-20 font-mono text-xs"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Private Key</Label>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => setShowPrivateKey(!showPrivateKey)}
                    >
                      {showPrivateKey ? (
                        <EyeOff className="size-3" />
                      ) : (
                        <Eye className="size-3" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() =>
                        handleCopyToClipboard(
                          generatedResult.private_key,
                          'Private key',
                        )
                      }
                    >
                      Copy
                    </Button>
                  </div>
                </div>
                <Textarea
                  readOnly
                  value={
                    showPrivateKey
                      ? generatedResult.private_key
                      : '••••••••••••••••••••••••••••••••'
                  }
                  className="h-32 font-mono text-xs"
                />
                <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                  Store your private key securely. Anyone with this key can
                  access your servers.
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="shrink-0">
            {!generatedResult ? (
              <>
                <Button variant="outline" onClick={handleCloseGenerateDialog}>
                  Cancel
                </Button>
                <Button onClick={handleGenerateKey} disabled={generating}>
                  {generating ? (
                    <>
                      <Loader2 className="size-4 mr-1 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Wand2 className="size-4 mr-1" data-icon="inline-start" />
                      Generate Key
                    </>
                  )}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setGeneratedResult(null)
                  }}
                >
                  Generate Another
                </Button>
                <Button onClick={handleUseGeneratedKey}>Use This Key</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ViewContainer>
  )
}

export default KeychainView
