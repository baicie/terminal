//! Backup import payload.
//!
//! The exporter writes one JSON object per row, keyed by the database column
//! name. Every struct below therefore only declares the columns the import
//! writes: unknown keys are ignored and a missing key stays `None` (bound as
//! SQL NULL), so a backup produced by an older release still imports.
//!
//! Column and table identifiers never travel from the frontend: `writer` holds
//! the only place a table or column name is spelled out, and it spells all of
//! them as `&'static str` constants. Values are bound as parameters.

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::Value;

use super::secrets::{row_id, scan, ImportSecretReport, ScannedHost, ScannedKey};

/// Hard ceiling on the records one import may carry.
pub const MAX_RECORDS: usize = 50_000;
/// Hard ceiling on one import request, counted as JSON bytes.
pub const MAX_PAYLOAD_BYTES: usize = 32 * 1024 * 1024;

/// Rejections raised before a database connection is touched.
#[derive(Debug, thiserror::Error)]
pub enum PayloadError {
    #[error("import rejected: {records} records exceed the {limit} record limit")]
    TooManyRecords { records: usize, limit: usize },
    #[error("import rejected: payload of {bytes} bytes exceeds the {limit} byte limit")]
    TooLarge { bytes: usize, limit: usize },
    /// The file carries plaintext secrets and the caller did not say what to do
    /// with them. Nothing is written: an import that silently drops a password is
    /// a credential the user loses without ever being asked.
    #[error(
        "import rejected: the file carries {host_passwords} host password(s), \
         {host_private_keys} host private key(s), {ssh_key_private_keys} ssh key private key(s) \
         and {ssh_key_passphrases} ssh key passphrase(s) in plaintext; \
         choose to migrate them into the vault or discard them"
    )]
    SecretsNeedADecision {
        host_passwords: u64,
        host_private_keys: u64,
        ssh_key_private_keys: u64,
        ssh_key_passphrases: u64,
    },
    /// `migrate` means "the secret is now in *this* device's vault and the
    /// frontend read it back before building this payload". A row that still
    /// carries the plaintext contradicts that claim: the frontend failed to strip
    /// it, and writing it would put plaintext in SQLite.
    #[error(
        "import rejected: host `{id}` still carried a plaintext secret under the migrate policy; \
         write it to the vault and remove it from the payload first"
    )]
    SecretNotMigrated { id: String },
    /// Same rule for ssh keys. Separate id namespace so the error names the table.
    #[error(
        "import rejected: ssh key `{id}` still carried a plaintext secret under the migrate \
         policy; write it to the vault and remove it from the payload first"
    )]
    KeySecretNotMigrated { id: String },
    /// Under `migrate` every row whose secret moved must name the reference this
    /// device's vault now has. Without one the vault holds a secret nothing points
    /// at — indistinguishable from losing it.
    #[error(
        "import rejected: host `{id}` had a stored credential but no target-vault reference \
         under the migrate policy; pass the reference written with the secret"
    )]
    MissingBoundReference { id: String },
    #[error(
        "import rejected: ssh key `{id}` had a stored secret but no target-vault reference \
         under the migrate policy; pass the reference written with the secret"
    )]
    MissingBoundKeyReference { id: String },
    /// A reference that will be persisted must be one this build produced. A
    /// source device's reference names a vault key that does not exist here.
    #[error("import rejected: host `{id}` has a malformed target-vault credential reference")]
    MalformedBoundReference { id: String },
    #[error("import rejected: ssh key `{id}` has a malformed target-vault credential reference")]
    MalformedBoundKeyReference { id: String },
}

/// A reference the frontend supplies for *this* device's vault.
///
/// Validated here so the writer can bind it without trusting the shape. A
/// reference is metadata — `{kinds, provider, version}` — never a value.
pub fn parse_bound_ref(value: Option<&Value>) -> Option<String> {
    let text = match value {
        Some(Value::String(text)) => text.clone(),
        Some(other @ Value::Object(_)) => other.to_string(),
        _ => return None,
    };
    let parsed: Value = serde_json::from_str(&text).ok()?;
    if parsed.get("provider").and_then(Value::as_str) != Some("vault") {
        return None;
    }
    let kinds: Vec<&str> = parsed
        .get("kinds")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(Value::as_str)
        .filter(|kind| matches!(*kind, "password" | "privateKey" | "passphrase"))
        .collect();
    if kinds.is_empty() {
        return None;
    }
    // Re-serialise from the validated parts: an unexpected extra property cannot
    // ride along into the column.
    let version = parsed.get("version").and_then(Value::as_u64);
    let canonical = match version {
        Some(version) => serde_json::json!({
            "kinds": kinds,
            "provider": "vault",
            "version": version,
        }),
        None => serde_json::json!({ "kinds": kinds, "provider": "vault" }),
    };
    Some(canonical.to_string())
}

