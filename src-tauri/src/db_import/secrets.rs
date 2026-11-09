//! The import security boundary.
//!
//! No import path may put secret material into SQLite. The vault is the only
//! store of a secret, and the importer cannot reach it (it runs in the backend,
//! the vault is a separate file owned by the frontend's credential layer), so the
//! rule enforced here is narrower and absolute: **the writer never binds a value
//! to a secret column**.
//!
//! Two things make that rule hold rather than merely be intended:
//!
//! 1. The column lists in `writer` no longer contain `password`, `private_key` or
//!    `passphrase`. There is no placeholder for them, so a future edit cannot pass
//!    a value through without also editing the SQL.
//! 2. Every row is inspected on the way in (`scan_*`). A payload that carries a
//!    non-empty secret field is not silently imported-with-the-secret-dropped:
//!    it is classified, counted, and reported back to the frontend, which is what
//!    turns "the user's old backup had passwords" into a decision the user makes
//!    instead of a loss they discover at connect time.
//!
//! The classification distinguishes three states, because they need three
//! different answers:
//!
//! - `None`: the field is absent, null or empty. Nothing to migrate.
//! - `Legacy`: the field carries a value. A pre-Phase-10 backup, or a file made by
//!   hand. The user must be offered the migration.
//! - Nothing here accepts a ready-made `credential_ref` pointing at a *vault key*:
//!   a reference in a file describes the source device's vault. The target device
//!   has its own vault with its own master key, so a copied reference is not a
//!   credential, it is a broken pointer. See [`ImportedHostSecrets::rebind`].

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One secret-bearing field found in an import payload.
///
/// Carries no value: the whole point of this type is that a plan, a report and a
/// log line can name what will be migrated without reproducing it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretCount {
    /// Host `password` values.
    pub host_passwords: u64,
    /// Host `private_key` values.
    pub host_private_keys: u64,
    /// SSH key `private_key` values.
    pub ssh_key_private_keys: u64,
    /// SSH key `passphrase` values.
    pub ssh_key_passphrases: u64,
}

impl SecretCount {
    pub fn total(&self) -> u64 {
        self.host_passwords
            + self.host_private_keys
            + self.ssh_key_private_keys
            + self.ssh_key_passphrases
    }
}

/// Whether a secret field carries a value that would have been written.
///
/// Empty string and whitespace-only count as absent: an older exporter wrote `""`
/// for "no secret", and treating that as a password would report a migration the
/// user cannot act on.
fn carries_secret(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::String(text)) => !text.trim().is_empty(),
        // A non-string is not a secret this importer understands. Counting it as
        // one would over-report; ignoring it entirely would under-report a
        // malformed file. It is counted, because the safe direction for a security
        // counter is "says there is something there".
        Some(_) => true,
    }
}

/// The secrets one host row carries, as a classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostSecretPresence {
    pub password: bool,
    pub private_key: bool,
}

impl HostSecretPresence {
    pub fn any(&self) -> bool {
        self.password || self.private_key
    }
}

/// The secrets one ssh key row carries, as a classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SshKeySecretPresence {
    pub private_key: bool,
    pub passphrase: bool,
}

impl SshKeySecretPresence {
    pub fn any(&self) -> bool {
        self.private_key || self.passphrase
    }
}

pub fn host_presence(password: Option<&Value>, private_key: Option<&Value>) -> HostSecretPresence {
    HostSecretPresence {
        password: carries_secret(password),
        private_key: carries_secret(private_key),
    }
}

pub fn ssh_key_presence(
    private_key: Option<&Value>,
    passphrase: Option<&Value>,
) -> SshKeySecretPresence {
    SshKeySecretPresence {
        private_key: carries_secret(private_key),
        passphrase: carries_secret(passphrase),
    }
}

