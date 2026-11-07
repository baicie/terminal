# Two-version upgrade report

- Status: **PASS**
- Platform: darwin
- A: 0.0.1-dev.1 (73cf7483e912af33)
- B: 0.0.1-dev.3-local (66f2465d44bb3e8e)
- Fault mode: corrupt-db

## Checks

- [PASS] A metadata: 0.0.1-dev.1 73cf7483e912af33
- [PASS] B metadata: 0.0.1-dev.3-local 66f2465d44bb3e8e
- [PASS] install A: /tmp/phase95-fault-corrupt5/terminal-upgrade-p3FVuq/Applications/Termius.app
- [PASS] A database created: /tmp/phase95-fault-corrupt5/terminal-upgrade-p3FVuq/home/Library/Application Support/com.baicie.termius/terminal.db
- [PASS] A schema ready
- [PASS] A stopped: sigkill
- [PASS] seed A data: compatible with A schema
- [PASS] A read-back snapshot: hosts/settings/workspace/layout/vault readable
- [PASS] install B: /tmp/phase95-fault-corrupt5/terminal-upgrade-p3FVuq/Applications/Termius.app
- [PASS] corrupt DB preserved: ef5bbdadad856776 -> ef5bbdadad856776
- [PASS] corruption detected by the app: app log: file is not a database

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
  "afterTables": null,
  "afterHostColumns": null,
  "addedHostColumns": null
}
```

## NOT_RUN

- real Vault master-password unlock (requires interactive credential; file persistence is asserted only)
- rollback B->A (no product rollback state machine; pre-migration backup readability is asserted)
- Linux and Windows adapters (NOT_RUN in this first implementation)
- Gatekeeper / notarization / Authenticode (BLOCKED_EXTERNAL)
- disk-full (read-only data directory is covered; installer media read-only is not)

Evidence directory: /tmp/phase95-fault-corrupt5/terminal-upgrade-p3FVuq
