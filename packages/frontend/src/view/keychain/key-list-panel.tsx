import type { SSHKeyRecord } from '@/service/database'
import { KeyRound, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
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
  className?: string
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
  className,
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
  const { t } = useTranslation()
  const filteredKeys = keys.filter(key => {
    if (filterType === 'all') return true
    if (filterType === 'key')
      return key.key_type === null || key.key_type === 'key'
    return key.key_type === filterType
  })

  const getKeyTypeLabel = (type: string | null) => {
    if (!type) return t('keychain.sshKey')
    const labels: Record<string, string> = {
      certificate: t('keychain.certificate'),
      touchid: t('keychain.touchId'),
      fido2: t('keychain.fido2'),
    }
    return labels[type] ?? type
  }

  return (
    <div
      className={cn(
        'flex min-h-0 w-full flex-1 flex-col border-r md:w-80 md:flex-none',
        className,
      )}
    >
      <ViewToolbar className="flex-col items-stretch gap-2 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder={t('keychain.searchKeys')}
            value={searchQuery}
            onChange={e => onSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex gap-2">
          <Select value={filterType} onValueChange={v => onFilterChange(v as KeyFilter)}>
            <SelectTrigger className="flex-1 h-9">
              <SelectValue placeholder={t('keychain.filter')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('keychain.allKeys')}</SelectItem>
              <SelectItem value="key">KEY</SelectItem>
              <SelectItem value="certificate">
                {t('keychain.certificate')}
              </SelectItem>
              <SelectItem value="touchid">{t('keychain.touchId')}</SelectItem>
              <SelectItem value="fido2">{t('keychain.fido2')}</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={onNewKey}>
            {t('keychain.new')}
          </Button>
          <Button size="sm" variant="outline" onClick={onGenerate}>
            {t('keychain.generate')}
          </Button>
        </div>
      </ViewToolbar>

      <ViewContent className="flex-1 p-0">
        {loading ? (
          <KeyListSkeleton count={5} />
        ) : filteredKeys.length === 0 && !loading ? (
          <EmptyState
            icon={<KeyRound className="size-10" />}
            title={t('keychain.noKeys')}
            description={t('keychain.addFirstKey')}
            action={
              <Button onClick={onNewKey}>
                {t('keychain.addKey')}
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
                      {t('keychain.typeLabel', {
                        type: getKeyTypeLabel(key.key_type),
                      })}
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
