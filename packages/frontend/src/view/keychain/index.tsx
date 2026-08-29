import type { SSHKeyRecord } from '@/service/database'
import {
  createSSHKey,
  deleteSSHKey,
  getSSHKeys,
  searchSSHKeys,
  updateSSHKey,
} from '@/service/database'
import { ArrowLeft, Key, KeyRound, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ResponsiveConfirm } from '@/components/ui/responsive-dialog'
import { cn } from '@/lib/utils'
import {
  EmptyState,
  ViewContainer,
  ViewContent,
  ViewToolbar,
} from '@/components/view-container'
import { GenerateKeyDialog } from './generate-dialog'
import { KeyForm } from './key-form'
import { KeyListPanel } from './key-list-panel'
import { useKeyForm } from './use-key-form'

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

  const {
    formName,
    formKeyType,
    formPrivateKey,
    formPublicKey,
    formCertificate,
    formPassphrase,
    handleSelectKey: hookSelectKey,
    handleNewKey: hookNewKey,
    handleSave,
    handleDelete,
    handleImportFromFile,
    handleUseGeneratedKey,
    handleFormChange,
  } = useKeyForm()

  const loadKeys = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getSSHKeys()
      setKeys(data)
    } catch (error) {
      console.error('Failed to load keys:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadKeys()
  }, [loadKeys])

  const handleSearch = useCallback(
    async (query: string) => {
      setSearchQuery(query)
      if (query.trim()) {
        const results = await searchSSHKeys(query)
        setKeys(results)
      } else {
        loadKeys()
      }
    },
    [loadKeys],
  )

  const handleSelectKey = useCallback(
    (key: SSHKeyRecord) => {
      setSelectedKey(key)
      setIsNewKey(false)
      hookSelectKey(key)
    },
    [hookSelectKey],
  )

  const handleNewKey = useCallback(() => {
    setSelectedKey(null)
    setIsNewKey(true)
    hookNewKey()
  }, [hookNewKey])

  const handleBackToList = useCallback(() => {
    setSelectedKey(null)
    setIsNewKey(false)
  }, [])

  const handleSaveAndReload = useCallback(async () => {
    const data = handleSave(isNewKey, selectedKey, {
      formName,
      formKeyType,
      formPrivateKey,
      formPublicKey,
      formCertificate,
      formPassphrase,
    })
    if (!data) return

    if (isNewKey) {
      await createSSHKey(data)
    } else {
      await updateSSHKey(selectedKey!.id, data)
    }

    await loadKeys()
    setSelectedKey(null)
    setIsNewKey(false)
  }, [handleSave, isNewKey, selectedKey, formName, formKeyType, formPrivateKey, formPublicKey, formCertificate, formPassphrase, loadKeys])

  const handleDeleteAndReload = useCallback(async () => {
    const id = handleDelete(keyToDelete)
    if (!id) return

    await deleteSSHKey(id)
    setKeys(keys.filter(k => k.id !== id))
    if (selectedKey?.id === id) {
      setSelectedKey(null)
      setIsNewKey(false)
    }
    setKeyToDelete(null)
    setDeleteDialogOpen(false)
  }, [handleDelete, keyToDelete, keys, selectedKey])

  const showingForm = selectedKey !== null || isNewKey

  return (
    <ViewContainer className="min-h-0 md:flex-row">
      <KeyListPanel
        className={showingForm ? 'hidden md:flex' : undefined}
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

      <div
        className={cn(
          'min-h-0 min-w-0 flex-1 flex-col',
          showingForm ? 'flex' : 'hidden md:flex',
        )}
      >
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 md:hidden"
                  aria-label="Back to keys"
                  onClick={handleBackToList}
                >
                  <ArrowLeft data-icon="inline-start" />
                </Button>
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
                <Button size="sm" onClick={handleSaveAndReload} disabled={!formName.trim()}>
                  Save
                </Button>
              </div>
            </ViewToolbar>

            <ViewContent className="p-4 sm:p-6">
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
                onSave={handleSaveAndReload}
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
        onConfirm={handleDeleteAndReload}
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
