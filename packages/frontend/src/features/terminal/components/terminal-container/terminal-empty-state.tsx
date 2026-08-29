export function TerminalEmptyState() {
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="max-w-sm text-center">
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          No active session
        </p>
        <p className="text-xs text-muted-foreground">
          Select a host from the sidebar or press{' '}
          <kbd className="rounded bg-secondary px-1 py-0.5 font-mono text-[10px] text-secondary-foreground">
            Ctrl+T
          </kbd>{' '}
          to open a local terminal.
        </p>
      </div>
    </div>
  )
}
