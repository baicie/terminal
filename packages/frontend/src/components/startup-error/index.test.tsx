import { render, screen } from '@testing-library/react'
import i18n from '@/locales'
import { afterEach, describe, expect, it } from 'vitest'

import { StartupError } from './index'

async function renderStartupError() {
  render(<StartupError error="database is locked" onRetry={() => {}} />)
  return screen.findByRole('alert')
}

describe('StartupError', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders the failure, its cause hint and a retry action in English', async () => {
    await i18n.changeLanguage('en')
    const alert = await renderStartupError()

    expect(alert.textContent).toContain('Terminal could not start')
    expect(alert.textContent).toContain('database is locked')
    expect(
      screen.getByRole('button', { name: 'Retry startup' }),
    ).toBeTruthy()
    expect(document.body.textContent).toContain('local database')
  })

  it('translates the whole screen without the application chunk mounted', async () => {
    await i18n.changeLanguage('cn')
    const alert = await renderStartupError()

    expect(alert.textContent).toContain('终端无法启动')
    expect(alert.textContent).toContain('启动详情')
    expect(
      screen.getByRole('button', { name: '重试启动' }),
    ).toBeTruthy()
    expect(document.body.textContent).toContain('本地数据库')
  })

  it('translates the whole screen into French', async () => {
    await i18n.changeLanguage('fr')
    const alert = await renderStartupError()

    expect(alert.textContent).toContain("n'a pas pu démarrer")
    expect(
      screen.getByRole('button', { name: 'Réessayer le démarrage' }),
    ).toBeTruthy()
  })
})
