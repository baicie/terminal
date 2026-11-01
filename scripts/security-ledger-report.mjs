#!/usr/bin/env node
/**
 * Render the RustSec ledger as Markdown.
 *
 * Split out of build-security-ledger.mjs to keep both files inside the 300-line
 * limit, and because the rendering is the part worth testing against a fixture:
 * the previous ledger's CVSS column was empty for all 27 rows and nothing
 * noticed, since no test ever looked at the rendered table.
 */

/** Shown for the advisories RustSec publishes without a CVSS vector. */
export const NOT_PUBLISHED = '(not published)'

const REACH_LABEL = {
  'normal dependency': '在构建图内（normal 依赖）',
  'build/dev/target-only': '仅 build/dev/target 边',
  'absent-from-build-graph': '不在构建图（Cargo.lock 残留）',
}

/** `7.5 High`, or the not-published marker when RustSec published no vector. */
function scoreCell(row) {
  if (row.severity === null || row.score === null) return NOT_PUBLISHED
  return `${row.score.toFixed(1)} ${row.severity}`
}

/** One severity histogram line, listing only the ratings actually present. */
function severityLine(bucket) {
  const parts = Object.entries(bucket.bySeverity)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${name} ${count}`)
  if (bucket.unscored > 0) parts.push(`${NOT_PUBLISHED} ${bucket.unscored}`)
  return parts.length > 0 ? parts.join(' / ') : '（无）'
}

/** `quick-xml ×4, russh ×1` - which crates the bucket is made of. */
function crateLine(bucket) {
  const names = Object.entries(bucket.crates).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )
  if (names.length === 0) return '（无）'
  return names.map(([name, count]) => `${name} ×${count}`).join(', ')
}

/**
 * The rows that decide whether this release ships: scored High or Critical and
 * actually in the build graph. Everything else is either unreachable or lower
 * severity, and a flat 27-row table buries these.
 */
export function highSeverityInGraph(rows) {
  return rows
    .filter(
      row =>
        row.reach !== 'absent-from-build-graph' &&
        (row.severity === 'High' || row.severity === 'Critical'),
    )
    .sort((a, b) => b.score - a.score || a.crate.localeCompare(b.crate))
}

function pushSummary(lines, rows, summary) {
  lines.push('## 摘要（按可达性分列）')
  lines.push('')
  lines.push(
    '一条 7.5 落在 Cargo.lock 残留的 crate 上，和一条 7.5 落在 SSH 传输链路上，',
  )
  lines.push('不是同一个结论。所以严重度分布按「是否在构建图内」分开统计：')
  lines.push('')
  lines.push('| 分组 | 条数 | 严重度分布 | 涉及 crate |')
  lines.push('| --- | --- | --- | --- |')
  lines.push(
    `| 在构建图内 | ${summary.inBuildGraph.total} | ${severityLine(summary.inBuildGraph)} | ${crateLine(summary.inBuildGraph)} |`,
  )
  lines.push(
    `| 不在构建图 | ${summary.absent.total} | ${severityLine(summary.absent)} | ${crateLine(summary.absent)} |`,
  )
  lines.push('')
  lines.push(
    `RustSec 未发布 CVSS 向量的共 ${summary.unscored} 条，单独计数，不计入上面任何严重度等级。`,
  )
  lines.push('')

  const hot = highSeverityInGraph(rows)
  lines.push('### 在构建图内且 High/Critical')
  lines.push('')
  if (hot.length === 0) {
    lines.push('（无）')
    lines.push('')
    return
  }
  lines.push('| advisory | crate | 锁定版本 | 基准分 | 等级 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const row of hot) {
    lines.push(
      `| ${row.id} | ${row.crate} | ${row.version} | ${row.score.toFixed(1)} | ${row.severity} |`,
    )
  }
  lines.push('')
}

/** Render the whole ledger: header, summary, full table. */
export function renderLedgerMarkdown(rows, summary) {
  const lines = []
  lines.push('# RustSec 漏洞台账（Phase 9.1）')
  lines.push('')
  lines.push(
    '> 由 scripts/build-security-ledger.mjs 从 cargo audit --json 自动生成，未手工编辑。',
  )
  lines.push('> 可达性来自 cargo tree，不是「读产品代码猜它用不用某种协议」。')
  lines.push(
    '> 基准分由 scripts/cvss.mjs 按 CVSS v3.1 规范公式从向量重新算出，不是抄来的数字：',
  )
  lines.push('> 拿着同一条向量的人可以独立复算。cargo audit --json 本身不提供分数字段。')
  lines.push('')
  lines.push(`**共 ${rows.length} 条。**`)
  lines.push('')
  pushSummary(lines, rows, summary)
  lines.push('## 全部条目')
  lines.push('')
  lines.push('| # | advisory | crate | 锁定版本 | 基准分 / 等级 | CVSS 向量 | 可达性 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  rows.forEach((row, index) => {
    lines.push(
      `| ${index + 1} | ${row.id} | ${row.crate} | ${row.version} | ${scoreCell(row)} | ${row.cvss} | ${REACH_LABEL[row.reach] ?? row.reach} |`,
    )
  })
  lines.push('')
  return lines.join('\n')
}
