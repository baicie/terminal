import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import i18n from '@/locales'
import type { TransferRecord } from '@/store/transfer-queue'
import TransferRow from './transfer-row'

vi.mock('@/service/sftp-transfer', () => ({
  cancelTransfer: vi.fn(),
  removeTransfer: vi.fn(),
}))

function transferRecord(
  overrides: Partial<TransferRecord> = {},
): TransferRecord {
  return {
    id: 'transfer-1',
    kind: 'upload',
    name: 'report.pdf',
    localPath: '/tmp/report.pdf',
    remotePath: '/home/me/report.pdf',
    sessionId: 'session-1',
    status: 'queued',
    bytesDone: 0,
    bytesTotal: 1000,
    speed: 0,
    startedAt: 0,
    ...overrides,
  }
}

describe('TransferRow states', () => {
  it('marks a queued transfer as queued and offers only a queue cancel', () => {
    render(<TransferRow record={transferRecord()} />)

    expect(screen.getByText(i18n.t('sftp.transferQueued'))).toBeTruthy()
    const cancel = screen.getByTestId('transfer-cancel-queued')
    expect(cancel.hasAttribute('disabled')).toBe(false)
    expect(cancel.getAttribute('aria-label')).toBe(
      i18n.t('sftp.transferCancelQueued'),
    )
    expect(screen.queryByTestId('transfer-remove')).toBeNull()
    expect(screen.queryByTestId('transfer-cancel-hint')).toBeNull()
  })

  it('names a running transfer and keeps its cancel disabled with a reason', () => {
    render(
      <TransferRow
        record={transferRecord({ status: 'running', bytesDone: 400, speed: 512 })}
      />,
    )

    expect(screen.getByTestId('transfer-status-running').textContent).toContain(
      i18n.t('sftp.transferRunning'),
    )
    const blocked = screen.getByTestId('transfer-cancel-blocked')
    expect(blocked.hasAttribute('disabled')).toBe(true)
    expect(blocked.getAttribute('aria-label')).toBe(
      i18n.t('sftp.transferCancelUnsupported'),
    )
    expect(screen.getByTestId('transfer-cancel-hint').textContent).toBe(
      i18n.t('sftp.transferCancelBlocked'),
    )
    expect(screen.queryByTestId('transfer-remove')).toBeNull()
  })

  it('offers removal only once a transfer reached a terminal state', () => {
    const { unmount } = render(
      <TransferRow record={transferRecord({ status: 'done', bytesDone: 1000 })} />,
    )
    expect(screen.getByText(i18n.t('sftp.transferDone'))).toBeTruthy()
    const removeDone = screen.getByTestId('transfer-remove')
    expect(removeDone.hasAttribute('disabled')).toBe(false)
    expect(screen.queryByTestId('transfer-cancel-blocked')).toBeNull()
    expect(screen.queryByTestId('transfer-cancel-queued')).toBeNull()
    unmount()

    render(
      <TransferRow
        record={transferRecord({ status: 'cancelled', message: 'stopped' })}
      />,
    )
    expect(screen.getByText(i18n.t('sftp.transferCancelled'))).toBeTruthy()
    expect(screen.getByTestId('transfer-remove')).toBeTruthy()
  })

  it('surfaces the failure message and still allows removal', () => {
    render(
      <TransferRow
        record={transferRecord({ status: 'error', message: 'permission denied' })}
      />,
    )

    expect(screen.getByText('permission denied')).toBeTruthy()
    expect(screen.getByTestId('transfer-remove')).toBeTruthy()
    expect(screen.queryByTestId('transfer-status-running')).toBeNull()
  })
})
