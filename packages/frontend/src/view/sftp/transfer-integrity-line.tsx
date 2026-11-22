/**
 * 完整性结论的渲染。
 *
 * 「传输完成」和「两端一致」是两件不同的事，而且都不是纯颜色能表达的事实：
 * 读屏软件看不到颜色，灰掉的图标与成功的图标在没有文本时是同一个东西。所以每一
 * 种结论都有一句自己的话，并且带 `data-integrity` 供测试断言**具体是哪一种**，
 * 而不是断言「有个图标」。
 */
import { AlertCircle, Clock, ShieldCheck, ShieldX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TransferRecord } from '@/store/transfer-queue'
import {
  checksumPercent,
  checksumVerdict,
} from '@/store/transfer-checksum-verdict'

/**
 * 完整性结论。
 *
 * 「已完成」与「已验证一致」是两件事，这里让它们各自可见：
 *
 * - `verified`：两端 SHA-256 相等，说得出口的结论；
 * - `mismatch`：两端都算出来了但不相等 —— **不删文件、不自动修复**，只报告；
 * - `indeterminate`：某一侧算不出来（远端权限、连接断开）。这**不是**「不一致」，
 *   把它显示成不一致等于把服务器错误说成文件损坏；
 * - `computing`：还在算；
 * - `unchecked`：没有尝试过（例如传输本身失败）。
 *
 * 每一行都有文本而不只有图标 —— 一个颜色不足以让用户分辨「已校验」与「未校验」，
 * 也对读屏软件不可见。
 */
export const IntegrityLine: React.FC<{ record: TransferRecord }> = ({
  record,
}) => {
  const { t } = useTranslation()
  const { verdict, failedSide } = checksumVerdict(record)

  if (verdict === 'unchecked') {
    // A failed or cancelled transfer: nothing was attempted, nothing to claim.
    if (record.status !== 'done') return null
    return (
      <div
        className="flex items-center gap-1 text-[10px] text-muted-foreground"
        data-testid="transfer-integrity"
        data-integrity="unchecked"
        aria-label={t('sftp.unverified')}
      >
        <ShieldX className="size-3" aria-hidden="true" />
        <span>{t('sftp.unverified')}</span>
      </div>
    )
  }

  if (verdict === 'computing') {
    const percent = checksumPercent(record)
    return (
      <div
        className="flex items-center gap-1 text-[10px] text-muted-foreground"
        data-testid="transfer-integrity"
        data-integrity="computing"
        aria-label={t('sftp.verifying')}
      >
        <Clock className="size-3" aria-hidden="true" />
        <span>
          {percent > 0
            ? t('sftp.verifyingProgress', { percent })
            : t('sftp.verifying')}
        </span>
      </div>
    )
  }

  if (verdict === 'verified') {
    return (
      <div
        className="flex items-center gap-1 text-[10px] text-success"
        data-testid="transfer-integrity"
        data-integrity="verified"
        aria-label={t('sftp.verified')}
      >
        <ShieldCheck className="size-3" aria-hidden="true" />
        <span>{t('sftp.verified')}</span>
      </div>
    )
  }

  if (verdict === 'mismatch') {
    return (
      <div
        className="flex items-center gap-1 text-[10px] text-destructive"
        data-testid="transfer-integrity"
        data-integrity="mismatch"
        role="alert"
      >
        <ShieldX className="size-3" aria-hidden="true" />
        <span>{t('sftp.mismatch')}</span>
      </div>
    )
  }

  // indeterminate: the check could not run. Never worded as a mismatch.
  const sideLabel = failedSide
    ? t(failedSide === 'local' ? 'sftp.checksumSide.local' : 'sftp.checksumSide.remote')
    : null
  return (
    <div
      className="flex items-center gap-1 text-[10px] text-muted-foreground"
      data-testid="transfer-integrity"
      data-integrity="indeterminate"
      title={checksumVerdict(record).error ?? undefined}
    >
      <AlertCircle className="size-3" aria-hidden="true" />
      <span>
        {sideLabel
          ? t('sftp.verificationFailedSide', { side: sideLabel })
          : t('sftp.verificationFailed')}
      </span>
    </div>
  )
}
