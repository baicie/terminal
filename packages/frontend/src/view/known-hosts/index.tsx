import type { KnownHostRecord } from '@/service/database'
import { Search, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ViewContainer, ViewToolbar } from '@/components/view-container'
import { KnownHostsContent } from './known-hosts-content'
import { KnownHostsDialogs } from './known-hosts-dialogs'
import { useKnownHosts } from './use-known-hosts'

const KnownHostsView: React.FC = () => {
  const state = useKnownHosts()
  const openDeleteDialog = (host: KnownHostRecord) => {
    state.setHostToDelete(host)
    state.setDeleteDialogOpen(true)
  }
  const openDeleteFromDetails = (host: KnownHostRecord) => {
    state.setHostToDelete(host)
    state.setSelectedHost(null)
    state.setDeleteDialogOpen(true)
  }
  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search hosts..."
            value={state.searchQuery}
            onChange={event => state.handleSearch(event.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={state.handleImportFromFile}
        >
          <Upload className="size-4 mr-1" data-icon="inline-start" />
          Import
        </Button>
        {state.hosts.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => state.setClearAllDialogOpen(true)}
          >
            <Trash2 className="size-4 mr-1" data-icon="inline-start" />
            Clear All
          </Button>
        )}
      </ViewToolbar>
      <KnownHostsContent
        hosts={state.hosts}
        loading={state.loading}
        selectedHost={state.selectedHost}
        setSelectedHost={state.setSelectedHost}
        onDelete={openDeleteDialog}
        onDeleteFromDetails={openDeleteFromDetails}
        onImport={state.handleImportFromFile}
      />
      <KnownHostsDialogs
        hosts={state.hosts}
        deleteDialogOpen={state.deleteDialogOpen}
        setDeleteDialogOpen={state.setDeleteDialogOpen}
        hostToDelete={state.hostToDelete}
        setHostToDelete={state.setHostToDelete}
        clearAllDialogOpen={state.clearAllDialogOpen}
        setClearAllDialogOpen={state.setClearAllDialogOpen}
        importDialogOpen={state.importDialogOpen}
        setImportDialogOpen={state.setImportDialogOpen}
        importContent={state.importContent}
        setImportContent={state.setImportContent}
        importError={state.importError}
        onDelete={state.handleDelete}
        onClearAll={state.handleClearAll}
        onImport={state.handleImport}
      />
    </ViewContainer>
  )
}

export default KnownHostsView
