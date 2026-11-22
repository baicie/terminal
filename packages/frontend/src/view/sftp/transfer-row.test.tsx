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

/**
 * 传输完成之后的那一行，必须让用户分辨「字节写完了」和「两端一致」。
 *
 * 这些用例断言的是**具体结论**（`data-integrity` 的值 + 屏幕上那句话），不是
 * 「有一个图标」。两个原因：
 *
 * 1. 图标和颜色对读屏软件不存在，也容易被下一次样式重构成同一个样子；
 * 2. 本仓已经吃过「用一个值代表两种事实」的亏 —— `matches: undefined` 同时表示
 *    「还在算」与「一侧失败」。断言 `data-integrity="indeterminate"` 就要求产品
 *    真的把这两件事分开。
 */
describe('TransferRow integrity verdict', () => {
  const done = (checksum?: TransferRecord['checksum']) =>
    transferRecord({ status: 'done', bytesDone: 1000, checksum })

  it('says verified only when both sides hashed and agree', () => {
    render(
      <TransferRow
        record={done({
          algorithm: 'sha256',
          localStatus: 'done',
          remoteStatus: 'done',
          localHash: 'aa',
          remoteHash: 'aa',
        })}
      />,
    )

    const line = screen.getByTestId('transfer-integrity')
    expect(line.getAttribute('data-integrity')).toBe('verified')
    expect(line.textContent).toContain(i18n.t('sftp.verified'))
    // "Completed" alone is not the same claim, so both are on screen.
    expect(screen.getByText(i18n.t('sftp.transferDone'))).toBeTruthy()
  })

  it('says mismatch when both sides hashed and differ, and still shows the file as transferred', () => {
    render(
      <TransferRow
        record={done({
          algorithm: 'sha256',
          localStatus: 'done',
          remoteStatus: 'done',
          localHash: 'aa',
          remoteHash: 'bb',
        })}
      />,
    )

    const line = screen.getByTestId('transfer-integrity')
    expect(line.getAttribute('data-integrity')).toBe('mismatch')
    expect(line.textContent).toContain(i18n.t('sftp.mismatch'))
    // Reported as an alert so it is announced, not only coloured.
    expect(line.getAttribute('role')).toBe('alert')
    // The transfer itself still completed: nothing was deleted or undone.
    expect(screen.getByText(i18n.t('sftp.transferDone'))).toBeTruthy()
  })

  it('never calls a one-sided failure a mismatch', () => {
    for (const side of ['local', 'remote'] as const) {
      const { unmount } = render(
        <TransferRow
          record={done({
            algorithm: 'sha256',
            localStatus: side === 'local' ? 'error' : 'done',
            remoteStatus: side === 'remote' ? 'error' : 'done',
            localHash: side === 'local' ? undefined : 'aa',
            remoteHash: side === 'remote' ? undefined : 'aa',
            localError: side === 'local' ? 'ENOENT' : undefined,
            remoteError: side === 'remote' ? 'permission denied' : undefined,
          })}
        />,
      )
      const line = screen.getByTestId('transfer-integrity')
      expect(line.getAttribute('data-integrity')).toBe('indeterminate')
      expect(line.textContent).not.toContain(i18n.t('sftp.mismatch'))
      // Which side failed is named, so the user knows what to fix.
      expect(line.textContent).toContain(
        i18n.t(side === 'local' ? 'sftp.checksumSide.local' : 'sftp.checksumSide.remote'),
      )
      unmount()
    }
  })

  it('shows progress while hashing without touching the finished byte count', () => {
    render(
      <TransferRow
        record={done({
          algorithm: 'sha256',
          localStatus: 'done',
          remoteStatus: 'computing',
          localHash: 'aa',
          bytesDone: 200,
          bytesTotal: 1000,
        })}
      />,
    )

    const line = screen.getByTestId('transfer-integrity')
    expect(line.getAttribute('data-integrity')).toBe('computing')
    expect(line.textContent).toContain('20%')
    // The transfer's own figures are what is printed above it.
    expect(screen.getByText('1000 B / 1000 B')).toBeTruthy()
  })

  it('says not verified when the transfer completed without a check', () => {
    render(<TransferRow record={done(undefined)} />)

    const line = screen.getByTestId('transfer-integrity')
    expect(line.getAttribute('data-integrity')).toBe('unchecked')
    expect(line.textContent).toContain(i18n.t('sftp.unverified'))
  })

  it('shows no integrity line for a transfer that failed', () => {
    render(
      <TransferRow
        record={transferRecord({ status: 'error', message: 'connection reset' })}
      />,
    )
    expect(screen.queryByTestId('transfer-integrity')).toBeNull()
  })
})
