/**
 * TerminalCompletionOverlay Component
 *
 * A floating dropdown overlay that displays command completion suggestions.
 * Positioned below the terminal cursor with keyboard navigation support.
 * Supports multiple completion types: history, subcommand, path, snippet.
 */

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { CompletionItem } from '@/hooks/use-command-completion'
import { CompletionOption } from './completion-option'

export interface CursorPosition {
  x: number
  y: number
}

export interface TerminalCompletionOverlayProps {
  /** Completion items to display */
  items: CompletionItem[]
  /** Currently selected index */
  currentIndex: number
  /** Callback when an item is selected */
  onSelect: (item: CompletionItem, index: number) => void
  /** Callback when overlay should be dismissed */
  onDismiss: () => void
  /** Overlay position (screen coordinates) */
  position: CursorPosition
  /** Maximum height of the overlay */
  maxHeight?: number
  /** Additional CSS classes */
  className?: string
}

export function TerminalCompletionOverlay({
  items,
  currentIndex,
  onSelect,
  onDismiss,
  position,
  maxHeight = 240,
  className,
}: TerminalCompletionOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedItemRef = useRef<HTMLButtonElement>(null)

  // Scroll selected item into view
  useEffect(() => {
    if (selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      })
    }
  }, [currentIndex])

  // Handle keyboard events on the overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          if (currentIndex < items.length - 1) {
            onSelect(items[currentIndex + 1], currentIndex + 1)
          }
          break
        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          if (currentIndex > 0) {
            onSelect(items[currentIndex - 1], currentIndex - 1)
          }
          break
        case 'Enter':
          e.preventDefault()
          e.stopPropagation()
          if (items[currentIndex]) {
            onSelect(items[currentIndex], currentIndex)
          }
          break
        case 'Tab':
          e.preventDefault()
          e.stopPropagation()
          const nextIndex = e.shiftKey
            ? (currentIndex - 1 + items.length) % items.length
            : (currentIndex + 1) % items.length
          onSelect(items[nextIndex], nextIndex)
          break
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          onDismiss()
          break
      }
    }

    const container = containerRef.current
    if (container) {
      container.addEventListener('keydown', handleKeyDown as EventListener)
      return () => {
        container.removeEventListener('keydown', handleKeyDown as EventListener)
      }
    }
  }, [items, currentIndex, onSelect, onDismiss])

  if (items.length === 0) return null

  return (
    <div
      ref={containerRef}
      className={cn(
        'fixed z-50 overflow-hidden rounded-md border bg-[#1e1e1e]/95 backdrop-blur-sm shadow-lg',
        'min-w-[240px] max-w-[420px]',
        className,
      )}
      style={{
        left: position.x,
        top: position.y,
        maxHeight: `${maxHeight}px`,
      }}
      role="listbox"
      aria-label="Command completions"
      tabIndex={-1}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#333] bg-[#252526]">
        <span className="text-[10px] font-medium text-[#888] uppercase tracking-wide">
          Completions
        </span>
        <span className="text-[10px] text-[#666]">
          {items.length} {items.length === 1 ? 'match' : 'matches'}
        </span>
      </div>

      {/* Items list */}
      <div
        className="overflow-y-auto py-1 scrollbar-thin scrollbar-thumb-[#444] scrollbar-track-transparent"
        style={{ maxHeight: `${maxHeight - 36}px` }}
      >
        {items.map((item, index) => (
          <CompletionOption
            key={`${item.text}-${index}`}
            item={item}
            index={index}
            isSelected={index === currentIndex}
            selectedRef={index === currentIndex ? selectedItemRef : undefined}
            onSelect={onSelect}
          />
        ))}
      </div>

      {/* Footer with hints */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-[#333] bg-[#252526]">
        <span className="text-[9px] text-[#555]">
          <kbd className="px-1 py-0.5 bg-[#333] rounded text-[#888] font-mono">
            Tab
          </kbd>{' '}
          next
        </span>
        <span className="text-[9px] text-[#555]">
          <kbd className="px-1 py-0.5 bg-[#333] rounded text-[#888] font-mono">
            Esc
          </kbd>{' '}
          dismiss
        </span>
      </div>
    </div>
  )
}

export default TerminalCompletionOverlay
