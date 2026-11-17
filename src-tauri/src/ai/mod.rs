//! AI requests on the backend side of the IPC boundary.
//!
//! ## What this module is for
//!
//! `docs/design/terminal-next/07-ux4-ai-inspector.md` §4 requires the request to go
//! out from Rust over `reqwest` behind an `ai` feature, with typed IPC commands, and
//! requires that "ordinary frontend queries, the Extension API, logs and error
//! objects cannot return the key". The first implementation of UX-4 posted the
//! request from the WebView instead: the key was read out of the vault into
//! JavaScript memory, and the five pre-flight refusals lived in the same trust domain
//! as the thing they guarded.
//!
//! The whole module is behind the non-default `ai` feature. A build without it has no
//! model transport at all — not a disabled one, an absent one — and
//! `scripts/check-ai-isolation.mjs` proves that by looking for this module's symbols
//! and for `reqwest` in the default dependency graph.
//!
//! ## What stays in the frontend, and why
//!
//! The context review UI, the approval, the run state machine and rendering stay
//! where the user is. What moved is everything that touches the network or the key:
//! the profile row is re-read here (including `enabled`, the endpoint and the
//! limits), the key is read here, the prompt is built here, and the SSE stream is
//! parsed here. The frontend sends a `profile_id`, an action, the approved text and
//! its digest — nothing else.
//!
//! ## The commands, and the one that is deliberately absent
//!
//! - `ai_available` — is this build capable, and is a provider configured?
//! - `ai_profiles_list` — public fields only, never a reference or a key
//! - `ai_generate` — one run, streamed over a channel; refuses before sending
//! - `ai_cancel` — by `request_id`
//!
//! There is no `ai_read_secret(profile_id)`: a command that answered with a key would
//! rebuild exactly the exposure this module exists to remove.

mod digest;
mod endpoint;
mod profile;
mod prompt;
mod transport;

#[cfg(all(test, feature = "ai"))]
mod ipc_tests;
#[cfg(all(test, feature = "ai"))]
mod tests;

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};
use zeroize::Zeroizing;

pub use endpoint::{check_endpoint, EndpointVerdict};
pub use profile::ProfilePublic;
pub use prompt::AiAction;
pub use transport::{AiEvent, CancelFlag};

use crate::db_import::application_pool;
use crate::vault::{vault_read_secret, VaultReadError};

/// The hard ceiling on the text one request may carry.
///
/// Mirrors `MAX_CONTEXT_BYTES` in `packages/frontend/src/features/ai/context-review.ts`.
/// Checked again here, on the text that is about to be sent: the frontend's check
/// runs in the process this migration does not trust for it.
pub const MAX_CONTEXT_BYTES: usize = 64 * 1024;

/// The floor and ceiling for a stored `timeout_ms`, so a corrupt row cannot turn
/// into "no timeout at all" or "give up before the TCP handshake".
const MIN_TIMEOUT_MS: u64 = 1_000;
const MAX_TIMEOUT_MS: u64 = 300_000;

/// Why a run could not be attempted, or how it failed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiFailure {
    pub kind: AiFailureKind,
    /// A sentence for the user. Never contains the API key, the endpoint or a
    /// provider's response body.
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
}

impl AiFailure {
    pub fn new(kind: AiFailureKind) -> Self {
        Self {
            kind,
            message: kind.message().to_string(),
            retry_after_ms: None,
        }
    }

    fn with_message(kind: AiFailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            retry_after_ms: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AiFailureKind {
    Unauthorized,
    Forbidden,
    RateLimited,
    Timeout,
    Offline,
    BadResponse,
    NoProfile,
    ProfileUnusable,
    ContextNotApproved,
    ContextChanged,
    ContextTooLarge,
    Cancelled,
    /// The profile's stored key reference could not be used.
    KeyUnreadable,
    /// This build has no `ai` feature.
    FeatureDisabled,
    /// A run with this request id is already in flight.
    Busy,
}

impl AiFailureKind {
    pub fn message(self) -> &'static str {
        match self {
            AiFailureKind::Unauthorized => {
                "The API key was rejected. Check the key for this model profile."
            }
            AiFailureKind::Forbidden => "This key is not allowed to use this model.",
            AiFailureKind::RateLimited => {
                "The provider is rate limiting this key. Try again shortly."
            }
            AiFailureKind::Timeout => "The model did not answer in time.",
            AiFailureKind::Offline => "The provider could not be reached.",
            AiFailureKind::BadResponse => {
                "The provider returned a response this app could not read."
            }
            AiFailureKind::NoProfile => "Choose a model profile first.",
            AiFailureKind::ProfileUnusable => "That model profile cannot be used right now.",
            AiFailureKind::ContextNotApproved => "Review and approve the text before sending it.",
            AiFailureKind::ContextChanged => {
                "The text changed after you approved it. Review it again."
            }
            AiFailureKind::ContextTooLarge => "That selection is too large to send.",
            AiFailureKind::Cancelled => "Cancelled.",
            AiFailureKind::KeyUnreadable => {
                "The stored API key could not be read. Unlock the vault, or save the key again."
            }
            AiFailureKind::FeatureDisabled => "AI is not enabled in this build of the app.",
            AiFailureKind::Busy => "Another request is already running. Wait for it or cancel it.",
        }
    }
}

/// What the frontend sends to start a run.
///
/// Note what is **not** here: the endpoint, the model, the limits, the API key. Those
/// are read from the stored profile, so the request cannot carry a value that differs
/// from what the settings page last wrote.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    pub request_id: String,
    pub profile_id: String,
    pub action: prompt::AiAction,
    pub context: ApprovedContext,
}

