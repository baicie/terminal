/**
 * TerminalCompletionOverlay Component
 *
 * A floating dropdown overlay that displays command completion suggestions.
 * Positioned below the terminal cursor with keyboard navigation support.
 * Supports multiple completion types: history, subcommand, path, snippet.
 */

import { useEffect, useRef } from 'react'
import { CheckIcon, FolderIcon, TerminalIcon, ClockIcon, HashIcon, CodeIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CompletionItem, CompletionType } from '@/hooks/use-command-completion'

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

const TYPE_ICONS: Record<CompletionType, React.ComponentType<{ className?: string }>> = {
  history: ClockIcon,
  subcommand: TerminalIcon,
  path: FolderIcon,
  snippet: TerminalIcon,
  alias: HashIcon,
  function: CodeIcon,
}

const TYPE_COLORS: Record<CompletionType, string> = {
  history: 'text-blue-400',
  subcommand: 'text-green-400',
  path: 'text-yellow-400',
  snippet: 'text-purple-400',
  alias: 'text-cyan-400',
  function: 'text-orange-400',
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
        {items.map((item, index) => {
          const Icon = TYPE_ICONS[item.type] ?? TerminalIcon
          return (
            <button
              key={`${item.text}-${index}`}
              ref={index === currentIndex ? selectedItemRef : undefined}
              className={cn(
                'w-full px-3 py-1.5 text-left text-sm font-mono transition-colors',
                'flex items-center gap-2 truncate',
                index === currentIndex
                  ? 'bg-[#094771] text-white'
                  : 'text-[#cccccc] hover:bg-[#2a2d2e]',
              )}
              onClick={() => onSelect(item, index)}
              role="option"
              aria-selected={index === currentIndex}
            >
              {/* Selection indicator */}
              <span
                className={cn(
                  'flex-shrink-0 w-4 h-4 flex items-center justify-center',
                  index === currentIndex ? 'text-[#4ec9b0]' : 'text-transparent',
                )}
              >
                <CheckIcon className="w-3 h-3" />
              </span>

              {/* Type icon */}
              <Icon className={cn('flex-shrink-0 w-3.5 h-3.5', index === currentIndex ? 'text-white/60' : TYPE_COLORS[item.type])} />

              {/* Label */}
              <span className="flex-1 truncate">{item.label}</span>

              {/* Type badge */}
              <span className={cn(
                'flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded',
                index === currentIndex ? 'bg-white/10 text-white/50' : 'bg-[#333] text-[#555]',
              )}>
                {item.type}
              </span>
            </button>
          )
        })}
      </div>

      {/* Footer with hints */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-[#333] bg-[#252526]">
        <span className="text-[9px] text-[#555]">
          <kbd className="px-1 py-0.5 bg-[#333] rounded text-[#888] font-mono">Tab</kbd>{' '}
          next
        </span>
        <span className="text-[9px] text-[#555]">
          <kbd className="px-1 py-0.5 bg-[#333] rounded text-[#888] font-mono">Esc</kbd>{' '}
          dismiss
        </span>
      </div>
    </div>
  )
}

export default TerminalCompletionOverlay
