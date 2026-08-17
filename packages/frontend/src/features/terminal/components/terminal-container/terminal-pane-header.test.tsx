import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Host, Tab } from '@/types'
import { TerminalPaneHeader } from './terminal-pane-header'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.retry': 'Retry',
        'terminal.clear': 'Clear',
        'terminal.search': 'Find',
        'terminal.showTools': 'Show tools',
        'terminal.fullscreen': 'Fullscreen',
        'terminal.status.connected': 'Connected',
        'toolbar.more': 'More',
      })[key] ?? key,
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn() },
}))

const tab: Tab = {
  id: 'terminal-one',
  label: 'Production',
  type: 'remote',
  hostId: 'host-one',
}

const host: Host = {
  id: 'host-one',
  name: 'Production',
  hostname: 'prod.example.com',
  port: 22,
  username: 'deploy',
  authType: 'agent',
  isFavorite: false,
  portForwards: [],
  createdAt: 1,
  updatedAt: 1,
}

function createProps(overrides: Record<string, unknown> = {}) {
  return {
    tab,
    host,
    status: 'connected' as const,
    fontSize: 14,
    isMobile: false,
    toolsOpen: false,
    fullscreen: false,
    onSearch: vi.fn(),
    onClear: vi.fn(),
    onToggleTools: vi.fn(),
    onFontSizeChange: vi.fn(),
    onResetFontSize: vi.fn(),
    onToggleFullscreen: vi.fn(),
    onRequestFocus: vi.fn(),
    ...overrides,
  }
}

function renderHeader(props = createProps()) {
  return render(
    <TooltipProvider>
      <TerminalPaneHeader {...props} />
    </TooltipProvider>,
  )
}

describe('TerminalPaneHeader', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('restores terminal focus after a direct pane action', () => {
    const props = createProps()
    renderHeader(props)

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(props.onClear).toHaveBeenCalledOnce()
    expect(props.onRequestFocus).toHaveBeenCalledOnce()
  })

  it('leaves focus with the search surface when opening find', () => {
    const props = createProps()
    renderHeader(props)

    fireEvent.click(screen.getByRole('button', { name: 'Find' }))

    expect(props.onSearch).toHaveBeenCalledOnce()
    expect(props.onRequestFocus).not.toHaveBeenCalled()
  })

  it('uses a touch-sized mobile menu trigger', () => {
    renderHeader(createProps({ isMobile: true }))

    const trigger = screen.getByRole('button', { name: 'More' })
    expect(trigger.className).toContain('size-11')
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })
})