/// What to do with plaintext secrets found in an import file.
///
/// The default is [`SecretsPolicy::Reject`]: a caller that has not thought about
/// secrets does not get to import a file that has them. It is expressed as the
/// derive's default variant so "the default" cannot drift from "the first variant"
/// — the ordering is the policy.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum SecretsPolicy {
    /// Refuse the whole import and report the counts.
    #[default]
    Reject,
    /// The secrets are already in the vault; strip them from the rows and require
    /// a reference on every row that had one.
    Migrate,
    /// The user chose not to bring the secrets across. Strip them, store no
    /// reference, and report the hosts as needing a rebind.
    Discard,
}

fn parse_policy(raw: Option<&str>) -> SecretsPolicy {
    match raw {
        Some("migrate") => SecretsPolicy::Migrate,
        Some("discard") => SecretsPolicy::Discard,
        _ => SecretsPolicy::Reject,
    }
}

/// JSON bytes a single value contributes, without serialising it first.
fn value_bytes(value: Option<&Value>) -> usize {
    match value {
        None | Some(Value::Null) => 4,
        Some(Value::Bool(true)) => 4,
        Some(Value::Bool(false)) => 5,
        Some(Value::Number(number)) => number.to_string().len(),
        Some(Value::String(text)) => text.len() + 2,
        Some(Value::Array(items)) => {
            2 + items
                .iter()
                .map(|item| value_bytes(Some(item)) + 1)
                .sum::<usize>()
        }
        Some(Value::Object(map)) => {
            2 + map
                .values()
                .map(|item| value_bytes(Some(item)) + 8)
                .sum::<usize>()
        }
    }
}

/// Declares one row struct plus its byte accounting.
macro_rules! declare_row {
    ($name:ident { $($field:ident),* $(,)? }) => {
        #[derive(Debug, Default, Deserialize)]
        #[serde(default)]
        pub struct $name {
            $(pub $field: Option<Value>,)*
        }

        impl $name {
            fn byte_size(&self) -> usize {
                let mut total = 0;
                $(total += value_bytes(self.$field.as_ref());)*
                total
            }
        }
    };
}

declare_row!(GroupRow {
    id,
    name,
    parent_id,
    color,
    inherit_settings,
    settings,
    order,
});

declare_row!(HostRow {
    id,
    name,
    hostname,
    port,
    username,
    auth_type,
    password,
    private_key,
    certificate,
    credential_ref,
    bound_credential_ref,
    group_id,
    is_favorite,
    color,
    tags,
    port_forwards,
    startup_command,
    environment,
    jump_host_id,
    jump_host_auth_type,
    agent_forwarding,
    shell_integration,
    created_at,
    updated_at,
});

declare_row!(SnippetPackageRow {
    id,
    name,
    description
});

declare_row!(SnippetRow {
    id,
    name,
    description,
    script,
    package_id,
    tags,
    variables,
});

declare_row!(SshKeyRow {
    id,
    name,
    key_type,
    private_key,
    public_key,
    certificate,
    passphrase,
    credential_ref,
    bound_credential_ref,
    is_encrypted,
    created_at,
    updated_at,
});

declare_row!(KnownHostRow {
    id,
    hostname,
    port,
    fingerprint,
    key_type,
    added_at,
});

declare_row!(WorkspaceRow {
    id,
    name,
    description,
    icon,
    color,
    order,
    is_active,
    created_at,
    updated_at,
});

/// Workspace layouts are exported with camelCase keys, unlike the raw rows.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct WorkspaceLayoutRow {
    #[serde(rename = "workspaceId")]
    pub workspace_id: Option<Value>,
    #[serde(rename = "layoutData")]
    pub layout_data: Option<Value>,
}

