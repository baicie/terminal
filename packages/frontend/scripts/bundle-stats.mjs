#!/usr/bin/env node
/**
 * Bundle Stats
 *
 * 扫描 vite 产物目录（dist/），统计每个 chunk 的体积、gzip 体积、brotli 体积，
 * 并通过解析 index.html 的 entry + modulepreload 把 chunk 划分为：
 *   - Initial   — 首屏关键路径（必须在 hover 出现前加载完）
 *   - Lazy      — 路由 / 动态 import 拉到的 chunk（如终端、设置弹窗等）
 *
 * 输出：
 *   - dist-stats.md       — 人类可读 markdown 报告
 *   - dist-stats.json     — 机器可解析，便于 CI 跟踪基线
 *
 * 用法：
 *   pnpm build
 *   node scripts/bundle-stats.mjs              # 默认扫描 ../../dist
 *   node scripts/bundle-stats.mjs --dist=path  # 指定其他目录
 */

import { gzipSync, brotliCompressSync } from 'node:zlib'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const argv = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)

// The total budget tracks the whole lazy graph, so it grows whenever a feature
// adds a view. It is deliberately looser than the initial budget: what gates
// time-to-first-terminal is the critical path, and the initial budget is the
// one that enforces that. Raising this line is only acceptable in the same
// commit that explains which feature added the bytes.
const budgets = {
  initialGzip: 240 * 1024,
  // 575 KB (was 565 KB): Phase 8.8 Task D made the Vault UI reachable. It had
  // been dead code - no route, no imports - so none of it was bundled before;
  // wiring /vaults into router/nav-config.tsx now ships vaults-view, its auth
  // states, entry list, entry details and their three-locale strings, taking
  // the lazy graph from 560.93 KB to 567.91 KB gzip on CI.
  //
  // The cap sits at 575 rather than just above 567.91 because the local build
  // reports 561.96 KB for the same sources - roughly 6 KB lower than CI, which
  // is enough to make a tight cap pass locally and fail in CI. Budget headroom
  // has to cover that delta or it is not a gate, it is a coin flip.
  // The initial budget above is untouched: time-to-first-terminal rides on the
  // critical path, not on this line.
  //
  // 577 KB (was 575 KB): Phase 9.6 adds the product startup recovery gate and
  // its redacted state probe so a partial migration cannot silently reach the
  // main UI. It is one small screen; keep the next increase this specific.
  //
  // 583 KB (was 577 KB): the settings, host create/edit and port-forward
  // dialogs were hardcoded English. Localizing them adds en/cn/fr copy only
  // (≈2.5 KB gzip on CI); no view, dependency or code path was added.
  //
  // 588 KB (was 583 KB): the same sweep for keychain, SFTP, snippets, teams,
  // known hosts, command palette, logs and serial adds another ≈5.6 KB gzip of
  // three-locale copy. Again strings only.
  //
  // 589 KB (was 588 KB): Phase 9.8 adds the Teams sync-error banner (six locale
  // strings plus the Alert already shipped with Hosts) and the SFTP "unknown
  // mtime" dash. No new dependency or view; the measured total was 588.31 KB.
  //
  // 593 KB (was 589 KB): Phase 10 adds the credential boundary and vault provider,
  // the paste policy + confirm dialog, the OpenSSH importer, host ranking, and the
  // shortcut persistence layer, plus five locale strings in three languages.
  // No new dependency. Measured total 591.42 KB; 593 leaves ~1.5 KB of headroom.
  //
  // 595 KB (was 593 KB): the review pass adds the DOM paste gate (covers Cmd+V and
  // the native menu, which the context menus never did), the credential migration
  // planner, and the shortcuts write-order state machine. Still no new dependency;
  // measured 593.42 KB.
  //
  // 607 KB (was 595 KB): Phase 10.1 closes the credential boundary. Four new
  // surfaces — the import secret decision panel, the import preview card, the
  // plaintext-credential migration panel, and the keychain show/copy actions — plus
  // the versioned-reference and settings-allowlist modules and ≈30 locale strings
  // in three languages. No new dependency; measured 604.80 KB, so 607 leaves
  // ~2 KB of headroom. The initial budget above is unchanged: none of this is on
  // the time-to-first-terminal path, and the critical path still measures the same.
  //
  // 624 KB (was 607 KB): Phase 10.2 adds the OpenSSH import wizard (source reader,
  // plan planner wiring, candidate list, and its state machine), the in-dialog
  // vault recovery panel, and ≈20 more locale strings in three languages. No new
  // dependency. Measured 611.98 KB.
  //
  // Why raising this is the right call here and not a silent slip: the initial
  // budget moved by 0.16 KB (130.51 → 130.67) — every kilobyte of the increase is
  // in lazily-loaded chunks that the time-to-first-terminal path never touches. The
  // wizard only loads when the user opens it. The alternative — trimming the
  // three-language strings or splitting the import flow further — would trade a
  // real feature for a number nobody experiences.
  //
  // 628 KB (was 624 KB): UX-1b adds the Connection Explorer (panel, sections, host
  // row, grouping/filtering and the connection-log recency reader), the left-panel
  // resolver that makes the rail switch one panel instead of stacking two, the
  // single terminal-route predicate that replaces eleven scattered string
  // comparisons, and ~30 strings in three languages. No new dependency.
  //
  // Measured 623.04 KB against a 618.20 KB baseline: +4.84 KB, and the initial
  // budget did not move at all (130.74 → 130.88, of which 0.14 KB is the rail's
  // new Connections entry). Everything else is behind lazy boundaries — the layout
  // chunk that carries the explorer only loads once the app shell does.
  //
  // The alternative was to leave the previous ceiling and shave the panel: dropping
  // the three-language strings, or the recent-connections reader that this phase's
  // task explicitly requires. Both trade a delivered requirement for a number no
  // user experiences, so raising the ceiling with the measurement written down is
  // the honest move.
  //
  // 632 KB (was 628 KB): UX-2a adds the connect-time credential dialog and the
  // hook that decides what "connect" means per credential state, the damaged-
  // reference clear action on both hosts and SSH keys (with its own confirmation
  // and three-state rule), and ~40 strings in three languages. No new dependency.
  //
  // Measured 628.94 KB against the 628.00 KB ceiling: +0.94 KB. The initial budget
  // moved by 0.33 KB (130.92 KB), because the dialog is rendered by the hosts view
  // which is already lazy — nothing new is on the time-to-first-terminal path.
  //
  // The alternative was to fold the "this host cannot connect yet" text into an
  // existing string to stay under the old number, which would trade a user-visible
  // explanation of an unrecoverable state for a kilobyte nobody experiences.
  //
  // 640 KB (was 632 KB): the extension platform lands — manifest validation, the
  // registry, the capability gateway with its approval book, the snippet-dock
  // extension and the dock's presentational shell, plus one case in `RightPanel`
  // and ~21 strings in three languages. No new dependency.
  //
  // Measured 633.71 KB against the 632.00 KB ceiling: +1.71 KB. The initial budget
  // is unchanged at 130.93 KB: the dock chunk is lazy (SFTP and Snippets both load
  // only when the column opens) and nothing here is on the time-to-first-terminal
  // path.
  //
  // The alternative was to fold the five extension strings into existing keys or
  // drop the "not enabled" message, which would leave a dock that renders silently
  // when its extension is off — a user-visible gap traded for 1.7 KB.
  //
  // 652 KB (was 640 KB): the AI dock lands — three components (view, config strip,
  // result area), the runtime adapter, profile storage wiring, one Command Palette
  // entry and ~21 strings in three languages. No new dependency.
  //
  // Measured 643.05 KB against the 640.00 KB ceiling: +3.05 KB. The initial budget is
  // unchanged at 130.93 KB: the dock is behind the right-panel chunk, which only loads
  // once the column opens, so nothing here is on the time-to-first-terminal path.
  //
  // The alternative was to drop the risk-flags line or the "nothing is run
  // automatically" footer to stay under the old number, which would trade the two
  // statements that make the feature honest for 3 KB nobody experiences.
  //
  // 652.5 KB (was 652 KB): the snippet workflow (#104, #113) and the extension switch
  // (#114) added user-facing strings in all three languages — the draft save/name
  // controls, the imports panel, the host edit entry. Measured 652.12 KB against the
  // 652.00 KB ceiling: **+124 bytes**, entirely locale text; no dependency, no code
  // path, nothing on the initial path.
  //
  // This overshoot predates the round that found it: the strings landed in commits
  // whose gate runs did not include `build:budget`, so the ceiling was never re-measured.
  // Raising it here rather than trimming the copy, for the same reason as the entry
  // above — these are the labels of controls that already exist, and removing them
  // would leave controls with no text.
  //
  // The 0.5 KB is deliberately not rounded up to 1 KB: a ceiling that grows by round
  // numbers stops recording how much was actually added.
  // 653 KB (was 652.5 KB): the extension concurrency round (PR #117) added a cleanup
  // indicator to the settings panel plus three locale strings. Measured 652.75 KB
  // against the 652.50 KB ceiling: +0.25 KB, all of it the diagnostic line and its
  // copy — no dependency, nothing on the initial path (initial is unchanged at 131 KB).
  //
  // The baseline was measured at `47426c5` before raising this: 652.30 KB, i.e. this
  // round accounts for the whole difference rather than inheriting headroom.
  // 653.5 KB (was 653 KB): the Inspector round (PR #119) added a `data-metric`
  // attribute to every metric row — the marker a GUI assertion needs to tell "this
  // panel shows data" from "it shows an error" — plus the darwin uptime probe's
  // corrected sed expression. Measured 653.09 KB against the 653.00 KB ceiling:
  // **+0.34 KB**, no dependency and nothing on the initial path (unchanged at 131 KB).
  //
  // The baseline was measured at `63e0731` before raising this: 652.75 KB, so this
  // round accounts for the whole difference rather than inheriting headroom. The
  // attribute is not decorative: without it the spec's `[data-metric]` guard selected
  // nothing and its assertion could never fail.
  //
  // ## 654.5 KB (was 653.5 KB): both rounds, measured on one tree
  //
  // This branch carries two changes that each add bytes, and after #130 landed they
  // are finally measured *together* rather than summed from separate trees:
  //
  //   credential-leak fix   +0.28 KB   `scrubSecrets` plus the extracted
  //                                    `describeInvokeError` (+0.32 KB of scrubbing
  //                                    code, −0.04 KB from the formatter leaving
  //                                    `session.ts`)
  //   AI request-id fix     +0.17 KB   the per-realm prefix, so two windows cannot
  //                                    mint the same id (653.91 KB measured with it
  //                                    reverted, confirming the split)
  //
  // Baseline is `main@eb7d5bd`, which already includes #130's SFTP round (653.70 KB).
  // Measured here after rebasing onto it: **654.12 KB** — slightly more than the sum of
  // the two parts, because the two rounds share some chunk boundaries and the bundler
  // re-splits them. Summing measurements from separate trees would have predicted
  // 654.08 and been wrong; this is why the number is taken from one tree.
  //
  // ## The ceiling it replaces had already been crossed
  //
  // `43dd4b7` (PR #128) measured 653.63 KB against a 653.50 KB limit and merged
  // anyway, because the `required_status_checks` rule was removed from the `main`
  // ruleset on 2026-11-20 by owner instruction — and the next PR inherited the same
  // tree. So the numbers above are the first honest measurements since the gate
  // stopped enforcing, not growth against a healthy budget.
  //
  // 654.5 KB is the measured size, not a round number, leaving ~0.42 KB. That is the
  // first ceiling in four rounds with more than 0.4 KB of slack; the previous three
  // were each crossed by the very next honest change, which is the argument for slack
  // rather than against it.
  //
  // 656 KB (was 654.5 KB): the SFTP pane's four icon buttons gained `aria-label`s and
  // test ids, which is six new strings in three languages. Measured on CI run
  // 44935706255, on a tree that already contained T21–T30:
  //
  //   Total: raw=2.23 MB gzip=654.63 KB     against the 654.50 KB ceiling
  //
  // The ceiling had effectively been reached before that change: the same run reports
  // 654.63 KB, and local builds report 654.35–654.43 KB for both `main` and this
  // branch. A ±0.1 KB spread between machines means 654.5 was inside the measurement
  // noise — a ceiling that tight is a coin flip, not a gate.
  //
  // What this deliberately does *not* do is buy the space back by moving
  // `registry-diagnostics.ts` out of the initial graph. It is 2 KB of source and gzips
  // to a fraction of the overage, so the split would have been a change made to look
  // responsive rather than one that helps, and it would remove the accessors the
  // ledger tests read. The two honest options were "raise the ceiling with the
  // measurement written down" or "drop the accessible names"; the second trades a real
  // accessibility fix for 0.13 KB.
  //
  // 656 KB leaves ~1.4 KB, comfortably more than the spread.
  totalGzip: 656 * 1024,
  maxJavaScriptRaw: 500 * 1024,
}

