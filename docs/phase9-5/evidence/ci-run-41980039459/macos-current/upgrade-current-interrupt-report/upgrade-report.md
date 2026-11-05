# Two-version upgrade report

- Status: **PASS**
- Platform: darwin
- A: 0.0.1-dev.1 (73cf7483e912af33)
- B: 0.0.1-dev.4-local (00afd8ff0752f9c9)
- Fault mode: interrupted

## Checks

- [PASS] A metadata: 0.0.1-dev.1 73cf7483e912af33
- [PASS] B metadata: 0.0.1-dev.4-local 00afd8ff0752f9c9
- [PASS] install A: /Users/runner/work/terminal/terminal/upgrade-current-interrupt/terminal-upgrade-T7wNOK/Applications/Termius.app
- [PASS] A database created: /Users/runner/work/terminal/terminal/upgrade-current-interrupt/terminal-upgrade-T7wNOK/home/Library/Application Support/com.baicie.termius/terminal.db
- [PASS] A schema ready
- [PASS] A stopped: sigkill
- [PASS] seed A data: compatible with A schema
- [PASS] A read-back snapshot: hosts/settings/workspace/layout/vault readable
- [PASS] install B: /Users/runner/work/terminal/terminal/upgrade-current-interrupt/terminal-upgrade-T7wNOK/Applications/Termius.app
- [PASS] interrupted after backup: killed between snapshot-finished and core-schema-finished
- [PASS] interrupted mid-migration: committed id,name,hostname,port,username,auth_type,password,private_key,certificate,group_id,is_favorite,color,tags,port_forwards,startup_command,environment,jump_host_id,jump_host_auth_type,created_at,updated_at,agent_forwarding; missing shell_integration
- [PASS] pre-migration backup: /Users/runner/work/terminal/terminal/upgrade-current-interrupt/terminal-upgrade-T7wNOK/home/Library/Application Support/com.baicie.termius/backups/pre-migration-1793860257069.db
- [PASS] B migration: agent_forwarding,shell_integration
- [PASS] data integrity after B: field-by-field after interrupted recovery
- [PASS] interrupted migration recovery: relaunch converged and data verified
- [PASS] fault.FAULT_INJECTED
- [PASS] fault.ORIGINAL_DATA_PRESERVED
- [PASS] fault.NO_PARTIAL_MIGRATION
- [PASS] fault.RECOVERY_SUCCEEDED

## Schema

```json
{
  "beforeTables": [
    "command_history",
    "connection_logs",
    "groups",
    "hosts",
    "known_hosts",
    "port_forward_rules",
    "script_executions",
    "scripts",
    "settings",
    "snippet_packages",
    "snippets",
    "ssh_keys",
    "sync_queue",
    "team_audit_logs",
    "team_invites",
    "team_members",
    "team_shared_hosts",
    "team_shared_snippets",
    "teams",
    "user_profile",
    "workspace_layouts",
    "workspaces"
  ],
  "beforeHostColumns": [
    "id",
    "name",
    "hostname",
    "port",
    "username",
    "auth_type",
    "password",
    "private_key",
    "certificate",
    "group_id",
    "is_favorite",
    "color",
    "tags",
    "port_forwards",
    "startup_command",
    "environment",
    "jump_host_id",
    "jump_host_auth_type",
    "created_at",
    "updated_at"
  ],
  "afterTables": [
    "command_history",
    "connection_logs",
    "groups",
    "hosts",
    "known_hosts",
    "port_forward_rules",
    "script_executions",
    "scripts",
    "settings",
    "snippet_packages",
    "snippets",
    "ssh_keys",
    "sync_queue",
    "team_audit_logs",
    "team_invites",
    "team_members",
    "team_shared_hosts",
    "team_shared_snippets",
    "teams",
    "user_profile",
    "workspace_layouts",
    "workspaces"
  ],
  "afterHostColumns": [
    "id",
    "name",
    "hostname",
    "port",
    "username",
    "auth_type",
    "password",
    "private_key",
    "certificate",
    "group_id",
    "is_favorite",
    "color",
    "tags",
    "port_forwards",
    "startup_command",
    "environment",
    "jump_host_id",
    "jump_host_auth_type",
    "created_at",
    "updated_at",
    "agent_forwarding",
    "shell_integration"
  ],
  "addedHostColumns": [
    "agent_forwarding",
    "shell_integration"
  ]
}
```

## NOT_RUN

- real Vault master-password unlock (requires interactive credential; file persistence is asserted only)
- incompatible-schema downgrade refusal (dev.1 reads the additive current schema; a non-additive future schema is not tested)
- Linux and Windows adapters (NOT_RUN in this first implementation)
- Gatekeeper / notarization / Authenticode (BLOCKED_EXTERNAL)
- disk-full (read-only data directory is covered; installer media read-only is not)

Evidence directory: /Users/runner/work/terminal/terminal/upgrade-current-interrupt/terminal-upgrade-T7wNOK
