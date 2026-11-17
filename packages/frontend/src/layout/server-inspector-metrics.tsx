/**
 * The Inspector's metric table.
 *
 * Split out of `server-inspector-view.tsx` for the size limit. Every value goes through
 * the formatters in `server-inspector.ts`, which render `N/A` for `null` — a missing
 * reading must never appear as zero, because a zero reads as "nothing is wrong".
 */

import { useTranslation } from 'react-i18next'
import {
  formatBytes,
  formatUptime,
  ratioPercent,
  type ProbeResult,
} from '@/features/inspector/server-inspector'

interface InspectorMetricsProps {
  result: ProbeResult
}

export function InspectorMetrics({ result }: InspectorMetricsProps) {
  const { t } = useTranslation()
  const { metrics } = result
  const memoryPercent = ratioPercent(metrics.memoryUsedBytes, metrics.memoryTotalBytes)

  // Load averages are a triple or nothing; mixing one real number with two `N/A`s
  // would imply the missing ones were measured.
  const load =
    metrics.load1 === null
      ? 'N/A'
      : [metrics.load1, metrics.load5, metrics.load15]
          .map(value => (value === null ? 'N/A' : value.toFixed(2)))
          .join(' / ')

  return (
    <>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <Metric label={t('inspector.os')} value={metrics.os ?? 'N/A'} />
        <Metric label={t('inspector.uptime')} value={formatUptime(metrics.uptimeSeconds)} />
        <Metric label={t('inspector.load')} value={load} />
        <Metric
          label={t('inspector.cpu')}
          value={metrics.cpuPercent === null ? 'N/A' : `${metrics.cpuPercent}%`}
        />
        <Metric
          label={t('inspector.memory')}
          value={
            metrics.memoryTotalBytes === null
              ? 'N/A'
              : `${formatBytes(metrics.memoryUsedBytes)} / ${formatBytes(metrics.memoryTotalBytes)}`
          }
        />
        <Metric
          label={t('inspector.disk')}
          value={
            metrics.diskTotalBytes === null
              ? 'N/A'
              : `${formatBytes(metrics.diskUsedBytes)} / ${formatBytes(metrics.diskTotalBytes)}`
          }
        />
      </dl>

      {memoryPercent !== null && (
        <p className="text-xs text-muted-foreground">
          {t('inspector.memoryUsed', { percent: memoryPercent })}
        </p>
      )}
    </>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </>
  )
}
