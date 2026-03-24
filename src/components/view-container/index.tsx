import { cn } from '@/lib/utils'

// Main ViewContainer component
interface ViewContainerProps {
  children: React.ReactNode
  className?: string
}

const ViewContainer: React.FC<ViewContainerProps> & {
  Toolbar: typeof ViewToolbar
  Content: typeof ViewContent
  Header: typeof ViewHeader
  EmptyState: typeof EmptyState
} = ({ children, className }) => {
  return (
    <div className={cn('h-full flex flex-col bg-background', className)}>
      {children}
    </div>
  )
}

// Toolbar subcomponent
interface ViewToolbarProps {
  children: React.ReactNode
  className?: string
}

const ViewToolbar: React.FC<ViewToolbarProps> = ({ children, className }) => {
  return (
    <div
      className={cn(
        'flex items-center justify-between px-4 py-3 border-b border-border/60',
        className,
      )}
    >
      {children}
    </div>
  )
}

// Content subcomponent
interface ViewContentProps {
  children: React.ReactNode
  className?: string
}

const ViewContent: React.FC<ViewContentProps> = ({ children, className }) => {
  return <div className={cn('flex-1 overflow-auto', className)}>{children}</div>
}

// Header subcomponent
interface ViewHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}

const ViewHeader: React.FC<ViewHeaderProps> = ({
  title,
  description,
  actions,
  className,
}) => {
  return (
    <div className={cn('flex items-center justify-between mb-4', className)}>
      <div>
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

// EmptyState subcomponent
interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className,
}) => {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center h-full py-12 px-6 text-center',
        className,
      )}
    >
      {icon && <div className="mb-4 text-muted-foreground/50">{icon}</div>}
      <h3 className="text-base font-medium text-foreground mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mb-4">
          {description}
        </p>
      )}
      {action}
    </div>
  )
}

// Attach subcomponents
ViewContainer.Toolbar = ViewToolbar
ViewContainer.Content = ViewContent
ViewContainer.Header = ViewHeader
ViewContainer.EmptyState = EmptyState

export { ViewContainer, ViewToolbar, ViewContent, ViewHeader, EmptyState }
export default ViewContainer
