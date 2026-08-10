export function TerminalEmptyState() {
  return (
    <div className="h-full flex items-center justify-center bg-[#1e1e1e]">
      <div className="text-center max-w-sm">
        <p className="text-[#888] mb-2 text-sm font-medium">
          No active session
        </p>
        <p className="text-[#555] text-xs">
          Select a host from the sidebar or press{' '}
          <kbd className="px-1 py-0.5 bg-[#333] rounded text-[#aaa] font-mono text-[10px]">
            Ctrl+T
          </kbd>{' '}
          to open a local terminal.
        </p>
      </div>
    </div>
  )
}
