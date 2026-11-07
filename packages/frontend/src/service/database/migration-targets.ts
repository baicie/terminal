export interface MigrationTarget {
  table: string
  columns: string[]
}

/** Group pending column migrations into one target per table. */
export function groupMigrationTargets(
  pending: { table: string; column: string }[],
): MigrationTarget[] {
  const grouped = new Map<string, string[]>()
  for (const item of pending) {
    const columns = grouped.get(item.table) ?? []
    if (!columns.includes(item.column)) columns.push(item.column)
    grouped.set(item.table, columns)
  }
  return [...grouped].map(([table, columns]) => ({ table, columns }))
}
