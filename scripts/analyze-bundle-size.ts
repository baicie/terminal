/**
 * Tauri 打包产物体积分析脚本
 * 运行方式: pnpm run analyze:bundle
 */

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

interface BundleResult {
  frontend?: { size: number }
  rustBinary?: { name: string; size: number }
  macosApp?: { name: string; size: number }
  dmg?: { name: string; size: number }
  windowsExe?: { name: string; size: number }
  msi?: { name: string; size: number }
}

function getDirSize(dirPath: string): number {
  try {
    const { platform } = process
    if (platform === 'win32') {
      // Windows: 使用 PowerShell 计算目录大小
      const result = execSync(
        `powershell -Command "(Get-ChildItem -Path '${dirPath}' -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum"`,
        { encoding: 'utf8', windowsHide: true }
      )
      const size = parseInt(result.trim(), 10)
      return size || 0
    } else {
      // Unix: 使用 du 命令
      const result = execSync(`du -sk "${dirPath}" 2>/dev/null`, { encoding: 'utf8' })
      const size = parseInt(result.split('\t')[0], 10) * 1024
      return size || 0
    }
  } catch {
    return 0
  }
}

async function findFile(dir: string, extensions: string[]): Promise<{ name: string; size: number } | undefined> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = entry.name.substring(entry.name.lastIndexOf('.')).toLowerCase()
        if (extensions.includes(ext)) {
          const stats = await stat(join(dir, entry.name))
          return { name: entry.name, size: stats.size }
        }
      }
      if (entry.isDirectory() && entry.name.endsWith('.app')) {
        if (extensions.includes('.app')) {
          const stats = await stat(join(dir, entry.name))
          return { name: entry.name, size: stats.size }
        }
      }
    }
  } catch {
    // 目录不存在
  }
  return undefined
}

async function analyzeBundleSize(projectRoot: string = process.cwd()): Promise<BundleResult> {
  const targetDir = join(projectRoot, 'src-tauri', 'target', 'release', 'bundle')
  const result: BundleResult = {}

  // 前端
  const distDir = join(projectRoot, 'dist')
  const distSize = getDirSize(distDir)
  if (distSize > 0) {
    result.frontend = { size: distSize }
  }

  // Rust 可执行文件
  const releaseDir = join(projectRoot, 'src-tauri', 'target', 'release')
  const binary = await findFile(releaseDir, ['.exe', ''])
  if (binary) result.rustBinary = binary

  // macOS app - 使用 du 命令获取目录大小
  const macosDir = join(targetDir, 'macos')
  try {
    const entries = await readdir(macosDir)
    for (const name of entries) {
      if (name.endsWith('.app')) {
        const appPath = join(macosDir, name)
        const size = getDirSize(appPath)
        if (size > 0) {
          result.macosApp = { name, size }
          break
        }
      }
    }
  } catch {
    // 目录不存在
  }

  // DMG
  const dmgDir = join(targetDir, 'dmg')
  const dmg = await findFile(dmgDir, ['.dmg'])
  if (dmg) result.dmg = dmg

  // Windows exe
  const windowsDir = join(targetDir, 'windows')
  const windowsExe = await findFile(windowsDir, ['.exe'])
  if (windowsExe) result.windowsExe = windowsExe

  // MSI
  const msiDir = join(targetDir, 'msi')
  const msi = await findFile(msiDir, ['.msi'])
  if (msi) result.msi = msi

  return result
}

function printResult(result: BundleResult) {
  console.log('============================================================')
  console.log('  Tauri 打包产物体积分析')
  console.log('============================================================')
  console.log()

  if (result.frontend) {
    console.log(`  前端 (dist/)        ${formatSize(result.frontend.size)}`)
  }

  if (result.rustBinary) {
    console.log(`  Rust 可执行文件      ${formatSize(result.rustBinary.size)}`)
  }

  if (result.macosApp) {
    console.log(`  macOS .app          ${formatSize(result.macosApp.size)}`)
  }

  if (result.dmg) {
    console.log(`  macOS .dmg          ${formatSize(result.dmg.size)}`)
  }

  if (result.windowsExe) {
    console.log(`  Windows .exe        ${formatSize(result.windowsExe.size)}`)
  }

  if (result.msi) {
    console.log(`  Windows .msi       ${formatSize(result.msi.size)}`)
  }

  console.log()
  console.log('============================================================')
}

// 运行
const projectRoot = process.argv[2] || process.cwd()
analyzeBundleSize(projectRoot)
  .then(printResult)
  .catch((error) => {
    console.error('分析失败:', error)
    process.exit(1)
  })