const DIST = path.resolve(
  process.cwd(),
  argv.dist ?? path.join('..', '..', 'dist'),
)

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, acc)
    else acc.push(p)
  }
  return acc
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function categorize(rel) {
  const lower = rel.toLowerCase()
  if (lower.endsWith('.css')) return 'CSS'
  if (lower.endsWith('.html')) return 'HTML'
  if (lower.endsWith('.js')) {
    if (
      /(@baicie|@xterm|react-dom|react-router|@radix-ui|@tauri-apps|@floating-ui|i18next|sonner|cmdk|axios|dayjs|tailwind-merge|class-variance|lucide-react|zustand|rolldown-runtime)/.test(
        rel,
      )
    ) {
      return 'Vendor JS'
    }
    return 'App JS'
  }
  return 'Other'
}

/**
 * 解析 dist/index.html 的 entry script + modulepreload，
 * 拿到「首屏关键路径」会请求的 chunk 列表（不包含 lazy 拉的）。
 */
function parseInitialChunks(distDir) {
  try {
    const html = readFileSync(path.join(distDir, 'index.html'), 'utf8')
    const set = new Set()
    // <script src="/js/xxx.js">
    for (const m of html.matchAll(
      /<script\s+[^>]*\bsrc=["']\/?([^"']+\.js)["']/gi,
    )) {
      set.add(m[1])
    }
    // <link rel="modulepreload" href="/js/xxx.js">
    for (const m of html.matchAll(
      /<link\s+[^>]*\brel=["']modulepreload["'][^>]*\bhref=["']\/?([^"']+\.js)["']/gi,
    )) {
      set.add(m[1])
    }
    // CSS
    for (const m of html.matchAll(
      /<link\s+[^>]*\bhref=["']\/?([^"']+\.css)["']/gi,
    )) {
      set.add(m[1])
    }
    return set
  } catch {
    return new Set()
  }
}

const initial = parseInitialChunks(DIST)

const files = walk(DIST)

const stats = files
  .filter(p => /\.(js|css|html)$/.test(p))
  .map(p => {
    const rel = path.relative(DIST, p).replace(/\\/g, '/')
    const buf = readFileSync(p)
    const raw = buf.length
    const gzip = gzipSync(buf, { level: 9 }).length
    const brotli = brotliCompressSync(buf).length
    const isInitial =
      rel === 'index.html' || initial.has(rel) || initial.has(`/${rel}`)
    return {
      file: rel,
      category: categorize(rel),
      loadType: isInitial ? 'Initial' : 'Lazy',
      raw,
      gzip,
      brotli,
    }
  })
  .sort((a, b) => b.raw - a.raw)

function sumStats(items) {
  return items.reduce(
    (acc, s) => {
      acc.raw += s.raw
      acc.gzip += s.gzip
      acc.brotli += s.brotli
      return acc
    },
    { raw: 0, gzip: 0, brotli: 0 },
  )
}

const total = sumStats(stats)
const initialAgg = sumStats(stats.filter(s => s.loadType === 'Initial'))
const lazyAgg = sumStats(stats.filter(s => s.loadType === 'Lazy'))

const byCat = stats.reduce((acc, s) => {
  acc[s.category] ??= { raw: 0, gzip: 0, brotli: 0, count: 0 }
  acc[s.category].raw += s.raw
  acc[s.category].gzip += s.gzip
  acc[s.category].brotli += s.brotli
  acc[s.category].count += 1
  return acc
}, {})

const lines = []
lines.push(`# Bundle Stats`)
lines.push('')
lines.push(`> Generated at ${new Date().toISOString()}`)
lines.push('')
lines.push(`Dist directory: \`${DIST}\``)
lines.push('')
lines.push(`## 总览`)
lines.push('')
lines.push(`| | 文件数 | Raw | Gzip | Brotli |`)
lines.push(`| --- | --- | --- | --- | --- |`)
lines.push(
  `| **首屏（Initial）** | ${stats.filter(s => s.loadType === 'Initial').length} | ${fmtBytes(initialAgg.raw)} | **${fmtBytes(initialAgg.gzip)}** | ${fmtBytes(initialAgg.brotli)} |`,
)
lines.push(
  `| 路由 / 动态（Lazy） | ${stats.filter(s => s.loadType === 'Lazy').length} | ${fmtBytes(lazyAgg.raw)} | ${fmtBytes(lazyAgg.gzip)} | ${fmtBytes(lazyAgg.brotli)} |`,
)
lines.push(
  `| 全部 | ${stats.length} | ${fmtBytes(total.raw)} | ${fmtBytes(total.gzip)} | ${fmtBytes(total.brotli)} |`,
)
lines.push('')
lines.push(
  `> **首屏 gzip = ${fmtBytes(initialAgg.gzip)}** 是用户打开应用必须下载的关键路径体积。`,
)
lines.push('')
lines.push(`## 按类别`)
lines.push('')
lines.push(`| 类别 | 文件数 | Raw | Gzip | Brotli |`)
lines.push(`| --- | --- | --- | --- | --- |`)
for (const [cat, v] of Object.entries(byCat).sort(
  (a, b) => b[1].raw - a[1].raw,
)) {
  lines.push(
    `| ${cat} | ${v.count} | ${fmtBytes(v.raw)} | ${fmtBytes(v.gzip)} | ${fmtBytes(v.brotli)} |`,
  )
}
lines.push('')
lines.push(`## 各文件（按 Raw 体积排序）`)
lines.push('')
lines.push(`| 文件 | 加载 | 类别 | Raw | Gzip | Brotli |`)
lines.push(`| --- | --- | --- | --- | --- | --- |`)
for (const s of stats) {
  lines.push(
    `| \`${s.file}\` | ${s.loadType} | ${s.category} | ${fmtBytes(s.raw)} | ${fmtBytes(s.gzip)} | ${fmtBytes(s.brotli)} |`,
  )
}
lines.push('')

const mdOut = path.resolve(DIST, '..', 'dist-stats.md')
const jsonOut = path.resolve(DIST, '..', 'dist-stats.json')

writeFileSync(mdOut, lines.join('\n'), 'utf8')
writeFileSync(
  jsonOut,
  JSON.stringify(
    { total, initial: initialAgg, lazy: lazyAgg, byCat, files: stats },
    null,
    2,
  ),
  'utf8',
)

console.log(`✓ Bundle stats written:`)
console.log(`  - ${path.relative(process.cwd(), mdOut)}`)
console.log(`  - ${path.relative(process.cwd(), jsonOut)}`)
console.log(
  `Initial: raw=${fmtBytes(initialAgg.raw)} gzip=${fmtBytes(initialAgg.gzip)} brotli=${fmtBytes(initialAgg.brotli)}`,
)
console.log(
  `Lazy:    raw=${fmtBytes(lazyAgg.raw)} gzip=${fmtBytes(lazyAgg.gzip)} brotli=${fmtBytes(lazyAgg.brotli)}`,
)
console.log(
  `Total:   raw=${fmtBytes(total.raw)} gzip=${fmtBytes(total.gzip)} brotli=${fmtBytes(total.brotli)}`,
)

if (argv.check) {
  const failures = []
  if (initialAgg.gzip > budgets.initialGzip) {
    failures.push(
      `initial gzip ${fmtBytes(initialAgg.gzip)} exceeds ${fmtBytes(budgets.initialGzip)}`,
    )
  }
  if (total.gzip > budgets.totalGzip) {
    failures.push(
      `total gzip ${fmtBytes(total.gzip)} exceeds ${fmtBytes(budgets.totalGzip)}`,
    )
  }

  const oversizedJavaScript = stats.filter(
    item => item.file.endsWith('.js') && item.raw > budgets.maxJavaScriptRaw,
  )
  if (oversizedJavaScript.length > 0) {
    failures.push(
      ...oversizedJavaScript.map(
        item =>
          `${item.file} ${fmtBytes(item.raw)} exceeds ${fmtBytes(budgets.maxJavaScriptRaw)}`,
      ),
    )
  }

  const eagerTerminalChunks = stats.filter(
    item =>
      item.loadType === 'Initial' &&
      /(?:^|\/)(?:xterm-(?:core|addons)|container)\./.test(item.file),
  )
  if (eagerTerminalChunks.length > 0) {
    failures.push(
      `terminal-only chunks entered the initial graph: ${eagerTerminalChunks.map(item => item.file).join(', ')}`,
    )
  }

  if (failures.length > 0) {
    console.error('\nBundle budget failed:')
    failures.forEach(failure => console.error(`- ${failure}`))
    process.exitCode = 1
  } else {
    console.log(
      `Bundle budget passed (initial gzip <= ${fmtBytes(budgets.initialGzip)}, total gzip <= ${fmtBytes(budgets.totalGzip)}, JS chunk <= ${fmtBytes(budgets.maxJavaScriptRaw)}).`,
    )
  }
}
