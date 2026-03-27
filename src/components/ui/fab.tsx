import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FABProps {
  onClick: () => void
  title?: string
  className?: string
}

const FAB: React.FC<FABProps> = ({ onClick, title = 'Add', className }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={title}
      className={cn(
        'mobile-fab fixed right-4 z-[90]',
        'w-14 h-14 rounded-full',
        'bg-primary text-primary-foreground',
        'shadow-lg shadow-primary/25',
        'flex items-center justify-center',
        'active:scale-95 transition-transform duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      <Plus className="size-6" />
    </button>
  )
}

export default FAB
