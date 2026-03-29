import type { SnippetPackageRecord, SnippetRecord } from '@/service/database'
import { Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  createSnippet,
  createSnippetPackage,
  deleteSnippet,
  deleteSnippetPackage,
  getSnippetPackages,
  getSnippets,
  updateSnippet,
} from '@/service/database'
import { useCurrentTeam, useIsTeamEnabled, useTeamStore } from '@/store/team'
import { PackageSidebar } from './package-sidebar'
import { SnippetFormDialog } from './snippet-form-dialog'
import {
  SnippetExecuteDialog,
  parseVariables,
} from './snippet-execute-dialog'
import { SnippetList } from './snippet-list'
import { SnippetPackageDialog } from './snippet-package-dialog'
import { SnippetShareDialog } from './snippet-share-dialog'

interface SnippetDialogProps {
  open: boolean
  onClose: () => void
  onExecute?: (script: string) => void
}

const SnippetManager: React.FC<SnippetDialogProps> = ({
  open,
  onClose,
  onExecute,
}) => {
  const [snippets, setSnippets] = useState<SnippetRecord[]>([])
  const [packages, setPackages] = useState<SnippetPackageRecord[]>([])
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingSnippet, setEditingSnippet] = useState<SnippetRecord | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isPackageDialogOpen, setIsPackageDialogOpen] = useState(false)
  const [isExecuteDialogOpen, setIsExecuteDialogOpen] = useState(false)
  const [executingSnippet, setExecutingSnippet] = useState<SnippetRecord | null>(null)
  const [variableValues, setVariableValues] = useState<Record<string, string>>({})
  const [newPackageName, setNewPackageName] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    script: '',
    packageId: '',
  })

  // Team sharing state
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false)
  const [sharingSnippet, setSharingSnippet] = useState<SnippetRecord | null>(null)
  const [sharePermission, setSharePermission] = useState<'readonly' | 'readwrite'>('readonly')

  // Team store
  const isTeamEnabled = useIsTeamEnabled()
  const currentTeam = useCurrentTeam()
  const shareSnippet = useTeamStore(s => s.shareSnippet)

  const loadData = useCallback(async () => {
    try {
      const snippetData = await getSnippets(selectedPackage || undefined)
      setSnippets(snippetData)
      const packageData = await getSnippetPackages()
      setPackages(packageData)
    } catch (error) {
      console.error('Failed to load snippets:', error)
    }
  }, [selectedPackage])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleCreate = async () => {
    if (!formData.name || !formData.script) return

    const newSnippet: SnippetRecord = {
      id: `snippet-${Date.now()}`,
      name: formData.name,
      description: formData.description,
      script: formData.script,
      package_id: formData.packageId || undefined,
    }

    try {
      await createSnippet(newSnippet)
      setIsCreateDialogOpen(false)
      setFormData({
        name: '',
        description: '',
        script: '',
        packageId: '',
      })
      loadData()
    } catch (error) {
      console.error('Failed to create snippet:', error)
    }
  }

  const handleUpdate = async () => {
    if (!editingSnippet) return
    try {
      await updateSnippet(editingSnippet)
      setEditingSnippet(null)
      loadData()
    } catch (error) {
      console.error('Failed to update snippet:', error)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteSnippet(id)
      loadData()
    } catch (error) {
      console.error('Failed to delete snippet:', error)
    }
  }

  const handleExecute = (script: string) => {
    if (onExecute) {
      onExecute(script)
    }
  }

  const handleCreatePackage = async () => {
    if (!newPackageName) return

    const newPackage: SnippetPackageRecord = {
      id: `pkg-${Date.now()}`,
      name: newPackageName,
    }

    try {
      await createSnippetPackage(newPackage)
      setIsPackageDialogOpen(false)
      setNewPackageName('')
      loadData()
    } catch (error) {
      console.error('Failed to create package:', error)
    }
  }

  const handleShareSnippet = async () => {
    if (!sharingSnippet || !currentTeam) return

    const snippetData = {
      id: sharingSnippet.id,
      name: sharingSnippet.name,
      description: sharingSnippet.description,
      script: sharingSnippet.script,
      package_id: sharingSnippet.package_id,
      tags: sharingSnippet.tags,
      variables: sharingSnippet.variables,
    }

    try {
      await shareSnippet(currentTeam.id, snippetData, sharePermission)
      setIsShareDialogOpen(false)
      setSharingSnippet(null)
      setSharePermission('readonly')
    } catch (error) {
      console.error('Failed to share snippet:', error)
    }
  }

  const handleFormChange = (data: Partial<typeof formData>) => {
    setFormData(prev => ({ ...prev, ...data }))
  }

  // Replace variables in script with values
  const replaceVariables = (script: string, values: Record<string, string>): string => {
    return script.replace(/\$\{?([A-Z_]\w*)\}?/gi, (_match, varName) => {
      return values[varName] ?? _match
    })
  }

  const handleExecuteClick = (snippet: SnippetRecord) => {
    const variables = parseVariables(snippet.script)
    if (variables.length > 0) {
      setExecutingSnippet(snippet)
      const initialValues: Record<string, string> = {}
      variables.forEach(v => {
        try {
          const storedVars = snippet.variables ? JSON.parse(snippet.variables) : []
          const varDef = storedVars.find(
            (v2: { name: string; defaultValue?: string }) => v2.name === v,
          )
          if (varDef?.defaultValue) {
            initialValues[v] = varDef.defaultValue
          }
        } catch {
          /* ignore */
        }
      })
      setVariableValues(initialValues)
      setIsExecuteDialogOpen(true)
    } else {
      handleExecute(snippet.script)
    }
  }

  const handleExecuteWithVariables = () => {
    if (!executingSnippet) return
    const finalScript = replaceVariables(executingSnippet.script, variableValues)
    handleExecute(finalScript)
    setIsExecuteDialogOpen(false)
    setExecutingSnippet(null)
    setVariableValues({})
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Snippets Manager</DialogTitle>
        </DialogHeader>

        <div className="flex gap-4 flex-1 min-h-0">
          <PackageSidebar
            packages={packages}
            selectedPackage={selectedPackage}
            onSelectPackage={setSelectedPackage}
            onCreatePackage={() => setIsPackageDialogOpen(true)}
            onDeletePackage={id => deleteSnippetPackage(id).then(loadData)}
          />

          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex items-center justify-between mb-4">
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                New Snippet
              </Button>
            </div>

            <SnippetList
              snippets={snippets}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onEdit={setEditingSnippet}
              onDelete={handleDelete}
              onExecute={handleExecuteClick}
              onShare={snippet => {
                setSharingSnippet(snippet)
                setSharePermission('readonly')
                setIsShareDialogOpen(true)
              }}
              isTeamEnabled={!!isTeamEnabled}
            />
          </div>
        </div>
      </DialogContent>

      <SnippetFormDialog
        open={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        mode="create"
        packages={packages}
        formData={formData}
        onFormChange={handleFormChange}
        onSubmit={handleCreate}
      />

      <SnippetFormDialog
        open={!!editingSnippet}
        onClose={() => setEditingSnippet(null)}
        mode="edit"
        snippet={editingSnippet}
        packages={packages}
        formData={formData}
        onFormChange={() => {}}
        onSubmit={handleUpdate}
      />

      <SnippetExecuteDialog
        open={isExecuteDialogOpen}
        onClose={() => setIsExecuteDialogOpen(false)}
        snippet={executingSnippet}
        variableValues={variableValues}
        onVariableChange={setVariableValues}
        onExecute={handleExecuteWithVariables}
      />

      <SnippetPackageDialog
        open={isPackageDialogOpen}
        onClose={() => setIsPackageDialogOpen(false)}
        packageName={newPackageName}
        onPackageNameChange={setNewPackageName}
        onSubmit={handleCreatePackage}
      />

      <SnippetShareDialog
        open={isShareDialogOpen}
        onClose={() => setIsShareDialogOpen(false)}
        snippet={sharingSnippet}
        permission={sharePermission}
        onPermissionChange={setSharePermission}
        teamName={currentTeam?.name}
        onShare={handleShareSnippet}
      />
    </Dialog>
  )
}

export default SnippetManager
