/**
 * 全局键盘快捷键速查面板
 *
 * 触发方式：
 *   - macOS: ⌘ + /     或者     Shift + ?
 *   - Win / Linux: Ctrl + /     或者     Shift + ?
 *
 * 用 shortcutsService 作为唯一数据源，避免再造一套。
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  builtInActions,
  shortcutsService,
  type Shortcut,
} from '@/service/shortcuts'

const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform)

/** 把 ['Ctrl', 'Shift', 'K'] 渲染成 macOS-friendly 的 kbd 序列 */
function renderKeys(keys: string[]) {
  const display = keys.map(k => {
    if (!isMac) return k
    if (k === 'Ctrl' || k === 'Meta') return '⌘'
    if (k === 'Shift') return '⇧'
    if (k === 'Alt') return '⌥'
    return k
  })
  return display.map((k, i) => (
    <React.Fragment key={`${k}-${i}`}>
      <kbd
        className={cn(
          'inline-flex items-center justify-center min-w-[1.6rem] px-1.5 h-6',
          'rounded-md border border-border bg-muted/60 text-foreground/90',
          'text-[11px] font-mono font-medium leading-none shadow-sm',
        )}
      >
        {k}
      </kbd>
      {i < display.length - 1 && (
        <span className="text-muted-foreground text-xs mx-1">
          {isMac ? '' : '+'}
        </span>
      )}
    </React.Fragment>
  ))
}

/** 通过 action id 找到对应的人类可读名 */
function actionLabel(action: string): string {
  return builtInActions.find(a => a.id === action)?.name ?? action
}

interface ShortcutsHelpDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function ShortcutsHelpDialog({
  open,
  onOpenChange,
}: ShortcutsHelpDialogProps) {
  const { t } = useTranslation()
  const [query, setQuery] = React.useState('')

  // 每次打开重置搜索
  React.useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const allShortcuts = React.useMemo(
    () => shortcutsService.getShortcuts(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open], // 重新拉取以防设置面板里有改动
  )

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allShortcuts
    return allShortcuts.filter(s => {
      const hay = [s.name, s.action, actionLabel(s.action), s.keys.join(' ')]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [allShortcuts, query])

  // 按 action 类别分组（通过简单前缀启发）
  const groups = React.useMemo(() => {
    const buckets: Record<string, Shortcut[]> = {
      Navigation: [],
      Terminal: [],
      View: [],
      Other: [],
    }
    for (const s of filtered) {
      if (
        s.action.startsWith('new-') ||
        s.action.includes('tab') ||
        s.action === 'command-palette'
      ) {
        buckets.Navigation.push(s)
      } else if (
        s.action.includes('terminal') ||
        s.action.includes('zoom') ||
        s.action.startsWith('split-') ||
        s.action === 'clear-terminal'
      ) {
        buckets.Terminal.push(s)
      } else if (s.action.includes('sidebar') || s.action.includes('reload')) {
        buckets.View.push(s)
      } else {
        buckets.Other.push(s)
      }
    }
    return buckets
  }, [filtered])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('shortcuts.description')}</DialogDescription>
        </DialogHeader>

        <div className="mt-2">
          <Input
            autoFocus
            placeholder={t('shortcuts.search')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="h-9"
          />
        </div>

        <ScrollArea className="mt-3 h-[60vh] pr-2">
          {filtered.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {t('shortcuts.empty')}
            </p>
          )}

          {Object.entries(groups).map(([groupName, list], idx) => {
            if (list.length === 0) return null
            return (
              <div key={groupName} className="mb-4">
                {idx > 0 && <Separator className="my-3" />}
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {groupName}
                </h3>
                <ul className="space-y-1">
                  {list.map(s => (
                    <li
                      key={s.id}
                      className={cn(
                        'flex items-center justify-between gap-4 rounded-md px-2 py-1.5',
                        'hover:bg-accent/40 transition-colors',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          {s.name || actionLabel(s.action)}
                        </p>
                        {!s.enabled && (
                          <p className="text-[10px] text-muted-foreground">
                            disabled
                          </p>
                        )}
                      </div>
                      <div className="flex items-center shrink-0">
                        {renderKeys(s.keys)}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

export default ShortcutsHelpDialog
