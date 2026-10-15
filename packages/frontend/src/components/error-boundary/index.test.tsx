import { I18nextProvider } from 'react-i18next'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  createMemoryRouter,
  MemoryRouter,
  RouterProvider,
} from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import locales from '@/locales'
import ErrorBoundary, { RouteErrorBoundary } from '.'

function ThrowingView(): never {
  throw new Error('route render failed')
}

describe('application error boundaries', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('captures child render failures without throwing from the boundary itself', async () => {
    render(
      <I18nextProvider i18n={locales}>
        <MemoryRouter>
          <ErrorBoundary>
            <ThrowingView />
          </ErrorBoundary>
        </MemoryRouter>
      </I18nextProvider>,
    )

    expect(
      await screen.findByRole('heading', { name: 'Failed to load page' }),
    ).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain(
      'route render failed',
    )
  })

  it('reads router errors and exposes working retry and home actions', async () => {
    const retry = vi.fn()
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ThrowingView />,
          errorElement: <RouteErrorBoundary onRetry={retry} />,
        },
        { path: '/hosts', element: <div>Hosts recovered</div> },
      ],
      { initialEntries: ['/'] },
    )

    render(
      <I18nextProvider i18n={locales}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    )

    expect((await screen.findByRole('alert')).textContent).toContain(
      'route render failed',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: /go home/i }))
    expect(await screen.findByText('Hosts recovered')).toBeTruthy()
  })
})
