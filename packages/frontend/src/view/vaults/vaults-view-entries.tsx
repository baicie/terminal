import type { VaultEntry } from '@/service/vault'
import { KeyRound, Lock, Plus, Trash2, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { VaultsViewEntryDetails } from './vaults-view-entry-details'

interface VaultsViewEntriesProps {
  entries: VaultEntry[]
  selectedEntry: VaultEntry | null
  newEntryKey: string
  newEntryValue: string
  showEntryValue: boolean
  onLock: () => void
  onNewEntryKeyChange: (value: string) => void
  onNewEntryValueChange: (value: string) => void
  onAddEntry: () => void
  onSelectEntry: (entry: VaultEntry) => void
  onDeleteEntry: (key: string) => void
  onShowEntryValueChange: (value: boolean) => void
  onCopyValue: (value: string) => void
}

function AddEntryForm(props: VaultsViewEntriesProps) {
  return (
    <div className="p-4 border-b space-y-3">
      <h4 className="text-sm font-medium flex items-center gap-2">
        <Plus className="h-4 w-4" />
        Add New Entry
      </h4>
      <Input
        placeholder="Key (e.g., server-password)"
        value={props.newEntryKey}
        onChange={event => props.onNewEntryKeyChange(event.target.value)}
      />
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder="Value"
          value={props.newEntryValue}
          onChange={event => props.onNewEntryValueChange(event.target.value)}
        />
        <Button size="icon" onClick={props.onAddEntry}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function EntryList(props: VaultsViewEntriesProps) {
  if (props.entries.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <KeyRound className="h-10 w-10 mx-auto mb-2 opacity-50" />
        <p>No entries yet</p>
        <p className="text-sm">Add your first secure entry above</p>
      </div>
    )
  }
  return (
    <div className="divide-y">
      {props.entries.map(entry => (
        <div
          key={entry.key}
          className={cn(
            'flex items-center justify-between p-3 hover:bg-muted/50 cursor-pointer',
            props.selectedEntry?.key === entry.key && 'bg-muted',
          )}
          onClick={() => props.onSelectEntry(entry)}
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
            onClick={event => {
              event.stopPropagation()
              props.onDeleteEntry(entry.key)
            }}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
    </div>
  )
}

export function VaultsViewEntries(props: VaultsViewEntriesProps) {
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
              {props.entries.length}{' '}
              {props.entries.length === 1 ? 'entry' : 'entries'}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={props.onLock}>
          <Lock className="h-4 w-4 mr-2" />
          Lock
        </Button>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/2 border-r flex flex-col">
          <AddEntryForm {...props} />
          <div className="flex-1 overflow-y-auto">
            <EntryList {...props} />
          </div>
        </div>
        <div className="w-1/2 flex flex-col">
          <VaultsViewEntryDetails
            entry={props.selectedEntry}
            showValue={props.showEntryValue}
            onShowValueChange={props.onShowEntryValueChange}
            onCopyValue={props.onCopyValue}
          />
        </div>
      </div>
    </div>
  )
}
