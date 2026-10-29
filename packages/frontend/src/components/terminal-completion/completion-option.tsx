import type { Ref } from 'react'
import {
  CheckIcon,
  ClockIcon,
  CodeIcon,
  FolderIcon,
  HashIcon,
  TerminalIcon,
} from 'lucide-react'
import type {
  CompletionItem,
  CompletionType,
} from '@/hooks/use-command-completion'
import { cn } from '@/lib/utils'

const TYPE_ICONS: Record<
  CompletionType,
  React.ComponentType<{ className?: string }>
> = {
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

interface CompletionOptionProps {
  item: CompletionItem
  index: number
  isSelected: boolean
  selectedRef?: Ref<HTMLButtonElement>
  onSelect: (item: CompletionItem, index: number) => void
}

export function CompletionOption({
  item,
  index,
  isSelected,
  selectedRef,
  onSelect,
}: CompletionOptionProps) {
  const Icon = TYPE_ICONS[item.type] ?? TerminalIcon

  return (
    <button
      ref={selectedRef}
      className={cn(
        'w-full px-3 py-1.5 text-left text-sm font-mono transition-colors',
        'flex items-center gap-2 truncate',
        isSelected
          ? 'bg-[#094771] text-white'
          : 'text-[#cccccc] hover:bg-[#2a2d2e]',
      )}
      onClick={() => onSelect(item, index)}
      role="option"
      aria-selected={isSelected}
    >
      <span
        className={cn(
          'flex-shrink-0 w-4 h-4 flex items-center justify-center',
          isSelected ? 'text-[#4ec9b0]' : 'text-transparent',
        )}
      >
        <CheckIcon className="w-3 h-3" />
      </span>
      <Icon
        className={cn(
          'flex-shrink-0 w-3.5 h-3.5',
          isSelected ? 'text-white/60' : TYPE_COLORS[item.type],
        )}
      />
      <span className="flex-1 truncate">{item.label}</span>
      <span
        className={cn(
          'flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded',
          isSelected ? 'bg-white/10 text-white/50' : 'bg-[#333] text-[#555]',
        )}
      >
        {item.type}
      </span>
    </button>
  )
}
