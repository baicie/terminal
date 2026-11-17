//! Reading a model profile straight from the application database.
//!
//! ## Why the backend reads the row instead of trusting the request
//!
//! The frontend could send the endpoint, model id and limits with every generate
//! call, and the backend could pass them to `reqwest` unchanged. That would make
//! the IPC boundary decorative: the thing being validated would travel in the same
//! message as the validation. Instead the request carries only a `profile_id`, and
//! this module resolves the rest from SQLite — the same row the settings page wrote.
//!
//! What that buys, concretely: a profile switched off in Settings mid-run is refused
//! even if the dock still holds an older copy; an endpoint that fails the plaintext
//! check is refused even though the UI already checked it (the check that matters is
//! the one next to the socket); and the API key is found by the *stored* reference
//! rather than by an id the caller chose.
//!
//! ## The secret is located, never returned
//!
//! [`Profile::secret_key`] is the vault key a stored API key lives under, or `None`.
//! Nothing on this type can hold a key, so no code path here can leak one.

use serde::Serialize;
use sqlx::{Pool, Sqlite};

/// The columns the backend needs from `ai_model_profiles`.
///
/// Deliberately not `SELECT *`: a column added for a UI concern should not silently
/// become part of the AI request path.
const PROFILE_COLUMNS: &str = "id, name, provider, endpoint, model_id, temperature, \
     max_output_tokens, timeout_ms, streaming, secret_ref, enabled";

/// The highest reference version this build can resolve.
///
/// Mirrors `MAX_SUPPORTED_VERSION` in the frontend's `credential-ref.ts` and in
/// `db_import::payload`. A newer build's reference must not be read here either.
pub const MAX_SUPPORTED_VERSION: u64 = 1_000_000_000;

/// The version segment a pre-versioning reference resolves to.
const LEGACY_VERSION: u64 = 0;

/// One model profile, as stored.
#[derive(Debug, Clone)]
pub struct Profile {
    pub id: String,
    pub provider: String,
    pub endpoint: String,
    pub model_id: String,
    pub temperature: Option<f64>,
    pub max_output_tokens: i64,
    pub timeout_ms: i64,
    pub streaming: bool,
    pub enabled: bool,
    secret: SecretRef,
}

/// What a row's `secret_ref` said, after parsing.
#[derive(Debug, Clone, PartialEq, Eq)]
enum SecretRef {
    /// No key stored. Valid for a local endpoint.
    None,
    /// A readable reference.
    Key { version: u64 },
    /// A reference that cannot be trusted. Refused rather than treated as "no key":
    /// sending an unauthenticated request would turn a damaged row into a 401 the
    /// user cannot explain, exactly the ambiguity Phase 10.1 removed elsewhere.
    Damaged(&'static str),
}

impl Profile {
    /// The vault key a stored API key lives under, or `None` when there is none.
    ///
    /// The shape is the credential boundary's `model:<id>:<version>:password`;
    /// version 0 omits the segment, matching `vaultKey` in the frontend.
    pub fn secret_key(&self) -> Option<String> {
        match self.secret {
            SecretRef::Key { version } if version == LEGACY_VERSION => {
                Some(format!("model:{}:password", self.id))
            }
            SecretRef::Key { version } => Some(format!("model:{}:{version}:password", self.id)),
            SecretRef::None | SecretRef::Damaged(_) => None,
        }
    }

    /// Why the stored reference cannot be used, when that is the case.
    pub fn secret_problem(&self) -> Option<&'static str> {
        match self.secret {
            SecretRef::Damaged(reason) => Some(reason),
            _ => None,
        }
    }

    /// The public half — what a list command may return.
    pub fn public(&self) -> ProfilePublic {
        ProfilePublic {
            id: self.id.clone(),
            provider: self.provider.clone(),
            endpoint: self.endpoint.clone(),
            model_id: self.model_id.clone(),
            temperature: self.temperature,
            max_output_tokens: self.max_output_tokens,
            timeout_ms: self.timeout_ms,
            streaming: self.streaming,
            enabled: self.enabled,
            has_key: matches!(self.secret, SecretRef::Key { .. }),
        }
    }
}