/// The text the user approved, plus the digest they approved.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovedContext {
    pub text: String,
    /// The digest the frontend computed over `text` when the user approved it.
    pub content_sha256: String,
    pub approved: bool,
}

/// The outcome of `ai_generate` once the run has finished.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GenerateOutcome {
    /// Whether anything was sent. A refusal happens before the socket opens.
    pub sent: bool,
    /// Why nothing was sent, or how the run failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<AiFailure>,
}

/// The runs in flight, so `ai_cancel` can find one by id.
///
/// One entry per request id rather than one global flag: two docks (or a dock and a
/// future surface) must not cancel each other, and a late cancel for a finished run
/// must be a no-op rather than tripping the flag of the next one.
#[derive(Default)]
pub struct AiRuns {
    in_flight: parking_lot::Mutex<HashMap<String, CancelFlag>>,
}

impl AiRuns {
    /// Register a run, or report that the id is taken.
    ///
    /// `None` is not a nicety. `insert` would replace the flag the earlier run is
    /// watching, and from that moment `ai_cancel` for that id trips a flag nobody reads
    /// while the real run keeps streaming — a Cancel button that reports success and
    /// does nothing. Refusing the duplicate makes the collision visible to the caller
    /// instead.
    ///
    /// The ids are generated by the frontend (`ai-run-<n>`), so a duplicate means two
    /// surfaces picked the same one. Refusing is the honest answer: the second run did
    /// not start, and no cancel will be lost for either.
    fn register(&self, request_id: &str) -> Option<CancelFlag> {
        let mut in_flight = self.in_flight.lock();
        if in_flight.contains_key(request_id) {
            return None;
        }
        let flag = CancelFlag::new();
        in_flight.insert(request_id.to_string(), flag.clone());
        Some(flag)
    }

    fn finish(&self, request_id: &str) {
        self.in_flight.lock().remove(request_id);
    }

    fn cancel(&self, request_id: &str) -> bool {
        match self.in_flight.lock().get(request_id) {
            Some(flag) => {
                flag.cancel();
                true
            }
            None => false,
        }
    }
}

/// Is this build capable of sending, and is at least one profile configured?
#[tauri::command]
pub async fn ai_available<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let pool = application_pool(&app).await?;
    Ok(!profile::list(&pool).await?.is_empty())
}

/// Every configured profile, public fields only.
#[tauri::command]
pub async fn ai_profiles_list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<ProfilePublic>, String> {
    let pool = application_pool(&app).await?;
    profile::list(&pool).await
}

/// Cancel one run by id. A run id that is not in flight is not an error.
#[tauri::command]
pub fn ai_cancel(runs: State<'_, AiRuns>, request_id: String) -> bool {
    runs.cancel(&request_id)
}

