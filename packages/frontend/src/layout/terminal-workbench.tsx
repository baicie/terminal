import type { SplitGroup, Tab } from '@/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface TerminalWorkbenchProps {
  tabs: Tab[]
  visibleTabIds: Set<string>
  splitGroup: SplitGroup | null
  isTerminalRoute: boolean
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
  isTerminalRoute,
  renderTerminal,
}: TerminalWorkbenchProps) {
  const splitTabIds = splitGroup?.tabs.slice(0, 2) ?? []
  const hasSplit = splitTabIds.length === 2
  const isHorizontalSplit = splitGroup?.mode === 'horizontal'
  const [sizes, setSizes] = useState<[number, number]>(() =>
    normalizeSizes(splitGroup),
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const startPositionRef = useRef(0)
  const startSizesRef = useRef<[number, number]>(sizes)

  useEffect(() => {
    setSizes(normalizeSizes(splitGroup))
  }, [splitGroup])

  const handleDividerMouseDown = useCallback(
    (event: MouseEvent) => {
      if (!hasSplit || !containerRef.current) return
      event.preventDefault()
      isDraggingRef.current = true
      startPositionRef.current = isHorizontalSplit
        ? event.clientX
        : event.clientY
      startSizesRef.current = sizes
      document.body.style.cursor = isHorizontalSplit
        ? 'col-resize'
        : 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [hasSplit, isHorizontalSplit, sizes],
  )

  useEffect(() => {
    const handleMouseMove = (event: globalThis.MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current || !hasSplit) return
      const bounds = containerRef.current.getBoundingClientRect()
      const total = isHorizontalSplit ? bounds.width : bounds.height
      const current = isHorizontalSplit ? event.clientX : event.clientY
      const delta =
        ((current - startPositionRef.current) / Math.max(total, 1)) * 100
      const first = Math.max(20, Math.min(80, startSizesRef.current[0] + delta))
      setSizes([first, 100 - first])
    }
    const stopDragging = () => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', stopDragging)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', stopDragging)
      stopDragging()
    }
  }, [hasSplit, isHorizontalSplit])

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
        ref={containerRef}
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
              )}
              style={paneStyle}
              aria-hidden={!isVisible}
            >
              {renderTerminal(tab.id)}
            </div>
          )
        })}
        {hasSplit && (
          <div
            className={cn(
              'z-10 bg-border transition-colors hover:bg-primary',
              isHorizontalSplit ? 'cursor-col-resize' : 'cursor-row-resize',
            )}
            style={
              isHorizontalSplit
                ? { gridColumn: 2, gridRow: 1 }
                : { gridColumn: 1, gridRow: 2 }
            }
            onMouseDown={handleDividerMouseDown}
            role="separator"
            aria-label="Resize terminal split"
          />
        )}
      </div>
    </div>
  )
}