/// A profile without its reference. This is the only profile shape that crosses
/// back to the frontend.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePublic {
    pub id: String,
    pub provider: String,
    pub endpoint: String,
    pub model_id: String,
    pub temperature: Option<f64>,
    pub max_output_tokens: i64,
    pub timeout_ms: i64,
    pub streaming: bool,
    pub enabled: bool,
    /// Whether a key is stored — answered without reading it.
    pub has_key: bool,
}

#[derive(sqlx::FromRow)]
struct ProfileRow {
    id: String,
    provider: String,
    endpoint: String,
    model_id: String,
    temperature: Option<f64>,
    max_output_tokens: i64,
    timeout_ms: i64,
    streaming: bool,
    secret_ref: Option<String>,
    enabled: bool,
    #[allow(dead_code)]
    name: String,
}

impl From<ProfileRow> for Profile {
    fn from(row: ProfileRow) -> Self {
        Self {
            secret: parse_secret_ref(row.secret_ref.as_deref()),
            id: row.id,
            provider: row.provider,
            endpoint: row.endpoint,
            model_id: row.model_id,
            temperature: row.temperature,
            max_output_tokens: row.max_output_tokens,
            timeout_ms: row.timeout_ms,
            streaming: row.streaming,
            enabled: row.enabled,
        }
    }
}

