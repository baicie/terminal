import type { SSHKeyRecord } from '@/service/database'
import {
  Key,
  KeyRound,
  Plus,
  Trash2,
  Wand2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ResponsiveConfirm } from '@/components/ui/responsive-dialog'
import { toast } from '@/components/ui/sonner'
import {
  EmptyState,
  ViewContainer,
  ViewContent,
  ViewToolbar,
} from '@/components/view-container'
import {
  createSSHKey,
  deleteSSHKey,
  getSSHKeys,
  searchSSHKeys,
  updateSSHKey,
} from '@/service/database'
import { GenerateKeyDialog } from './generate-dialog'
import { KeyForm } from './key-form'
import { KeyListPanel } from './key-list-panel'

type KeyFilter = 'all' | 'key' | 'certificate' | 'touchid' | 'fido2'

const KeychainView: React.FC = () => {
  const [keys, setKeys] = useState<SSHKeyRecord[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<KeyFilter>('all')
  const [loading, setLoading] = useState(true)
  const [selectedKey, setSelectedKey] = useState<SSHKeyRecord | null>(null)
  const [isNewKey, setIsNewKey] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [keyToDelete, setKeyToDelete] = useState<SSHKeyRecord | null>(null)
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false)

  const [formName, setFormName] = useState('')
  const [formKeyType, setFormKeyType] = useState<string>('key')
  const [formPrivateKey, setFormPrivateKey] = useState('')
  const [formPublicKey, setFormPublicKey] = useState('')
  const [formCertificate, setFormCertificate] = useState('')
  const [formPassphrase, setFormPassphrase] = useState('')

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

  const handleUseGeneratedKey = (result: {
    private_key: string
    public_key: string
    key_type: string
    fingerprint: string
  }) => {
    setFormName(`Generated ${result.key_type} Key`)
    setFormKeyType('key')
    setFormPrivateKey(result.private_key)
    setFormPublicKey(result.public_key)
    setFormCertificate('')
    setFormPassphrase('')
    setIsNewKey(true)
    setSelectedKey(null)
  }

  const handleFormChange = (field: string, value: string) => {
    switch (field) {
      case 'name': setFormName(value); break
      case 'keyType': setFormKeyType(value); break
      case 'privateKey': setFormPrivateKey(value); break
      case 'publicKey': setFormPublicKey(value); break
      case 'certificate': setFormCertificate(value); break
      case 'passphrase': setFormPassphrase(value); break
    }
  }

  return (
    <ViewContainer className="min-h-0 flex-row">
      <KeyListPanel
        keys={keys}
        loading={loading}
        selectedKey={selectedKey}
        searchQuery={searchQuery}
        filterType={filterType}
        onSearch={handleSearch}
        onFilterChange={setFilterType}
        onSelectKey={handleSelectKey}
        onNewKey={handleNewKey}
        onGenerate={() => setGenerateDialogOpen(true)}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
                  <KeyRound className="size-4" />
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
              <KeyForm
                selectedKey={selectedKey}
                isNewKey={isNewKey}
                formName={formName}
                formKeyType={formKeyType}
                formPrivateKey={formPrivateKey}
                formPublicKey={formPublicKey}
                formCertificate={formCertificate}
                formPassphrase={formPassphrase}
                onFormChange={handleFormChange}
                onImportFromFile={handleImportFromFile}
                onSave={handleSave}
                onDelete={() => {
                  setKeyToDelete(selectedKey)
                  setDeleteDialogOpen(true)
                }}
                onNewKey={handleNewKey}
              />
            </ViewContent>
          </>
        )}
      </div>

      <ResponsiveConfirm
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete SSH Key"
        description={
          keyToDelete
            ? `Are you sure you want to delete the key "${keyToDelete.name}"? This action cannot be undone.`
            : undefined
        }
        confirmText="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setKeyToDelete(null)}
      />

      <GenerateKeyDialog
        open={generateDialogOpen}
        onClose={() => setGenerateDialogOpen(false)}
        onUseKey={handleUseGeneratedKey}
      />
    </ViewContainer>
  )
}

export default KeychainView
