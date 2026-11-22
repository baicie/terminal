/**
 * 完整性结论的渲染。
 *
 * 「传输完成」和「两端一致」是两件不同的事，而且都不是纯颜色能表达的事实：读屏
 * 软件看不到颜色，灰掉的图标与成功的图标在没有文本时是同一个东西。所以每一种结论
 * 都有一句自己的话，并且带 `data-integrity` 供测试断言**具体是哪一种**。
 *
 * ## 为什么是一张表而不是五个分支
 *
 * 五个 `if` 各自写一遍同一段 JSX（同样的 class、同样的 `data-testid`），既容易
 * 在某一个分支里漏掉属性，也会把同一段结构重复五次进包里。表驱动只描述**每种结论
 * 的差异**（文案、颜色、图标），结构只写一次。
 *
 * 五种结论的语义见 `store/transfer-checksum-verdict.ts`；这里只负责把它们画出来。
 * 特别地，`indeterminate` 永远不写成「不一致」——把「算不出来」显示成「不一样」，
 * 等于把服务器错误说成文件损坏。
 */
import { AlertCircle, Clock, ShieldCheck, ShieldX } from 'lucide-react'
import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import type { TransferRecord } from '@/store/transfer-queue'
import {
  checksumPercent,
  checksumVerdict,
} from '@/store/transfer-checksum-verdict'

/** Per-verdict presentation. The only thing that differs between the five cases. */
const PRESENTATION: Record<
  string,
  { icon: ComponentType<{ className?: string }>; tone: string }
> = {
  verified: { icon: ShieldCheck, tone: 'text-success' },
  mismatch: { icon: ShieldX, tone: 'text-destructive' },
  indeterminate: { icon: AlertCircle, tone: 'text-muted-foreground' },
  computing: { icon: Clock, tone: 'text-muted-foreground' },
  unchecked: { icon: ShieldX, tone: 'text-muted-foreground' },
}

export const IntegrityLine: React.FC<{ record: TransferRecord }> = ({
  record,
}) => {
  const { t } = useTranslation()
  const { verdict, failedSide, error } = checksumVerdict(record)

  // A transfer that never completed has nothing to say about integrity.
  if (verdict === 'unchecked' && record.status !== 'done') return null

  let text: string
  switch (verdict) {
    case 'verified':
      text = t('sftp.verified')
      break
    case 'mismatch':
      text = t('sftp.mismatch')
      break
    case 'computing': {
      const percent = checksumPercent(record)
      text =
        percent > 0
          ? t('sftp.verifyingProgress', { percent })
          : t('sftp.verifying')
      break
    }
    case 'indeterminate': {
      const side = failedSide
        ? t(
            failedSide === 'local'
              ? 'sftp.checksumSide.local'
              : 'sftp.checksumSide.remote',
          )
        : null
      text = side
        ? t('sftp.verificationFailedSide', { side })
        : t('sftp.verificationFailed')
      break
    }
    default:
      text = t('sftp.unverified')
  }

  const { icon: Icon, tone } = PRESENTATION[verdict] ?? PRESENTATION.unchecked

  return (
    <div
      className={`flex items-center gap-1 text-[10px] ${tone}`}
      data-testid="transfer-integrity"
      data-integrity={verdict}
      // A mismatch is announced, not merely coloured.
      role={verdict === 'mismatch' ? 'alert' : undefined}
      title={error ?? undefined}
      aria-label={text}
    >
      <Icon className="size-3" aria-hidden="true" />
      <span>{text}</span>
    </div>
  )
}