/// What the frontend must do about the secrets an import brought along.
///
/// Serialised into the import report so the UI can show a migration prompt
/// *before* the rows are written, not after the secrets are already lost.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSecretReport {
    /// Secrets stripped from host rows and not written anywhere.
    pub host_secrets: SecretCount,
    /// Per-host detail so the migration can name the rows it will touch. Ids and
    /// kinds only — never a value.
    pub hosts: Vec<ImportSecretHost>,
    /// Per-key detail, same contract.
    pub keys: Vec<ImportSecretKey>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSecretHost {
    pub id: String,
    pub name: String,
    pub password: bool,
    pub private_key: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSecretKey {
    pub id: String,
    pub name: String,
    pub private_key: bool,
    pub passphrase: bool,
}

impl ImportSecretReport {
    pub fn total(&self) -> u64 {
        self.host_secrets.total()
    }

    pub fn is_empty(&self) -> bool {
        self.total() == 0
    }
}

/// A row's identity for the per-row list. Falls back to an empty id so the count
/// and the list can never disagree about how many rows there are.
pub fn row_id(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

fn row_name(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        _ => String::new(),
    }
}

/// The credential reference column, as it arrives from a file.
///
/// A reference is *not* usable across devices, so import never stores one
/// verbatim. It is kept only long enough to answer "did the source device have a
/// credential at all?", which decides whether the imported host is reported as
/// "needs rebinding" or as "stores nothing".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportedCredentialRef {
    /// No reference, no kinds: the source device stored nothing for this host.
    None,
    /// The source device had a stored credential; the target must rebind it.
    NeedsRebind { kinds: Vec<String> },
}

/// Parse the `credential_ref` field of an incoming host row.
///
/// An unparseable value is still `NeedsRebind`: a damaged reference on the source
/// device says a credential existed, and dropping that fact would import the host
/// as "nothing stored" — which is exactly the silent downgrade the credential
/// boundary forbids. The kinds list may be empty in that case, and the UI says
/// "reconnect to set the credential" rather than naming a kind it cannot verify.
pub fn imported_credential_ref(value: Option<&Value>) -> ImportedCredentialRef {
    let text = match value {
        Some(Value::String(text)) if !text.trim().is_empty() => text,
        // A reference that arrived already parsed (a JSON object in the file).
        Some(other @ Value::Object(_)) => {
            return imported_credential_ref(Some(&Value::String(other.to_string())))
        }
        _ => return ImportedCredentialRef::None,
    };
    let parsed: Value = match serde_json::from_str(text) {
        Ok(parsed) => parsed,
        Err(_) => return ImportedCredentialRef::NeedsRebind { kinds: Vec::new() },
    };
    let provider = parsed.get("provider").and_then(Value::as_str);
    if provider != Some("vault") {
        // A reference to a provider this build does not have is not a reference
        // it can honour. Report it as needing rebinding rather than as absent.
        return ImportedCredentialRef::NeedsRebind { kinds: Vec::new() };
    }
    let kinds = parsed
        .get("kinds")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if kinds.is_empty() {
        ImportedCredentialRef::None
    } else {
        ImportedCredentialRef::NeedsRebind { kinds }
    }
}

