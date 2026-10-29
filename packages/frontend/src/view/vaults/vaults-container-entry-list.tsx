import type { VaultEntry } from '@/service/vault'
import { Key, Server, ShieldCheck } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface VaultEntryListProps {
  entries: VaultEntry[]
  searchQuery: string
  selectedEntry: VaultEntry | null
  onSelectEntry: (entry: VaultEntry) => void
}

export function VaultEntryList({
  entries,
  searchQuery,
  selectedEntry,
  onSelectEntry,
}: VaultEntryListProps) {
  return (
    <div className="w-80 shrink-0 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="size-4 text-green-500" />
        Vault unlocked
      </div>
      {entries.length === 0 ? (
        <div className="text-center text-muted-foreground text-sm py-8">
          {searchQuery ? 'No matching entries' : 'No entries yet'}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="space-y-1 pr-4">
            {entries.map(entry => (
              <button
                key={entry.key}
                type="button"
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg transition-colors',
                  selectedEntry?.key === entry.key
                    ? 'bg-primary/10 border border-primary/20'
                    : 'hover:bg-accent/50',
                )}
                onClick={() => onSelectEntry(entry)}
              >
                <div className="flex items-center gap-2">
                  {entry.key.startsWith('host:') ? (
                    <Server className="size-4 text-blue-500 shrink-0" />
                  ) : (
                    <Key className="size-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {entry.key.split(':').pop() || entry.key}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {entry.key}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