/// Parse a stored reference, distinguishing "none" from "damaged".
///
/// The same canonical shape the import boundary accepts: `provider: "vault"`, a
/// non-empty `kinds` array that must include `password`, and an optional `version`.
/// Anything else is damage, not absence.
fn parse_secret_ref(raw: Option<&str>) -> SecretRef {
    let Some(raw) = raw.map(str::trim).filter(|text| !text.is_empty()) else {
        return SecretRef::None;
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(raw) else {
        return SecretRef::Damaged("the reference is not valid JSON");
    };
    if parsed.get("provider").and_then(serde_json::Value::as_str) != Some("vault") {
        return SecretRef::Damaged("the reference names an unknown provider");
    }
    let kinds = parsed.get("kinds").and_then(serde_json::Value::as_array);
    let has_password = kinds.is_some_and(|kinds| {
        kinds
            .iter()
            .filter_map(serde_json::Value::as_str)
            .any(|kind| kind == "password")
    });
    if !has_password {
        // An API key is stored under `password`, so a reference that does not list
        // it points at nothing this feature can read.
        return SecretRef::Damaged("the reference does not include an API key");
    }
    match parsed.get("version") {
        None | Some(serde_json::Value::Null) => SecretRef::Key {
            version: LEGACY_VERSION,
        },
        Some(value) => match value.as_u64() {
            Some(version) if version <= MAX_SUPPORTED_VERSION => SecretRef::Key { version },
            Some(_) => SecretRef::Damaged("the reference was written by a newer version"),
            None => SecretRef::Damaged("the reference version is not a number"),
        },
    }
}

/// Read one profile, or `None` when the id is unknown.
pub async fn load(pool: &Pool<Sqlite>, profile_id: &str) -> Result<Option<Profile>, String> {
    let sql = format!("SELECT {PROFILE_COLUMNS} FROM ai_model_profiles WHERE id = ?");
    let row = sqlx::query_as::<_, ProfileRow>(&sql)
        .bind(profile_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("could not read the model profile: {error}"))?;
    Ok(row.map(Profile::from))
}

/// Every profile, public half only.
pub async fn list(pool: &Pool<Sqlite>) -> Result<Vec<ProfilePublic>, String> {
    let sql = format!("SELECT {PROFILE_COLUMNS} FROM ai_model_profiles ORDER BY created_at ASC");
    let rows = sqlx::query_as::<_, ProfileRow>(&sql)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("could not read the model profiles: {error}"))?;
    Ok(rows
        .into_iter()
        .map(|row| Profile::from(row).public())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_reference_is_absent_not_damaged() {
        assert_eq!(parse_secret_ref(None), SecretRef::None);
        assert_eq!(parse_secret_ref(Some("")), SecretRef::None);
        assert_eq!(parse_secret_ref(Some("   ")), SecretRef::None);
    }

    #[test]
    fn a_versioned_reference_names_the_versioned_vault_key() {
        let parsed = parse_secret_ref(Some(
            r#"{"kinds":["password"],"provider":"vault","version":3}"#,
        ));
        assert_eq!(parsed, SecretRef::Key { version: 3 });
    }

    #[test]
    fn an_unversioned_reference_uses_the_legacy_key_shape() {
        // Pre-10.1 keys carry no version segment; reconstructing them exactly is what
        // lets a profile saved by an older build keep working.
        let parsed = parse_secret_ref(Some(r#"{"kinds":["password"],"provider":"vault"}"#));
        assert_eq!(parsed, SecretRef::Key { version: 0 });
        let profile = Profile {
            id: "p-1".into(),
            provider: "local".into(),
            endpoint: "http://127.0.0.1:11434/v1".into(),
            model_id: "llama3".into(),
            temperature: None,
            max_output_tokens: 64,
            timeout_ms: 1000,
            streaming: false,
            enabled: true,
            secret: parsed,
        };
        assert_eq!(profile.secret_key().as_deref(), Some("model:p-1:password"));
        assert_eq!(profile.secret_problem(), None);
    }

    #[test]
    fn every_damaged_shape_is_reported_rather_than_read_as_no_key() {
        let cases = [
            ("not json at all", "not valid JSON"),
            (r#"{"kinds":["password"]}"#, "unknown provider"),
            (
                r#"{"kinds":["privateKey"],"provider":"vault"}"#,
                "does not include an API key",
            ),
            (
                r#"{"kinds":[],"provider":"vault"}"#,
                "does not include an API key",
            ),
            (
                r#"{"kinds":["password"],"provider":"vault","version":1000000001}"#,
                "newer version",
            ),
            (
                r#"{"kinds":["password"],"provider":"vault","version":"three"}"#,
                "not a number",
            ),
        ];
        for (raw, expected) in cases {
            let parsed = parse_secret_ref(Some(raw));
            assert!(
                matches!(parsed, SecretRef::Damaged(_)),
                "{raw} should be damaged, got {parsed:?}"
            );
            let profile = Profile {
                id: "p-1".into(),
                provider: "local".into(),
                endpoint: "http://127.0.0.1:11434/v1".into(),
                model_id: "llama3".into(),
                temperature: None,
                max_output_tokens: 64,
                timeout_ms: 1000,
                streaming: false,
                enabled: true,
                secret: parsed,
            };
            assert!(profile.secret_key().is_none());
            assert!(
                profile
                    .secret_problem()
                    .is_some_and(|reason| reason.contains(expected)),
                "expected a reason containing {expected:?}, got {:?}",
                profile.secret_problem()
            );
        }
    }

    #[test]
    fn the_public_half_has_no_reference_and_no_key() {
        let profile = Profile {
            id: "p-1".into(),
            provider: "openai-compatible".into(),
            endpoint: "https://api.example.com/v1".into(),
            model_id: "gpt".into(),
            temperature: Some(0.2),
            max_output_tokens: 512,
            timeout_ms: 30_000,
            streaming: true,
            enabled: true,
            secret: SecretRef::Key { version: 2 },
        };
        let public = profile.public();
        assert!(public.has_key);
        let json = serde_json::to_string(&public).expect("serialise");
        assert!(
            !json.contains("model:"),
            "the reference must not travel: {json}"
        );
        assert!(
            !json.contains("secret"),
            "no secret field may exist: {json}"
        );
    }
}
