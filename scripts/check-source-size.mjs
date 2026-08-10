import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const projectRoot = path.resolve(import.meta.dirname, '..')
const sourceRoots = [
  path.join(projectRoot, 'packages/frontend/src'),
  path.join(projectRoot, 'packages/team-server/src'),
]

const excludedDirectories = new Set([
  '__tests__',
  'experiments',
  'fixtures',
  'node_modules',
])

function isProductionSource(filePath) {
  const name = path.basename(filePath)

  if (!/\.(ts|tsx)$/.test(name) || name.endsWith('.d.ts')) return false
  return !/(?:\.test|\.spec|\.stories)\.(?:ts|tsx)$/.test(name)
}

function lineLimit(filePath) {
  if (filePath.endsWith('.ts')) return 300

  const normalized = filePath.split(path.sep).join('/')
  const isEntry = normalized.endsWith('/index.tsx')

  if (isEntry && normalized.includes('/components/')) return 400
  if (isEntry && normalized.includes('/view/')) return 300

  return 200
}

async function collectSourceFiles(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue

    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await collectSourceFiles(entryPath, files)
    } else if (entry.isFile() && isProductionSource(entryPath)) {
      files.push(entryPath)
    }
  }

  return files
}

const sourceFiles = (
  await Promise.all(sourceRoots.map(root => collectSourceFiles(root)))
).flat()

const violations = []
for (const filePath of sourceFiles) {
  const contents = await readFile(filePath, 'utf8')
  const lineCount =
    contents === ''
      ? 0
      : contents.split(/\r?\n/).length - (contents.endsWith('\n') ? 1 : 0)
  const limit = lineLimit(filePath)

  if (lineCount > limit) {
    violations.push({
      file: path.relative(projectRoot, filePath),
      lineCount,
      limit,
    })
  }
}

violations.sort(
  (left, right) =>
    right.lineCount - right.limit - (left.lineCount - left.limit) ||
    left.file.localeCompare(right.file),
)

if (violations.length > 0) {
  console.error(
    `Source-size gate failed: ${violations.length} production files exceed their limits.`,
  )
  for (const violation of violations) {
    console.error(
      `- ${violation.file}: ${violation.lineCount} lines (limit ${violation.limit})`,
    )
  }
  process.exitCode = 1
} else {
  console.log(
    `Source-size gate passed for ${sourceFiles.length} production files.`,
  )
}
