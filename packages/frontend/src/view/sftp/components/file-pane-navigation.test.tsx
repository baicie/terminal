import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FilePaneNavigation } from './file-pane-navigation'

const baseProps = {
  filter: '',
  loading: false,
  onBack: vi.fn(),
  onFilterChange: vi.fn(),
  onForward: vi.fn(),
  onNavigate: vi.fn(),
  onRefresh: vi.fn(),
  pathHistoryIndex: 1,
  pathHistoryLength: 2,
  type: 'remote' as const,
}

afterEach(() => {
  vi.restoreAllMocks()
})

function crumbButtons(parts: string[]) {
  return Array.from(document.querySelectorAll('button')).filter(button =>
    parts.includes(button.textContent ?? ''),
  )
}

describe('FilePaneNavigation breadcrumb keys', () => {
  it('renders repeated path segments without duplicate-key warnings', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<FilePaneNavigation {...baseProps} currentPath="/srv/data/data" />)

    expect(screen.getByText('/srv/data/data'.split('/')[1])).toBeTruthy()
    expect(screen.getAllByText('data')).toHaveLength(2)
    expect(error).not.toHaveBeenCalled()
  })

  it('keeps the DOM nodes of the unchanged path prefix', () => {
    const { rerender } = render(
      <FilePaneNavigation {...baseProps} currentPath="/srv/data/one" />
    )

    const before = crumbButtons(['srv', 'data'])
    expect(before).toHaveLength(2)

    rerender(<FilePaneNavigation {...baseProps} currentPath="/srv/data/two" />)

    const after = crumbButtons(['srv', 'data'])
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
  })
})
