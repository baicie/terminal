import { createElement, type ComponentType } from 'react'
import { Button } from '@/components/ui/button'
import type { RenderRoot } from './terminal-bootstrap-types'

type StartupErrorModule = {
  StartupError: ComponentType<{ error: string; onRetry: () => void }>
}

type StartupErrorLoader = () => Promise<StartupErrorModule>

const loadStartupError: StartupErrorLoader = () =>
  import('@/components/startup-error')

/**
 * Renders the startup failure screen.
 *
 * The screen itself is imported lazily because it pulls in the i18next runtime
 * and every locale bundle. Importing it eagerly would put roughly 63 KB gzip
 * on the critical path to the first terminal, for a screen that only renders
 * once startup has already failed. The delay that buys is acceptable precisely
 * because the app is broken at that point.
 *
 * If even that lazy import fails, the message is rendered as plain text: the
 * one outcome that must never happen is a blank window with no explanation.
 */
export function renderStartupFailure(
  root: RenderRoot,
  error: unknown,
  onRetry: () => void,
  isDisposed: () => boolean,
  loadErrorScreen: StartupErrorLoader = loadStartupError,
): void {
  const message = error instanceof Error ? error.message : String(error)
  const renderFallback = () => {
    if (isDisposed()) return
    root.render(
      createElement(
        'main',
        { role: 'alert', 'aria-live': 'assertive' },
        createElement('pre', null, message),
        createElement(
          Button,
          { type: 'button', onClick: onRetry },
          'Retry startup',
        ),
      ),
    )
  }

  // Keep the window informative while the localized error chunk loads. This
  // also gives the user a retry action if the chunk itself is unavailable.
  renderFallback()
  void loadErrorScreen()
    .then(({ StartupError }) => {
      // A superseded bootstrap attempt must not overwrite the current UI.
      if (isDisposed()) return
      root.render(createElement(StartupError, { error: message, onRetry }))
    })
    .catch(reportError => {
      console.error('Failed to load the startup error screen:', reportError)
      renderFallback()
    })
}