/// Run one generation, streaming events over `on_event`.
///
/// The refusals are checked in this order, and each happens before a socket opens:
/// feature, approved, digest, size, profile existence, profile enabled, endpoint,
/// key readability. The returned outcome says whether anything was sent, so the
/// frontend can distinguish "refused" from "failed mid-answer".
#[tauri::command]
pub async fn ai_generate<R: Runtime>(
    app: AppHandle<R>,
    runs: State<'_, AiRuns>,
    request: GenerateRequest,
    on_event: Channel<AiEvent>,
) -> Result<GenerateOutcome, String> {
    // ---- the checks that need no I/O ----
    if !request.context.approved {
        return Ok(refused(AiFailureKind::ContextNotApproved));
    }
    // Recompute the digest over the text that will actually be sent. Trusting the
    // digest the caller supplied would make this check decorative.
    if digest::digest(&request.context.text) != request.context.content_sha256 {
        return Ok(refused(AiFailureKind::ContextChanged));
    }
    if request.context.text.is_empty() {
        // Not `context-too-large`: an empty selection is a different mistake with a
        // different fix, and reporting it as a size problem would send the user
        // looking for text to trim that is not there.
        return Ok(GenerateOutcome {
            sent: false,
            failure: Some(AiFailure::with_message(
                AiFailureKind::ContextNotApproved,
                "There is no text to send.",
            )),
        });
    }
    if request.context.text.len() > MAX_CONTEXT_BYTES {
        // The frontend measures UTF-8 bytes; `len()` on a `str` is that same number.
        return Ok(refused(AiFailureKind::ContextTooLarge));
    }
    if request.request_id.trim().is_empty() {
        return Err("a run needs a request id".to_string());
    }

    // ---- the profile, re-read rather than trusted ----
    let pool = application_pool(&app).await?;
    let Some(profile) = profile::load(&pool, &request.profile_id).await? else {
        return Ok(refused(AiFailureKind::NoProfile));
    };
    if !profile.enabled {
        return Ok(refused(AiFailureKind::ProfileUnusable));
    }
    match check_endpoint(&profile.endpoint) {
        EndpointVerdict::Allowed => {}
        EndpointVerdict::Refused(_) => {
            return Ok(refused(AiFailureKind::ProfileUnusable));
        }
    }
    if let Some(problem) = profile.secret_problem() {
        log::warn!("ai profile has an unusable key reference: {problem}");
        return Ok(refused(AiFailureKind::KeyUnreadable));
    }

    // ---- the key, read here and never returned ----
    let api_key = match profile.secret_key() {
        None => None,
        Some(key) => match vault_read_secret(&key) {
            Ok(value) => Some(Zeroizing::new(value)),
            Err(VaultReadError::NotFound) => {
                // A reference that points at nothing is damage, not "no key": a
                // local endpoint needs none, but a reference exists, so the user
                // configured one and expects it to be used.
                log::warn!("ai profile references a key the vault does not hold");
                return Ok(refused(AiFailureKind::KeyUnreadable));
            }
            Err(error) => {
                log::warn!("could not read the ai profile key: {}", error.kind());
                return Ok(refused(AiFailureKind::KeyUnreadable));
            }
        },
    };

    let timeout = Duration::from_millis(
        profile
            .timeout_ms
            .clamp(MIN_TIMEOUT_MS as i64, MAX_TIMEOUT_MS as i64) as u64,
    );
    let run_request = transport::RunRequest {
        endpoint: profile.endpoint.clone(),
        model_id: profile.model_id.clone(),
        temperature: profile.temperature,
        max_output_tokens: profile.max_output_tokens.clamp(1, 32_000),
        streaming: profile.streaming,
        timeout,
        api_key,
        action: request.action,
        text: request.context.text,
    };

    // Registered *before* the first byte so a Cancel that arrives while the request
    // is still resolving (DNS, TLS) is not lost.
    //
    // A duplicate id is refused rather than allowed to overwrite: replacing the flag
    // would leave the earlier run uncancellable. `sent: false` is accurate — nothing
    // has gone out for *this* attempt. The earlier run is untouched and still
    // cancellable under its own flag.
    let Some(cancel) = runs.register(&request.request_id) else {
        return Ok(GenerateOutcome {
            sent: false,
            failure: Some(AiFailure::new(AiFailureKind::Busy)),
        });
    };
    let emit_channel = on_event.clone();
    let emit = move |event: AiEvent| {
        // A send failure means the webview is gone. The run keeps going rather than
        // aborting, so the cleanup below still runs; there is just nobody to tell.
        let _ = emit_channel.send(event);
    };

    let outcome = transport::run(run_request, cancel, emit).await;
    runs.finish(&request.request_id);
    Ok(match outcome {
        Ok(()) => GenerateOutcome {
            sent: true,
            failure: None,
        },
        Err(failure) => GenerateOutcome {
            // Past this point the socket was opened, so "nothing was sent" would be
            // wrong even for a cancellation.
            sent: true,
            failure: Some(failure),
        },
    })
}

fn refused(kind: AiFailureKind) -> GenerateOutcome {
    GenerateOutcome {
        sent: false,
        failure: Some(AiFailure::new(kind)),
    }
}
