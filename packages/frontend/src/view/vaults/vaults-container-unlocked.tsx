import { Lock, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ViewContainer,
  ViewContent,
  ViewToolbar,
} from '@/components/view-container'
import type { VaultsContainerController } from './use-vaults-container'
import { VaultEntryDialogs } from './vault-entry-dialogs'
import { VaultEntryDetail } from './vaults-container-entry-detail'
import { VaultEntryList } from './vaults-container-entry-list'

export function VaultsContainerUnlocked({
  vault,
}: {
  vault: VaultsContainerController
}) {
  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search vault..."
            value={vault.searchQuery}
            onChange={event => vault.setSearchQuery(event.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void vault.handleLock()}
        >
          <Lock className="size-4 mr-1" data-icon="inline-start" />
          Lock
        </Button>
        <Button size="sm" onClick={() => vault.setAddEntryDialogOpen(true)}>
          <Plus className="size-4 mr-1" data-icon="inline-start" />
          Add Entry
        </Button>
      </ViewToolbar>
      <ViewContent className="p-6 flex gap-6 min-h-0">
        <VaultEntryList
          entries={vault.filteredEntries}
          searchQuery={vault.searchQuery}
          selectedEntry={vault.selectedEntry}
          onSelectEntry={vault.setSelectedEntry}
        />
        <VaultEntryDetail vault={vault} />
      </ViewContent>
      <VaultEntryDialogs vault={vault} />
    </ViewContainer>
  )
}
