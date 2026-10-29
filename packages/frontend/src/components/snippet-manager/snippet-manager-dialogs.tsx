import type { SnippetPackageRecord, SnippetRecord } from '@/service/database'
import { SnippetExecuteDialog } from './snippet-execute-dialog'
import { SnippetFormDialog } from './snippet-form-dialog'
import { SnippetPackageDialog } from './snippet-package-dialog'
import { SnippetShareDialog } from './snippet-share-dialog'

export interface SnippetFormData {
  name: string
  description: string
  script: string
  packageId: string
}

interface SnippetManagerDialogsProps {
  isCreateDialogOpen: boolean
  editingSnippet: SnippetRecord | null
  isExecuteDialogOpen: boolean
  executingSnippet: SnippetRecord | null
  variableValues: Record<string, string>
  isPackageDialogOpen: boolean
  newPackageName: string
  isShareDialogOpen: boolean
  sharingSnippet: SnippetRecord | null
  sharePermission: 'readonly' | 'readwrite'
  teamName?: string
  packages: SnippetPackageRecord[]
  formData: SnippetFormData
  onCloseCreate: () => void
  onFormChange: (data: Partial<SnippetFormData>) => void
  onCreate: () => void
  onCloseEdit: () => void
  onUpdate: () => void
  onCloseExecute: () => void
  onVariableChange: (values: Record<string, string>) => void
  onExecute: () => void
  onClosePackage: () => void
  onPackageNameChange: (name: string) => void
  onCreatePackage: () => void
  onCloseShare: () => void
  onPermissionChange: (permission: 'readonly' | 'readwrite') => void
  onShare: () => void
}

export function SnippetManagerDialogs({
  isCreateDialogOpen,
  editingSnippet,
  isExecuteDialogOpen,
  executingSnippet,
  variableValues,
  isPackageDialogOpen,
  newPackageName,
  isShareDialogOpen,
  sharingSnippet,
  sharePermission,
  teamName,
  packages,
  formData,
  onCloseCreate,
  onFormChange,
  onCreate,
  onCloseEdit,
  onUpdate,
  onCloseExecute,
  onVariableChange,
  onExecute,
  onClosePackage,
  onPackageNameChange,
  onCreatePackage,
  onCloseShare,
  onPermissionChange,
  onShare,
}: SnippetManagerDialogsProps) {
  return (
    <>
      {isCreateDialogOpen ? (
        <SnippetFormDialog
          open
          onClose={onCloseCreate}
          mode="create"
          packages={packages}
          formData={formData}
          onFormChange={onFormChange}
          onSubmit={onCreate}
        />
      ) : null}

      {editingSnippet ? (
        <SnippetFormDialog
          key={editingSnippet.id}
          open
          onClose={onCloseEdit}
          mode="edit"
          snippet={editingSnippet}
          packages={packages}
          formData={formData}
          onFormChange={() => {}}
          onSubmit={onUpdate}
        />
      ) : null}

      {isExecuteDialogOpen && executingSnippet ? (
        <SnippetExecuteDialog
          open
          onClose={onCloseExecute}
          snippet={executingSnippet}
          variableValues={variableValues}
          onVariableChange={onVariableChange}
          onExecute={onExecute}
        />
      ) : null}

      {isPackageDialogOpen ? (
        <SnippetPackageDialog
          open
          onClose={onClosePackage}
          packageName={newPackageName}
          onPackageNameChange={onPackageNameChange}
          onSubmit={onCreatePackage}
        />
      ) : null}

      {isShareDialogOpen && sharingSnippet ? (
        <SnippetShareDialog
          open
          onClose={onCloseShare}
          snippet={sharingSnippet}
          permission={sharePermission}
          onPermissionChange={onPermissionChange}
          teamName={teamName}
          onShare={onShare}
        />
      ) : null}
    </>
  )
}
