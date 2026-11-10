/**
 * The additive part of the schema: one column list per upgrade.
 *
 * Its own module so the statement set and the "is this upgrade still pending?"
 * check share one source of truth that cannot drift, and so the schema file stays
 * within its size limit as tables and columns are added.
 */

/** One column an upgrade adds to a table an older release already created. */
export interface ColumnMigration {
  table: string
  column: string
  sql: string
}

/**
 * The additive part of the schema, as one list so the statements and the "is this
 * upgrade still pending?" check can never disagree about what an upgrade is.
 */
export const columnMigrations: ColumnMigration[] = [
  {
    table: 'connection_logs',
    column: 'error_message',
    sql: 'ALTER TABLE connection_logs ADD COLUMN error_message TEXT',
  },
  {
    table: 'connection_logs',
    column: 'error_raw',
    sql: 'ALTER TABLE connection_logs ADD COLUMN error_raw TEXT',
  },
  {
    table: 'hosts',
    column: 'certificate',
    sql: 'ALTER TABLE hosts ADD COLUMN certificate TEXT',
  },
  {
    table: 'hosts',
    column: 'jump_host_id',
    sql: 'ALTER TABLE hosts ADD COLUMN jump_host_id TEXT',
  },
  {
    table: 'hosts',
    column: 'jump_host_auth_type',
    sql: 'ALTER TABLE hosts ADD COLUMN jump_host_auth_type TEXT',
  },
  {
    table: 'hosts',
    column: 'agent_forwarding',
    sql: 'ALTER TABLE hosts ADD COLUMN agent_forwarding INTEGER DEFAULT 0',
  },
  {
    table: 'hosts',
    column: 'shell_integration',
    sql: "ALTER TABLE hosts ADD COLUMN shell_integration TEXT DEFAULT 'off'",
  },
  {
    // Phase 10: the host row stops carrying secrets. This column names what is
    // stored in the vault (JSON `{kinds:[], provider:'vault'}`), never the value.
    // The legacy `password` / `private_key` / `certificate` columns stay for
    // migration and rollback; see docs/phase10/04-architecture-and-credential-policy.md.
    table: 'hosts',
    column: 'credential_ref',
    sql: 'ALTER TABLE hosts ADD COLUMN credential_ref TEXT',
  },
  {
    // Phase 10.1: the ssh key row stops carrying secrets too, and needs the same
    // kind of pointer. A key without this column could only ever say "the private
    // half is somewhere" — which is what let `getSSHKeySecret` have no caller and
    // no way to prove the vault held anything.
    table: 'ssh_keys',
    column: 'credential_ref',
    sql: 'ALTER TABLE ssh_keys ADD COLUMN credential_ref TEXT',
  },
]

