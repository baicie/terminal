import type { VaultEntry } from '@/service/vault'
import { KeyRound, Lock, Plus, Trash2, Unlock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const submitOnEnter = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') props.onAddEntry()
  }
  return (
    <div className="space-y-3 border-b p-4">
      <h4 className="flex items-center gap-2 text-sm font-medium">
        <Plus className="size-4" />
        {t('vaults.addNewEntry')}
      </h4>
      <Input
        aria-label={t('vaults.keyLabel')}
        placeholder={t('vaults.key')}
        value={props.newEntryKey}
        onChange={event => props.onNewEntryKeyChange(event.target.value)}
        onKeyDown={submitOnEnter}
      />
      <div className="flex gap-2">
        <Input
          aria-label={t('vaults.valueLabel')}
          type="password"
          placeholder={t('vaults.value')}
          value={props.newEntryValue}
          onChange={event => props.onNewEntryValueChange(event.target.value)}
          onKeyDown={submitOnEnter}
        />
        <Button size="icon" aria-label={t('vaults.addNewEntry')} onClick={props.onAddEntry}>
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  )
}

/**
 * Rows are listbox options rather than divs with a click handler so the whole
 * list is reachable in Tab order and Enter/Space activates the focused entry.
 */
function EntryList(props: VaultsViewEntriesProps) {
  const { t } = useTranslation()
  if (props.entries.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <KeyRound className="mx-auto mb-2 size-10 opacity-50" />
        <p>{t('vaults.noEntries')}</p>
        <p className="text-sm">{t('vaults.addFirstEntry')}</p>
      </div>
    )
  }
  return (
    <div className="divide-y" role="listbox" aria-label={t('vaults.title')}>
      {props.entries.map(entry => (
        <div
          key={entry.key}
          role="option"
          tabIndex={0}
          aria-selected={props.selectedEntry?.key === entry.key}
          className={cn(
            'flex cursor-pointer items-center justify-between p-3 hover:bg-muted/50 focus-visible:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
            props.selectedEntry?.key === entry.key && 'bg-muted',
          )}
          onClick={() => props.onSelectEntry(entry)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              props.onSelectEntry(entry)
            }
          }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <KeyRound className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate font-medium">{entry.key}</p>
              {entry.description && (
                <p className="truncate text-xs text-muted-foreground">
                  {entry.description}
                </p>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={t('vaults.deleteEntry')}
            onClick={event => {
              event.stopPropagation()
              props.onDeleteEntry(entry.key)
            }}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      ))}
    </div>
  )
}

export function VaultsViewEntries(props: VaultsViewEntriesProps) {
  const { t } = useTranslation()
  const count = props.entries.length
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
            <Unlock className="size-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold">{t('vaults.vault')}</h2>
            <p className="text-xs text-muted-foreground">
              {t(count === 1 ? 'vaults.entryCountOne' : 'vaults.entryCountMany', {
                total: count,
              })}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={props.onLock}>
          <Lock className="size-4 mr-2" />
          {t('vaults.lock')}
        </Button>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-1/2 flex-col border-r">
          <AddEntryForm {...props} />
          <div className="flex-1 overflow-y-auto">
            <EntryList {...props} />
          </div>
        </div>
        <div className="flex w-1/2 flex-col">
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