/// Build the report from the rows an import is about to write.
///
/// Runs before any statement, so the counts in the report are the counts the
/// writer actually saw, not a second pass that could drift.
pub fn scan(
    hosts: &[(
        Option<&Value>,
        Option<&Value>,
        Option<&Value>,
        Option<&Value>,
    )],
    keys: &[(
        Option<&Value>,
        Option<&Value>,
        Option<&Value>,
        Option<&Value>,
    )],
) -> ImportSecretReport {
    let mut report = ImportSecretReport::default();

    for (id, name, password, private_key) in hosts {
        let presence = host_presence(*password, *private_key);
        if !presence.any() {
            continue;
        }
        if presence.password {
            report.host_secrets.host_passwords += 1;
        }
        if presence.private_key {
            report.host_secrets.host_private_keys += 1;
        }
        report.hosts.push(ImportSecretHost {
            id: row_id(*id),
            name: row_name(*name),
            password: presence.password,
            private_key: presence.private_key,
        });
    }

    for (id, name, private_key, passphrase) in keys {
        let presence = ssh_key_presence(*private_key, *passphrase);
        if !presence.any() {
            continue;
        }
        if presence.private_key {
            report.host_secrets.ssh_key_private_keys += 1;
        }
        if presence.passphrase {
            report.host_secrets.ssh_key_passphrases += 1;
        }
        report.keys.push(ImportSecretKey {
            id: row_id(*id),
            name: row_name(*name),
            private_key: presence.private_key,
            passphrase: presence.passphrase,
        });
    }

    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_empty_or_absent_field_is_not_a_secret() {
        for value in [
            None,
            Some(&json!(null)),
            Some(&json!("")),
            Some(&json!("   ")),
        ] {
            assert!(!carries_secret(value), "{value:?} is not a secret");
        }
    }

    #[test]
    fn a_non_empty_string_is_a_secret() {
        assert!(carries_secret(Some(&json!("hunter2"))));
    }

    #[test]
    fn a_non_string_value_counts_as_a_secret_rather_than_being_dropped() {
        // The safe direction for a security counter: say something is there.
        assert!(carries_secret(Some(&json!(42))));
    }

    #[test]
    fn a_reference_to_the_vault_needs_rebinding() {
        let value = json!(serde_json::to_string(
            &json!({"kinds": ["password"], "provider": "vault"})
        )
        .unwrap());
        assert_eq!(
            imported_credential_ref(Some(&value)),
            ImportedCredentialRef::NeedsRebind {
                kinds: vec!["password".to_string()]
            }
        );
    }

    #[test]
    fn a_damaged_reference_still_needs_rebinding() {
        // Dropping this to "no credential" would import the host as storing
        // nothing and hide that the source device had a secret.
        assert_eq!(
            imported_credential_ref(Some(&json!("not json at all"))),
            ImportedCredentialRef::NeedsRebind { kinds: Vec::new() }
        );
    }

    #[test]
    fn an_unknown_provider_needs_rebinding() {
        let value = json!(serde_json::to_string(
            &json!({"kinds": ["password"], "provider": "keychain"})
        )
        .unwrap());
        assert_eq!(
            imported_credential_ref(Some(&value)),
            ImportedCredentialRef::NeedsRebind { kinds: Vec::new() }
        );
    }

    #[test]
    fn an_absent_reference_is_none() {
        assert_eq!(imported_credential_ref(None), ImportedCredentialRef::None);
        assert_eq!(
            imported_credential_ref(Some(&json!(""))),
            ImportedCredentialRef::None
        );
        let empty =
            json!(serde_json::to_string(&json!({"kinds": [], "provider": "vault"})).unwrap());
        assert_eq!(
            imported_credential_ref(Some(&empty)),
            ImportedCredentialRef::None
        );
    }

    #[test]
    fn the_scan_counts_each_kind_separately_and_names_no_value() {
        let host_id = json!("h1");
        let host_name = json!("prod");
        let password = json!("hunter2");
        let key_id = json!("k1");
        let key_name = json!("work");
        let private_key = json!("-----BEGIN-----");
        let passphrase = json!("pp");

        let report = scan(
            &[(Some(&host_id), Some(&host_name), Some(&password), None)],
            &[(
                Some(&key_id),
                Some(&key_name),
                Some(&private_key),
                Some(&passphrase),
            )],
        );

        assert_eq!(report.host_secrets.host_passwords, 1);
        assert_eq!(report.host_secrets.host_private_keys, 0);
        assert_eq!(report.host_secrets.ssh_key_private_keys, 1);
        assert_eq!(report.host_secrets.ssh_key_passphrases, 1);
        assert_eq!(report.hosts.len(), 1);
        assert_eq!(report.hosts[0].id, "h1");
        assert_eq!(report.keys.len(), 1);
        assert_eq!(report.keys[0].id, "k1");

        // The report must be serialisable to the frontend without carrying a value.
        let json = serde_json::to_string(&report).unwrap();
        assert!(!json.contains("hunter2"));
        assert!(!json.contains("BEGIN"));
        assert!(!json.contains("\"pp\""));
    }
}
