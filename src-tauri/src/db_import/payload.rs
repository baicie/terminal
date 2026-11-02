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

    /// Entry quota: refuse oversized requests instead of letting them allocate.
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
        Ok(())
    }
}
