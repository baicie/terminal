import type { SSHKeyRecord } from '@/service/database'
import { KeyRound, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { KeyListSkeleton } from '@/components/ui/view-skeletons'
import {
  EmptyState,
  ViewContent,
  ViewToolbar,
} from '@/components/view-container'

type KeyFilter = 'all' | 'key' | 'certificate' | 'touchid' | 'fido2'

interface KeyListPanelProps {
  keys: SSHKeyRecord[]
  loading: boolean
  selectedKey: SSHKeyRecord | null
  searchQuery: string
  filterType: KeyFilter
  onSearch: (query: string) => void
  onFilterChange: (filter: KeyFilter) => void
  onSelectKey: (key: SSHKeyRecord) => void
  onNewKey: () => void
  onGenerate: () => void
}

export function KeyListPanel({
  keys,
  loading,
  selectedKey,
  searchQuery,
  filterType,
  onSearch,
  onFilterChange,
  onSelectKey,
  onNewKey,
  onGenerate,
}: KeyListPanelProps) {
  const filteredKeys = keys.filter(key => {
    if (filterType === 'all') return true
    if (filterType === 'key')
      return key.key_type === null || key.key_type === 'key'
    return key.key_type === filterType
  })

  return (
    <div className="flex min-h-0 w-80 shrink-0 flex-col border-r">
      <ViewToolbar className="flex-col items-stretch gap-2 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search keys..."
            value={searchQuery}
            onChange={e => onSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex gap-2">
          <Select value={filterType} onValueChange={v => onFilterChange(v as KeyFilter)}>
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
          <Button size="sm" onClick={onNewKey}>
            New
          </Button>
          <Button size="sm" variant="outline" onClick={onGenerate}>
            Generate
          </Button>
        </div>
      </ViewToolbar>

      <ViewContent className="flex-1 p-0">
        {loading ? (
          <KeyListSkeleton count={5} />
        ) : filteredKeys.length === 0 && !loading ? (
          <EmptyState
            icon={<KeyRound className="size-10" />}
            title="No keys yet"
            description="Add your first SSH key to get started"
            action={
              <Button onClick={onNewKey}>
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
                onClick={() => onSelectKey(key)}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-md bg-primary/10 text-primary">
                    <KeyRound className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{key.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Type: {key.key_type || 'SSH Key'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ViewContent>
    </div>
  )
}
