import { ChevronRight, Search } from 'lucide-react'
import type { RefObject } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { getTypeBadgeClass, getTypeLabel } from './command-palette-utils'
import type {
  PaletteTab,
  PaletteTabItem,
  SearchResult,
} from './command-palette-types'

interface CommandPaletteDialogProps {
  open: boolean
  onClose: () => void
  inputRef: RefObject<HTMLInputElement | null>
  resultsRef: RefObject<HTMLDivElement | null>
  query: string
  setQuery: (query: string) => void
  activeTab: PaletteTab
  setActiveTab: (tab: PaletteTab) => void
  allTabs: PaletteTabItem[]
  results: SearchResult[]
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  loading: boolean
  onKeyDown: (event: React.KeyboardEvent) => void
  onSelect: (result: SearchResult) => void
  t: (key: string, options?: Record<string, unknown>) => string
}

export function CommandPaletteDialog({
  open,
  onClose,
  inputRef,
  resultsRef,
  query,
  setQuery,
  activeTab,
  setActiveTab,
  allTabs,
  results,
  selectedIndex,
  setSelectedIndex,
  loading,
  onKeyDown,
  onSelect,
  t,
}: CommandPaletteDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Command Palette</DialogTitle>
        </DialogHeader>
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder={t('cmdPalette.placeholder')}
              className="pl-10 text-base"
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
        <div className="flex border-b bg-muted/30 overflow-x-auto">
          {allTabs.map(tab => (
            <Button
              key={tab.key}
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-none px-3 py-2 h-auto gap-1.5 text-sm shrink-0 ${activeTab === tab.key ? 'bg-background border-b-2 border-primary rounded-t-md' : 'hover:bg-muted/50'}`}
            >
              {tab.icon}
              {tab.label}
            </Button>
          ))}
        </div>
        <div ref={resultsRef} className="max-h-[400px] overflow-y-auto p-2">
          {loading ? (
            <div className="text-center text-muted-foreground py-8">
              {t('cmdPalette.searching')}
            </div>
          ) : results.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              {query
                ? t('cmdPalette.noResults', { query })
                : activeTab === 'all'
                  ? t('cmdPalette.startTyping')
                  : t('cmdPalette.noTab', { tab: activeTab })}
            </div>
          ) : (
            <div className="space-y-1">
              {results.map((result, index) => (
                <Button
                  key={result.id}
                  variant="ghost"
                  className={`w-full justify-start h-auto py-3 px-3 gap-3 ${index === selectedIndex ? 'bg-primary/10 border border-primary/20' : 'hover:bg-muted/50'}`}
                  onClick={() => onSelect(result)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span
                    className={`shrink-0 ${index === selectedIndex ? 'text-primary' : 'text-muted-foreground'}`}
                  >
                    {result.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div
                      className={`font-medium truncate ${index === selectedIndex ? 'text-primary' : ''}`}
                    >
                      {result.title}
                    </div>
                    {(result.description || result.hint) && (
                      <div className="text-xs text-muted-foreground truncate">
                        {result.description || result.hint}
                      </div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 text-xs px-2 py-0.5 rounded ${getTypeBadgeClass(result.type)}`}
                  >
                    {getTypeLabel(result.type)}
                  </span>
                  <ChevronRight
                    className={`size-4 shrink-0 ${index === selectedIndex ? 'text-primary' : 'text-muted-foreground'}`}
                  />
                </Button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">
                ↑↓
              </kbd>{' '}
              {t('cmdPalette.navigate')}
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">
                Enter
              </kbd>{' '}
              {t('cmdPalette.select')}
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">
                Tab
              </kbd>{' '}
              {t('cmdPalette.switchTabs')}
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">
                Esc
              </kbd>{' '}
              {t('cmdPalette.close')}
            </span>
          </div>
          <span>{t('cmdPalette.results', { count: results.length })}</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
