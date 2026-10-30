import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateFailureStatus } from '@/service/updates'

const mocks = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
  readCurrentVersion: vi.fn(),
}))

vi.mock('@/service/updates', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    checkForUpdates: (...args: unknown[]) => mocks.checkForUpdates(...args),
    readCurrentVersion: (...args: unknown[]) =>
      mocks.readCurrentVersion(...args),
  }
})

import { UpdateCheck } from './update-check'

const RELEASE_PAGE = 'https://github.com/baicie/terminal/releases'

const FAILURE_COPY: [UpdateFailureStatus, string][] = [
  ['offline', 'This device is offline.'],
  ['timeout', 'The release server did not answer in time.'],
  ['unreachable', 'The release server is unreachable.'],
  ['unconfigured', 'Update checks are not configured in this build.'],
  ['signature', 'The update failed signature verification and was rejected.'],
]

beforeEach(() => {
  mocks.checkForUpdates.mockReset()
  mocks.readCurrentVersion.mockReset()
  mocks.readCurrentVersion.mockResolvedValue('0.0.1-dev.2')
})

afterEach(() => {
  cleanup()
})

async function runCheck() {
  render(<UpdateCheck />)
  // Settle the mount-time version read, then flush the check inside act() so
  // the asynchronous state updates are not reported as violations.
  await screen.findByText('0.0.1-dev.2')
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
  })
}

describe('UpdateCheck current version', () => {
  it('shows the version the runtime reports', async () => {
    render(<UpdateCheck />)

    expect(await screen.findByText('0.0.1-dev.2')).toBeTruthy()
    expect(screen.queryByText('this build')).toBeNull()
  })

  it('says so when the runtime cannot report a version', async () => {
    mocks.readCurrentVersion.mockResolvedValue(null)

    render(<UpdateCheck />)

    expect(
      await screen.findByText('not reported by this runtime'),
    ).toBeTruthy()
  })
})

describe('UpdateCheck failure copy', () => {
  it('gives every failure class its own copy', async () => {
    const titles = new Set<string>()

    for (const [kind, title] of FAILURE_COPY) {
      mocks.checkForUpdates.mockResolvedValue({
        status: kind,
        detail: `detail-${kind}`,
      })
      const view = render(<UpdateCheck />)
      await screen.findByText('0.0.1-dev.2')
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Check for updates' }),
        )
      })

      expect(await screen.findByText(title)).toBeTruthy()
      expect(screen.getByText(`detail-${kind}`)).toBeTruthy()
      titles.add(title)
      view.unmount()
    }

    expect(titles.size).toBe(FAILURE_COPY.length)
  })

  it('keeps a generic failure visible instead of collapsing it', async () => {
    mocks.checkForUpdates.mockResolvedValue({
      status: 'error',
      detail: 'plugin not registered',
    })

    await runCheck()

    expect(await screen.findByText('The update check failed.')).toBeTruthy()
    expect(screen.getByText('plugin not registered')).toBeTruthy()
  })
})

describe('UpdateCheck success states', () => {
  it('reports the checked version when it is up to date', async () => {
    mocks.checkForUpdates.mockResolvedValue({
      status: 'up-to-date',
      version: '0.0.1-dev.2',
    })

    await runCheck()

    expect(
      await screen.findByText('You are on the latest version (0.0.1-dev.2).'),
    ).toBeTruthy()
  })

  it('still says so when up to date without a readable version', async () => {
    mocks.checkForUpdates.mockResolvedValue({
      status: 'up-to-date',
      version: null,
    })

    await runCheck()

    expect(
      await screen.findByText('You are on the latest version.'),
    ).toBeTruthy()
  })

  it('says update checks need the desktop app', async () => {
    mocks.checkForUpdates.mockResolvedValue({ status: 'unsupported' })

    await runCheck()

    expect(
      await screen.findByText('Update checks need the desktop app.'),
    ).toBeTruthy()
  })
})

describe('UpdateCheck install boundary', () => {
  it('keeps installing blocked and points at the release page', async () => {
    mocks.checkForUpdates.mockResolvedValue({
      status: 'available',
      version: '0.0.2',
      notes: 'Fixes a crash',
    })

    await runCheck()

    expect(await screen.findByText('Version 0.0.2 is available.')).toBeTruthy()
    expect(screen.getByText('Fixes a crash')).toBeTruthy()
    expect(screen.getByText(RELEASE_PAGE)).toBeTruthy()
    expect(
      screen.getByText(/Installing from this screen stays blocked on purpose/),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /install/i })).toBeNull()
  })
})
