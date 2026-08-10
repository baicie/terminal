import type { SnippetPackageRecord, SnippetRecord } from '@/service/database'
import { Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { parseVariables } from './snippet-execute-dialog'
import { SnippetList } from './snippet-list'
import {
  SnippetManagerDialogs,
  type SnippetFormData,
} from './snippet-manager-dialogs'

interface SnippetManagerProps {
  onExecute?: (script: string) => void
}

const SnippetManager: React.FC<SnippetManagerProps> = ({ onExecute }) => {
  const { t } = useTranslation()
  const [snippets, setSnippets] = useState<SnippetRecord[]>([])
  const [packages, setPackages] = useState<SnippetPackageRecord[]>([])
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingSnippet, setEditingSnippet] = useState<SnippetRecord | null>(
    null,
  )
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isPackageDialogOpen, setIsPackageDialogOpen] = useState(false)
  const [isExecuteDialogOpen, setIsExecuteDialogOpen] = useState(false)
  const [executingSnippet, setExecutingSnippet] =
    useState<SnippetRecord | null>(null)
  const [variableValues, setVariableValues] = useState<Record<string, string>>(
    {},
  )
  const [newPackageName, setNewPackageName] = useState('')
  const [formData, setFormData] = useState<SnippetFormData>({
    name: '',
    description: '',
    script: '',
    packageId: '',
  })

  // Team sharing state
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false)
  const [sharingSnippet, setSharingSnippet] = useState<SnippetRecord | null>(
    null,
  )
  const [sharePermission, setSharePermission] = useState<
    'readonly' | 'readwrite'
  >('readonly')

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
  const replaceVariables = (
    script: string,
    values: Record<string, string>,
  ): string => {
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
          const storedVars = snippet.variables
            ? JSON.parse(snippet.variables)
            : []
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
    const finalScript = replaceVariables(
      executingSnippet.script,
      variableValues,
    )
    handleExecute(finalScript)
    setIsExecuteDialogOpen(false)
    setExecutingSnippet(null)
    setVariableValues({})
  }

  return (
    <>
      <div className="flex min-h-[min(70vh,560px)] flex-col overflow-hidden rounded-xl border bg-card shadow-sm md:flex-row">
        <PackageSidebar
          packages={packages}
          selectedPackage={selectedPackage}
          onSelectPackage={setSelectedPackage}
          onCreatePackage={() => setIsPackageDialogOpen(true)}
          onDeletePackage={id => deleteSnippetPackage(id).then(loadData)}
        />

        <div className="flex min-h-[280px] min-w-0 flex-1 flex-col p-4 sm:p-5">
          <div className="mb-4 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <Button
              className="w-full sm:w-auto"
              onClick={() => setIsCreateDialogOpen(true)}
            >
              <Plus className="size-4" data-icon="inline-start" />
              {t('snippets.new')}
            </Button>
          </div>

          <div className="min-h-0 flex-1">
            <SnippetList
              snippets={snippets}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onCreateNew={() => setIsCreateDialogOpen(true)}
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
      </div>

      <SnippetManagerDialogs
        isCreateDialogOpen={isCreateDialogOpen}
        editingSnippet={editingSnippet}
        isExecuteDialogOpen={isExecuteDialogOpen}
        executingSnippet={executingSnippet}
        variableValues={variableValues}
        isPackageDialogOpen={isPackageDialogOpen}
        newPackageName={newPackageName}
        isShareDialogOpen={isShareDialogOpen}
        sharingSnippet={sharingSnippet}
        sharePermission={sharePermission}
        teamName={currentTeam?.name}
        packages={packages}
        formData={formData}
        onCloseCreate={() => setIsCreateDialogOpen(false)}
        onFormChange={handleFormChange}
        onCreate={handleCreate}
        onCloseEdit={() => setEditingSnippet(null)}
        onUpdate={handleUpdate}
        onCloseExecute={() => {
          setIsExecuteDialogOpen(false)
          setExecutingSnippet(null)
          setVariableValues({})
        }}
        onVariableChange={setVariableValues}
        onExecute={handleExecuteWithVariables}
        onClosePackage={() => setIsPackageDialogOpen(false)}
        onPackageNameChange={setNewPackageName}
        onCreatePackage={handleCreatePackage}
        onCloseShare={() => {
          setIsShareDialogOpen(false)
          setSharingSnippet(null)
          setSharePermission('readonly')
        }}
        onPermissionChange={setSharePermission}
        onShare={handleShareSnippet}
      />
    </>
  )
}

export default SnippetManager