impl WorkspaceLayoutRow {
    fn byte_size(&self) -> usize {
        value_bytes(self.workspace_id.as_ref()) + value_bytes(self.layout_data.as_ref())
    }
}

/// Everything one import carries. Field defaults keep a partial backup valid.
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ImportPayload {
    /// `merge` (default) or `replace`; anything else behaves like `merge`.
    pub merge_mode: String,
    /// Timestamp the frontend uses for `updated_at` rewrites, in ms.
    pub now: Option<i64>,
    /// What to do with plaintext secrets in the file: `reject` (default),
    /// `migrate` or `discard`. A payload without the field is rejected when it
    /// carries secrets, so an old frontend cannot quietly drop them.
    pub secrets: Option<String>,
    pub groups: Vec<GroupRow>,
    pub hosts: Vec<HostRow>,
    pub snippet_packages: Vec<SnippetPackageRow>,
    pub snippets: Vec<SnippetRow>,
    pub ssh_keys: Vec<SshKeyRow>,
    pub known_hosts: Vec<KnownHostRow>,
    pub workspaces: Vec<WorkspaceRow>,
    pub workspace_layouts: Vec<WorkspaceLayoutRow>,
    pub settings: BTreeMap<String, Value>,
}

impl ImportPayload {
    /// The secret-handling decision this payload carries.
    pub fn secrets_policy(&self) -> SecretsPolicy {
        parse_policy(self.secrets.as_deref())
    }

    /// Every plaintext secret in the file, counted per kind, with the row identities
    /// the migration needs. Never contains a value.
    pub fn scan_secrets(&self) -> ImportSecretReport {
        let hosts = self
            .hosts
            .iter()
            .map(|row| ScannedHost {
                id: row.id.as_ref(),
                name: row.name.as_ref(),
                password: row.password.as_ref(),
                private_key: row.private_key.as_ref(),
            })
            .collect::<Vec<_>>();
        let keys = self
            .ssh_keys
            .iter()
            .map(|row| ScannedKey {
                id: row.id.as_ref(),
                name: row.name.as_ref(),
                private_key: row.private_key.as_ref(),
                passphrase: row.passphrase.as_ref(),
            })
            .collect::<Vec<_>>();
        scan(&hosts, &keys)
    }

    /// Mirrors `mergeMode === 'replace'`: only the exact string replaces rows.
    pub fn is_replace(&self) -> bool {
        self.merge_mode == "replace"
    }

