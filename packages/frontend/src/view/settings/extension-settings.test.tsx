// Turning a built-in extension on.
//
// Without this panel the snippet dock ships permanently off: implemented, tested and
// unreachable. The design's "nothing optional runs by default" makes the switch the
// only way it can ever appear.

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/locales'
import { ExtensionSettings } from './extension-settings'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
}))

vi.mock('@/features/extensions/use-extension-runtime', () => ({
  getExtensionRegistry: () => ({
    list: mocks.list,
    cleanupProblemsFor: () => (mocks as unknown as { cleanupProblems?: string[] }).cleanupProblems ?? [],
  }),
}))

function record(id: string, nameKey: string, status = 'registered') {
  return {
    manifest: {
      id,
      nameKey,
      version: '1.0.0',
      apiVersion: 1,
      entry: `built-in:${id}`,
      capabilities: ['commands.register'],
      platforms: ['macos'],
      defaultEnabled: false,
    },
    status,
    generation: 0,
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  mocks.list.mockReturnValue([record('snippet-dock', 'extensions.snippetDock.name')])
})

describe('extension settings', () => {
  it('lists every registered extension from the registry, not a literal', () => {
    // A hardcoded pair of switches is how a settings page silently stops covering
    // what ships.
    mocks.list.mockReturnValue([
      record('snippet-dock', 'extensions.snippetDock.name'),
      record('future-ext', 'extensions.futureExt.name'),
    ])
    render(<ExtensionSettings enabled={[]} onChange={vi.fn()} />)

    expect(screen.getByLabelText('Snippets')).toBeTruthy()
    // The second one has no translation in this test, so i18next returns the key.
    expect(screen.getByLabelText('extensions.futureExt.name')).toBeTruthy()
  })

  it('reports the extension as off when it is not enabled', () => {
    render(<ExtensionSettings enabled={[]} onChange={vi.fn()} />)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  })

  it('reports it as on when the saved list contains it', () => {
    render(<ExtensionSettings enabled={['snippet-dock']} onChange={vi.fn()} />)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })

  it('adds the id when switched on', () => {
    const onChange = vi.fn()
    render(<ExtensionSettings enabled={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(['snippet-dock'])
  })

  it('removes the id when switched off, leaving others in place', () => {
    const onChange = vi.fn()
    mocks.list.mockReturnValue([
      record('snippet-dock', 'extensions.snippetDock.name'),
      record('other', 'extensions.other.name'),
    ])
    render(<ExtensionSettings enabled={['snippet-dock', 'other']} onChange={onChange} />)

    fireEvent.click(screen.getAllByRole('switch')[0])
    expect(onChange).toHaveBeenCalledWith(['other'])
  })

  it('does not duplicate an id that is already enabled', () => {
    // A double toggle would otherwise write the same id twice, and a later
    // "is it in the list" check would still pass while the array grows.
    const onChange = vi.fn()
    render(<ExtensionSettings enabled={['snippet-dock']} onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('switch'))
    const last = onChange.mock.calls.at(-1)?.[0] as string[]
    expect(last.filter(id => id === 'snippet-dock')).toHaveLength(0)
  })

  it('says so when the build includes no extensions', () => {
    mocks.list.mockReturnValue([])
    render(<ExtensionSettings enabled={[]} onChange={vi.fn()} />)
    expect(screen.getByText(/no extensions/i)).toBeTruthy()
  })

  it('states that extensions are off by default', () => {
    render(<ExtensionSettings enabled={[]} onChange={vi.fn()} />)
    expect(screen.getByText(/off until you turn them on/i)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// A cleanup failure must be visible where the extension is.
//
// A deactivation that reports success while a disposer threw is a leak the user cannot
// otherwise see: the switch reads "off", the dock is gone, and a listener somewhere is
// still attached.
// ---------------------------------------------------------------------------

describe('cleanup problems surface next to the extension', () => {
  it('shows a message when the last settlement left cleanup failures', () => {
    const registryModule = mocks as unknown as { cleanupProblems: string[] }
    registryModule.cleanupProblems = ['dispose exploded']
    render(
      <ExtensionSettings enabled={[]} onChange={() => undefined} />,
    )
    expect(screen.getByRole('status').textContent).toMatch(/cleanup|nettoyage|清理/i)
    registryModule.cleanupProblems = []
  })

  it('shows nothing when the last settlement was clean', () => {
    render(<ExtensionSettings enabled={[]} onChange={() => undefined} />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
