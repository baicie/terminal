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
