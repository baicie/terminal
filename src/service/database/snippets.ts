/**
 * Snippets CRUD 操作
 */
import { executeQuery, select } from './connection'
import type { SnippetRecord, SnippetPackageRecord } from './types'

export async function createSnippet(snippet: SnippetRecord): Promise<void> {
  await executeQuery(
    'INSERT INTO snippets (id, name, description, script, package_id, tags, variables) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      snippet.id,
      snippet.name,
      snippet.description || null,
      snippet.script,
      snippet.package_id || null,
      snippet.tags || null,
      snippet.variables || null,
    ],
  )
}

export async function updateSnippet(snippet: SnippetRecord): Promise<void> {
  await executeQuery(
    'UPDATE snippets SET name = ?, description = ?, script = ?, package_id = ?, tags = ?, variables = ? WHERE id = ?',
    [
      snippet.name,
      snippet.description || null,
      snippet.script,
      snippet.package_id || null,
      snippet.tags || null,
      snippet.variables || null,
      snippet.id,
    ],
  )
}

export async function deleteSnippet(id: string): Promise<void> {
  await executeQuery('DELETE FROM snippets WHERE id = ?', [id])
}

export async function getSnippets(
  packageId?: string,
): Promise<SnippetRecord[]> {
  if (packageId) {
    return select<SnippetRecord[]>(
      'SELECT * FROM snippets WHERE package_id = ? ORDER BY name',
      [packageId],
    )
  }
  return select<SnippetRecord[]>('SELECT * FROM snippets ORDER BY name')
}

export async function getSnippetById(
  id: string,
): Promise<SnippetRecord | null> {
  const results = await select<SnippetRecord[]>(
    'SELECT * FROM snippets WHERE id = ?',
    [id],
  )
  return results[0] || null
}

export async function searchSnippets(query: string): Promise<SnippetRecord[]> {
  const escapedQuery = query.replace(/[%_]/g, '\\$&')
  return select<SnippetRecord[]>(
    'SELECT * FROM snippets WHERE name LIKE ? ESCAPE "\\" OR description LIKE ? ESCAPE "\\" OR script LIKE ? ESCAPE "\\" ORDER BY name LIMIT 50',
    [`%${escapedQuery}%`, `%${escapedQuery}%`, `%${escapedQuery}%`],
  )
}

export async function createSnippetPackage(pkg: SnippetPackageRecord): Promise<void> {
  await executeQuery(
    'INSERT INTO snippet_packages (id, name, description) VALUES (?, ?, ?)',
    [pkg.id, pkg.name, pkg.description || null],
  )
}

export async function deleteSnippetPackage(id: string): Promise<void> {
  await executeQuery('DELETE FROM snippet_packages WHERE id = ?', [id])
}

export async function getSnippetPackages(): Promise<SnippetPackageRecord[]> {
  return select<SnippetPackageRecord[]>('SELECT * FROM snippet_packages ORDER BY name')
}
