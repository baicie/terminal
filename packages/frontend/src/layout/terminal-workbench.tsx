import type { SplitGroup, Tab } from '@/types'
import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { TerminalSplitSash } from './terminal-split-sash'

interface TerminalWorkbenchProps {
  tabs: Tab[]
  visibleTabIds: Set<string>
  splitGroup: SplitGroup | null
  activeTabId: string | null
  isTerminalRoute: boolean
  onActivateTab: (tabId: string) => void
  onResizeSplit: (splitId: string, sizes: [number, number]) => void
  renderTerminal: (tabId: string) => ReactNode
}

function normalizeSizes(group: SplitGroup | null): [number, number] {
  const first = Math.max(20, Math.min(80, group?.sizes?.[0] ?? 50))
  return [first, 100 - first]
}

export function TerminalWorkbench({
  tabs,
  visibleTabIds,
  splitGroup,
  activeTabId,
  isTerminalRoute,
  onActivateTab,
  onResizeSplit,
  renderTerminal,
}: TerminalWorkbenchProps) {
  const splitTabIds = splitGroup?.tabs.slice(0, 2) ?? []
  const hasSplit = splitTabIds.length === 2
  const isHorizontalSplit = splitGroup?.mode === 'horizontal'
  const [sizes, setSizes] = useState<[number, number]>(() =>
    normalizeSizes(splitGroup),
  )
  const [mountedTabIds, setMountedTabIds] = useState(
    () => new Set(visibleTabIds),
  )

  useEffect(() => {
    setSizes(normalizeSizes(splitGroup))
  }, [splitGroup])

  useEffect(() => {
    setMountedTabIds(current => {
      const validIds = new Set(tabs.map(tab => tab.id))
      const next = new Set([...current].filter(tabId => validIds.has(tabId)))
      for (const tabId of visibleTabIds) next.add(tabId)
      if (
        next.size === current.size &&
        [...next].every(tabId => current.has(tabId))
      ) {
        return current
      }
      return next
    })
  }, [tabs, visibleTabIds])

  const handleResize = useCallback(
    (value: number, final: boolean) => {
      const nextSizes: [number, number] = [value, 100 - value]
      setSizes(nextSizes)
      if (final && splitGroup) onResizeSplit(splitGroup.id, nextSizes)
    },
    [onResizeSplit, splitGroup],
  )

  const splitStyle: CSSProperties = isHorizontalSplit
    ? {
        gridTemplateColumns: `calc(${sizes[0]}% - 2px) 4px calc(${sizes[1]}% - 2px)`,
      }
    : {
        gridTemplateRows: `calc(${sizes[0]}% - 2px) 4px calc(${sizes[1]}% - 2px)`,
      }

  return (
    <div
      className={cn(
        'absolute inset-0 z-0',
        isTerminalRoute
          ? 'visible pointer-events-auto'
          : 'invisible pointer-events-none',
      )}
      aria-hidden={!isTerminalRoute}
      data-terminal-workbench
    >
      <div
        className={cn(
          'relative h-full w-full',
          hasSplit &&
            (isHorizontalSplit ? 'grid grid-rows-1' : 'grid grid-cols-1'),
        )}
        style={hasSplit ? splitStyle : undefined}
      >
        {tabs.map(tab => {
          const splitIndex = splitTabIds.indexOf(tab.id)
          const isSplitTab = hasSplit && splitIndex >= 0
          const isVisible = visibleTabIds.has(tab.id)
          const isActive = activeTabId === tab.id
          const paneStyle: CSSProperties = isSplitTab
            ? isHorizontalSplit
              ? { gridColumn: splitIndex * 2 + 1 }
              : { gridRow: splitIndex * 2 + 1 }
            : {}

          return (
            <div
              key={tab.id}
              className={cn(
                'min-w-0 min-h-0 overflow-hidden',
                isSplitTab
                  ? 'relative'
                  : cn(
                      'absolute inset-0',
                      isVisible
                        ? 'visible pointer-events-auto'
                        : 'invisible pointer-events-none',
                    ),
                hasSplit && !isSplitTab && 'hidden',
                isVisible && isActive && 'ring-1 ring-inset ring-ring/50',
              )}
              style={paneStyle}
              aria-hidden={!isVisible}
              aria-label={tab.label}
              role="group"
              data-active={isActive}
              aria-current={isActive ? 'true' : undefined}
              onPointerDownCapture={() => onActivateTab(tab.id)}
              onClickCapture={() => onActivateTab(tab.id)}
              onFocusCapture={() => onActivateTab(tab.id)}
            >
              {mountedTabIds.has(tab.id) || isVisible
                ? renderTerminal(tab.id)
                : null}
            </div>
          )
        })}
        {hasSplit && splitGroup && (
          <TerminalSplitSash
            direction={splitGroup.mode}
            value={sizes[0]}
            onChange={handleResize}
            style={
              isHorizontalSplit
                ? { gridColumn: 2, gridRow: 1 }
                : { gridColumn: 1, gridRow: 2 }
            }
          />
        )}
      </div>
    </div>
  )
}
