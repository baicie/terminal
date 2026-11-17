// The AI dock: what the user must see before and after sending.
//
// The design's rules that are UI-visible: the destination is printed, the context is
// previewed and approved (not implied by selecting text), an empty answer is shown as
// empty, and a generated command carries its risk flags.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/locales'

const navigateMock = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }))
import { AiDock } from './ai-dock-view'
import { AiRunner, type AiRuntimeDeps } from '@/features/ai/ai-runner'
import type { ModelProfilePublic } from '@/features/ai/model-profile'
import type { AiBackendEvent } from '@/features/ai/ai-ipc'

function profile(overrides: Partial<ModelProfilePublic> = {}): ModelProfilePublic {
  return {
    id: 'p-1',
    name: 'Local',
    provider: 'local',
    endpoint: 'http://127.0.0.1:11434/v1',
    modelId: 'llama3',
    temperature: null,
    maxOutputTokens: 64,
    timeoutMs: 5_000,
    streaming: true,
    secretRef: null,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function backend(events: AiBackendEvent[]) {
  const calls: unknown[] = []
  return {
    calls,
    generate: async (
      input: unknown,
      onEvent: (event: AiBackendEvent) => void,
    ) => {
      calls.push(input)
      for (const event of events) onEvent(event)
      return { sent: true }
    },
    cancel: async () => true,
  }
}

function setup(options: {
  events?: AiBackendEvent[]
  profiles?: ModelProfilePublic[]
  selectedText?: string | null
  sessionId?: string | null
} = {}) {
  let counter = 0
  const ipc = backend(
    options.events ?? [{ type: 'chunk', text: 'It lists pods.' }, { type: 'done' }],
  )
  const deps: AiRuntimeDeps = {
    generate: ipc.generate,
    cancel: ipc.cancel,
    visibleSessionId: () => options.sessionId === undefined ? 'tab-1' : options.sessionId,
    onState: () => undefined,
    nextRunId: () => `run-${++counter}`,
  }
  const runner = new AiRunner(deps)
  const onClose = vi.fn()
  render(
    <AiDock
      runner={runner}
      profiles={options.profiles ?? [profile()]}
      selectedText={options.selectedText === undefined ? 'kubectl get pods' : options.selectedText}
      sessionId="tab-1"
      hostId="h-1"
      onClose={onClose}
    />,
  )
  return { runner, onClose }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('the destination is visible', () => {
  it('prints the provider, model and endpoint', () => {
    // A dock that says "AI" and sends to whatever is selected is the failure the
    // endpoint rules exist to prevent.
    setup()
    const endpoint = screen.getByTestId('ai-endpoint')
    expect(endpoint.textContent).toContain('local')
    expect(endpoint.textContent).toContain('llama3')
    expect(endpoint.textContent).toContain('http://127.0.0.1:11434/v1')
  })

  it('says what to do when no profile exists', () => {
    setup({ profiles: [] })
    expect(screen.getByText(/Add a model profile in Settings/i)).toBeTruthy()
  })

  it('reports an unusable profile rather than greying the button silently', () => {
    setup({ profiles: [profile({ enabled: false })] })
    expect(screen.getByTestId('ai-profile-issue')).toBeTruthy()
  })
})

describe('selecting text is not consent', () => {
  it('asks for approval with a preview before sending', () => {
    setup()
    expect(screen.getByTestId('ai-context-preview')).toBeTruthy()
    expect(screen.getByText('kubectl get pods')).toBeTruthy()
    // Nothing has been sent: the answer area does not exist yet.
    expect(screen.queryByTestId('ai-answer')).toBeNull()
  })

  it('says so when nothing is selected', () => {
    setup({ selectedText: null })
    expect(screen.getByTestId('ai-no-selection')).toBeTruthy()
    expect(screen.queryByTestId('ai-context-preview')).toBeNull()
  })

  it('sends only after the button is pressed, and then shows the answer', async () => {
    const { runner } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Send this text' }))
    await waitFor(() => expect(screen.getByTestId('ai-answer')).toBeTruthy())
    expect(screen.getByTestId('ai-answer').textContent).toBe('It lists pods.')
    expect(runner.current().status).toBe('completed')
  })

  it('shows the byte count of what will be sent', () => {
    setup()
    // 16 bytes for "kubectl get pods".
    expect(screen.getByText(/16 bytes/)).toBeTruthy()
  })
})

describe('results are framed honestly', () => {
  it('shows an empty answer as empty, not as a spinner', async () => {
    setup({ events: [{ type: 'done' }] })
    fireEvent.click(screen.getByRole('button', { name: 'Send this text' }))
    await waitFor(() => expect(screen.getByText(/returned an empty answer/i)).toBeTruthy())
  })

  it('marks a result from another session as stale', async () => {
    const { runner } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Send this text' }))
    await waitFor(() => expect(screen.getByTestId('ai-answer')).toBeTruthy())
    runner.sessionChanged('tab-2')
    await waitFor(() => expect(screen.getByTestId('ai-stale')).toBeTruthy())
  })

  it('shows a failure message rather than a bare status', async () => {
    setup({
      events: [
        {
          type: 'failed',
          failure: { kind: 'unauthorized', message: 'The API key was rejected.' },
        },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send this text' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/rejected/i))
  })

  it('always says nothing is run automatically', () => {
    setup()
    expect(screen.getByText(/Nothing is run automatically/i)).toBeTruthy()
  })
})

describe('draft commands carry their risk', () => {
  it('flags a destructive draft', async () => {
    setup({
      events: [{ type: 'chunk', text: 'sudo rm -rf /var/log' }, { type: 'done' }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Draft command' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send this text' }))
    await waitFor(() => expect(screen.getByTestId('ai-risk')).toBeTruthy())
    expect(screen.getByTestId('ai-risk').textContent).toMatch(/recursively|elevated/)
  })

  it('offers save-as-snippet only for a draft', async () => {
    setup({ events: [{ type: 'chunk', text: 'ls -la' }, { type: 'done' }] })
    // Explain selection: no save control.
    fireEvent.click(screen.getByRole('button', { name: 'Send this text' }))
    await waitFor(() => expect(screen.getByTestId('ai-answer')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Save as snippet' })).toBeNull()
  })
})

describe('closing', () => {
  it('calls the close handler', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('the first-run path has an entry point', () => {
  it('offers a way into Settings instead of only describing it', () => {
    // Telling the user "add a profile in Settings" without a control leaves them to
    // find the exact tab. The dock's first-run state is the only thing they see.
    setup({ profiles: [] })
    const button = screen.getByRole('button', { name: 'Open Settings' })
    fireEvent.click(button)
    expect(navigateMock).toHaveBeenCalledWith('/settings')
  })
})