    /// Timestamp for `updated_at` rewrites; the frontend normally supplies it.
    pub fn now_ms(&self) -> i64 {
        self.now.unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_millis() as i64)
                .unwrap_or_default()
        })
    }

    pub fn record_count(&self) -> usize {
        self.groups.len()
            + self.hosts.len()
            + self.snippet_packages.len()
            + self.snippets.len()
            + self.ssh_keys.len()
            + self.known_hosts.len()
            + self.workspaces.len()
            + self.workspace_layouts.len()
            + self.settings.len()
    }

    pub fn byte_size(&self) -> usize {
        let rows = self.groups.iter().map(GroupRow::byte_size).sum::<usize>()
            + self.hosts.iter().map(HostRow::byte_size).sum::<usize>()
            + self
                .snippet_packages
                .iter()
                .map(SnippetPackageRow::byte_size)
                .sum::<usize>()
            + self
                .snippets
                .iter()
                .map(SnippetRow::byte_size)
                .sum::<usize>()
            + self
                .ssh_keys
                .iter()
                .map(SshKeyRow::byte_size)
                .sum::<usize>()
            + self
                .known_hosts
                .iter()
                .map(KnownHostRow::byte_size)
                .sum::<usize>()
            + self
                .workspaces
                .iter()
                .map(WorkspaceRow::byte_size)
                .sum::<usize>()
            + self
                .workspace_layouts
                .iter()
                .map(WorkspaceLayoutRow::byte_size)
                .sum::<usize>();
        let settings = self
            .settings
            .iter()
            .map(|(key, value)| key.len() + 2 + value_bytes(Some(value)) + 4)
            .sum::<usize>();
        rows + settings
    }

    /// Entry quota and the secret contract, both decided before any connection.
    ///
    /// The secret check is here rather than in the writer so a refusal happens
    /// before `BEGIN`: the user gets the counts to decide on, and no transaction
    /// has been opened that a rejection would have to roll back.
    pub fn validate(&self) -> Result<(), PayloadError> {
        let records = self.record_count();
        if records > MAX_RECORDS {
            return Err(PayloadError::TooManyRecords {
                records,
                limit: MAX_RECORDS,
            });
        }
        let bytes = self.byte_size();
        if bytes > MAX_PAYLOAD_BYTES {
            return Err(PayloadError::TooLarge {
                bytes,
                limit: MAX_PAYLOAD_BYTES,
            });
        }
        self.validate_secrets()
    }

    /// Enforce the secret policy against the rows as they arrived.
    ///
    /// Runs before `BEGIN`, so a refusal never leaves a transaction to roll back
    /// and the user gets the counts to decide on.
    fn validate_secrets(&self) -> Result<(), PayloadError> {
        let report = self.scan_secrets();
        let counts = &report.host_secrets;
        match self.secrets_policy() {
            SecretsPolicy::Reject => {
                if report.is_empty() {
                    return Ok(());
                }
                Err(PayloadError::SecretsNeedADecision {
                    host_passwords: counts.host_passwords,
                    host_private_keys: counts.host_private_keys,
                    ssh_key_private_keys: counts.ssh_key_private_keys,
                    ssh_key_passphrases: counts.ssh_key_passphrases,
                })
            }
            SecretsPolicy::Migrate => self.validate_migrated_secrets(&report),
            SecretsPolicy::Discard => Ok(()),
        }
    }

    /// The `migrate` contract, checked row by row.
    ///
    /// The invariant the frontend must satisfy: by the time it calls this command
    /// with `migrate`, every secret is already in this device's vault and read
    /// back, the payload carries no plaintext, and each such row names the
    /// reference it wrote. Anything else is a partial migration, and a partial
    /// migration is refused rather than written.
    fn validate_migrated_secrets(&self, report: &ImportSecretReport) -> Result<(), PayloadError> {
        // 1. No plaintext may survive under `migrate`.
        if let Some(host) = report.hosts.first() {
            return Err(PayloadError::SecretNotMigrated {
                id: host.id.clone(),
            });
        }
        if let Some(key) = report.keys.first() {
            return Err(PayloadError::KeySecretNotMigrated { id: key.id.clone() });
        }

        // 2. A row that says "the source device had a credential" must now name the
        //    reference this device's vault holds it under; otherwise the migration
        //    wrote a secret nothing points at. A row that claims nothing needs no
        //    reference, and one that carries only the file's own `credential_ref`
        //    is refused: that pointer belongs to the source device's vault.
        for row in &self.hosts {
            let id = row_id(row.id.as_ref());
            let declared = matches!(
                crate::db_import::secrets::imported_credential_ref(row.credential_ref.as_ref()),
                crate::db_import::secrets::ImportedCredentialRef::NeedsRebind { .. }
            );
            let bound = row
                .bound_credential_ref
                .as_ref()
                .filter(|value| !value.is_null());
            match (declared, bound) {
                (true, None) => return Err(PayloadError::MissingBoundReference { id }),
                (true, Some(value)) | (false, Some(value))
                    if parse_bound_ref(Some(value)).is_none() =>
                {
                    return Err(PayloadError::MalformedBoundReference { id })
                }
                _ => {}
            }
        }
        for row in &self.ssh_keys {
            let id = row_id(row.id.as_ref());
            // Same contract as hosts. Under `migrate` the plaintext is gone, so the
            // only record that a secret existed is the source device's description:
            // a row that describes one and names no binding would leave the vault
            // holding a key nothing points at.
            let declared = matches!(
                crate::db_import::secrets::imported_credential_ref(row.credential_ref.as_ref()),
                crate::db_import::secrets::ImportedCredentialRef::NeedsRebind { .. }
            );
            let bound = row
                .bound_credential_ref
                .as_ref()
                .filter(|value| !value.is_null());
            match (declared, bound) {
                (true, None) => return Err(PayloadError::MissingBoundKeyReference { id }),
                (_, Some(value)) if parse_bound_ref(Some(value)).is_none() => {
                    return Err(PayloadError::MalformedBoundKeyReference { id })
                }
                _ => {}
            }
        }
        Ok(())
    }
}
