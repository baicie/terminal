//! The OpenAI-compatible transport, on the backend side of the IPC boundary.
//!
//! ## What moved here, and what that buys
//!
//! Before this module the request was a `fetch` in the WebView: the API key was read
//! out of the vault into JavaScript memory, and the terminal text the user approved
//! was posted from the renderer. The design (§4) asks for the opposite — the renderer
//! must never see a key — so the socket, the SSE parse, the timeout and the key read
//! all live here.
//!
//! ## The rules this file keeps
//!
//! - **The key never appears in an error.** A provider error body can echo the
//!   request, and the request carries the user's terminal text. Every failure uses a
//!   sentence we wrote; the body is drained and dropped.
//! - **Cancellation stops reading.** A cancelled stream stops consuming the body,
//!   which closes the connection. A driver that finished "because it was almost done"
//!   keeps a token bill alive for an answer nobody will read.
//! - **A bad chunk is skipped, not fatal.** Providers send keep-alives, comments and
//!   occasional malformed deltas; discarding a good answer over one of those is worse
//!   than skipping it.
//! - **`[DONE]` ends the stream** without being treated as content.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use zeroize::Zeroizing;

use super::prompt::{build_messages, ChatCompletionBody};
use super::{AiAction, AiFailure, AiFailureKind};

/// How many bytes one completion may stream before it is cut off.
///
/// A runaway model is a cost problem, not a correctness one, but an unbounded
/// stream over a socket we opened is worth a ceiling. 8 MiB is far more than any
/// explanation needs.
pub const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

/// A cancellation flag the stream loop checks between chunks.
///
/// A shared atomic rather than a `Notify`: the loop has to decide "did the user
/// cancel?" at each boundary, and an atomic read is the non-blocking form of exactly
/// that question. `cancelled` is only ever set, never cleared.
#[derive(Debug, Default, Clone)]
pub struct CancelFlag(Arc<AtomicBool>);

impl CancelFlag {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// One event from the transport. Serialised to the frontend channel as-is.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiEvent {
    /// A piece of the answer.
    Chunk { text: String },
    /// The stream ended normally.
    Done,
    /// The run failed. `failure` carries a kind and our own sentence.
    Failed { failure: AiFailure },
}

/// What one run needs from the backend, already resolved from the stored profile.
pub struct RunRequest {
    pub endpoint: String,
    pub model_id: String,
    pub temperature: Option<f64>,
    pub max_output_tokens: i64,
    pub streaming: bool,
    pub timeout: Duration,
    /// `None` for a local endpoint that needs no key.
    pub api_key: Option<Zeroizing<String>>,
    pub action: AiAction,
    pub text: String,
}

/// Map an HTTP status onto the app's failure vocabulary.
pub fn failure_for_status(status: u16, retry_after_ms: Option<u64>) -> AiFailure {
    let kind = match status {
        401 => AiFailureKind::Unauthorized,
        403 => AiFailureKind::Forbidden,
        429 => AiFailureKind::RateLimited,
        408 | 504 => AiFailureKind::Timeout,
        code if code >= 500 => AiFailureKind::Offline,
        _ => AiFailureKind::BadResponse,
    };
    AiFailure {
        kind,
        message: kind.message().to_string(),
        retry_after_ms,
    }
}

/// Parse `Retry-After`, tolerating both the seconds form and the HTTP-date form.
///
/// The date form is parsed only when it is unambiguous: an unparsable header is
/// reported as absent rather than guessed at.
pub fn parse_retry_after(value: Option<&str>, now: chrono::DateTime<chrono::Utc>) -> Option<u64> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    if let Ok(seconds) = value.parse::<u64>() {
        return Some(seconds.saturating_mul(1000));
    }
    chrono::DateTime::parse_from_rfc2822(value)
        .ok()
        .map(|date| {
            let delta = date.with_timezone(&chrono::Utc) - now;
            delta.num_milliseconds().max(0) as u64
        })
}

/// One SSE line's meaning.
#[derive(Debug, PartialEq, Eq)]
pub enum SseLine {
    Data(String),
    Done,
    Ignore,
}

/// Split one SSE line into its data payload.
///
/// Providers send `data: {...}`, blank lines, comments starting with `:` and
/// keep-alives. Only data lines matter, and `[DONE]` is a terminator.
pub fn parse_sse_line(line: &str) -> SseLine {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with(':') {
        return SseLine::Ignore;
    }
    let Some(body) = trimmed.strip_prefix("data:") else {
        return SseLine::Ignore;
    };
    let body = body.trim();
    if body.is_empty() {
        return SseLine::Ignore;
    }
    if body == "[DONE]" {
        return SseLine::Done;
    }
    SseLine::Data(body.to_string())
}

/// The delta text in one streamed chunk, or `None` when there is none.
pub fn chunk_text(payload: &serde_json::Value) -> Option<&str> {
    payload
        .get("choices")?
        .get(0)?
        .get("delta")?
        .get("content")?
        .as_str()
        .filter(|text| !text.is_empty())
}

/// The whole message in a non-streamed response.
pub fn full_text(payload: &serde_json::Value) -> Option<&str> {
    payload
        .get("choices")?
        .get(0)?
        .get("message")?
        .get("content")?
        .as_str()
}

fn client(request_timeout: Duration) -> reqwest::Client {
    reqwest::Client::builder()
        // The whole-request budget, so a hung endpoint cannot pin a run. The
        // connect budget is separate and shorter: "nobody answered the TCP handshake"
        // should not consume the time the model was allowed to think.
        .timeout(request_timeout)
        .connect_timeout(request_timeout.min(Duration::from_secs(15)))
        // Redirects are followed only upward to https: a 302 from an https endpoint
        // to plain http would silently downgrade where the user's text goes.
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 3 {
                attempt.error("too many redirects")
            } else if attempt.url().scheme() == "https" {
                attempt.follow()
            } else {
                attempt.error("refusing a redirect away from https")
            }
        }))
        .build()
        .unwrap_or_default()
}

/// Send one request and stream its answer as [`AiEvent`]s through `emit`.
///
/// Returns the terminal failure when the run did not complete normally; the events
/// already emitted still stand (the caller's reducer decides what they mean).
pub async fn run(
    request: RunRequest,
    cancel: CancelFlag,
    emit: impl Fn(AiEvent),
) -> Result<(), AiFailure> {
    let body = ChatCompletionBody {
        model: request.model_id.clone(),
        messages: build_messages(request.action, &request.text),
        max_tokens: request.max_output_tokens,
        stream: request.streaming,
        temperature: request.temperature,
    };
    let url = super::endpoint::chat_completions_url(&request.endpoint);
    let http = client(request.timeout);

    let mut builder = http
        .post(&url)
        .header("content-type", "application/json")
        .json(&body);
    if let Some(key) = request.api_key.as_ref() {
        // `Zeroizing<String>` is dropped right after the header is built; the
        // header's own copy lives in the request, which is dropped with it.
        builder = builder.header("authorization", format!("Bearer {}", key.as_str()));
    }

    let response = builder
        .send()
        .await
        .map_err(|error| transport_failure(&error, &cancel))?;
    let status = response.status().as_u16();

    if !(200..300).contains(&status) {
        let retry_after = parse_retry_after(
            response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok()),
            chrono::Utc::now(),
        );
        // The body is drained so the connection can be reused, never surfaced.
        let mut response = response;
        while let Ok(Some(_)) = response.chunk().await {}
        let failure = failure_for_status(status, retry_after);
        emit(AiEvent::Failed {
            failure: failure.clone(),
        });
        return Err(failure);
    }

    if !request.streaming {
        let payload: serde_json::Value = response
            .json()
            .await
            .map_err(|_| AiFailure::new(AiFailureKind::BadResponse))?;
        let Some(text) = full_text(&payload) else {
            let failure = AiFailure::new(AiFailureKind::BadResponse);
            emit(AiEvent::Failed {
                failure: failure.clone(),
            });
            return Err(failure);
        };
        emit(AiEvent::Chunk {
            text: text.to_string(),
        });
        emit(AiEvent::Done);
        return Ok(());
    }

    // ---- streaming ----
    let mut response = response;
    // The buffer holds **bytes**, not a `String`. Decoding each chunk on its own is
    // wrong: a UTF-8 sequence can straddle two chunks, and `from_utf8_lossy` would turn
    // the split character into two replacement characters. The frontend's
    // `TextDecoder({stream: true})` handled this; a port that ignored it would corrupt
    // any non-ASCII answer that happened to land on a chunk boundary — exactly the kind
    // of bug that only shows up with real provider traffic. So bytes accumulate and
    // only a complete line is decoded, at which point a newline can never split a
    // character (multi-byte UTF-8 sequences contain no `0x0A` byte).
    let mut buffer: Vec<u8> = Vec::new();
    let mut bytes_seen = 0usize;
    let mut saw_content = false;

    loop {
        if cancel.is_cancelled() {
            let failure = AiFailure::new(AiFailureKind::Cancelled);
            emit(AiEvent::Failed {
                failure: failure.clone(),
            });
            return Err(failure);
        }
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(error) => {
                let failure = transport_failure(&error, &cancel);
                emit(AiEvent::Failed {
                    failure: failure.clone(),
                });
                return Err(failure);
            }
        };
        bytes_seen += chunk.len();
        if bytes_seen > MAX_RESPONSE_BYTES {
            let failure = AiFailure::new(AiFailureKind::BadResponse);
            emit(AiEvent::Failed {
                failure: failure.clone(),
            });
            return Err(failure);
        }
        buffer.extend_from_slice(&chunk);

        while let Some(newline) = buffer.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = buffer.drain(..=newline).collect();
            // A line that is not valid UTF-8 is skipped rather than fatal: it is one
            // malformed frame, and the answer received so far is still good.
            let Ok(line) = String::from_utf8(line) else {
                continue;
            };
            match parse_sse_line(&line) {
                SseLine::Done => {
                    emit(AiEvent::Done);
                    return Ok(());
                }
                SseLine::Data(json) => {
                    // One unparseable line mid-stream is not a reason to discard the
                    // answer already received.
                    let Ok(payload) = serde_json::from_str::<serde_json::Value>(&json) else {
                        continue;
                    };
                    if let Some(text) = chunk_text(&payload) {
                        saw_content = true;
                        emit(AiEvent::Chunk {
                            text: text.to_string(),
                        });
                    }
                }
                SseLine::Ignore => {}
            }
        }
    }

    if cancel.is_cancelled() {
        let failure = AiFailure::new(AiFailureKind::Cancelled);
        emit(AiEvent::Failed {
            failure: failure.clone(),
        });
        return Err(failure);
    }
    if !saw_content {
        // A 200 with an empty body or only keep-alives: the run produced nothing,
        // and reporting it as a completed empty answer would be a lie.
        let failure = AiFailure::new(AiFailureKind::BadResponse);
        emit(AiEvent::Failed {
            failure: failure.clone(),
        });
        return Err(failure);
    }
    emit(AiEvent::Done);
    Ok(())
}

/// Classify a transport error without ever echoing its text.
///
/// `reqwest::Error`'s `Display` can include the URL, which includes the endpoint the
/// user configured — useful to an attacker reading a screenshot, and not something a
/// message needs. A cancellation is checked first so a user's own Cancel is not
/// reported as a network fault.
fn transport_failure(error: &reqwest::Error, cancel: &CancelFlag) -> AiFailure {
    if cancel.is_cancelled() {
        return AiFailure::new(AiFailureKind::Cancelled);
    }
    if error.is_timeout() {
        return AiFailure::new(AiFailureKind::Timeout);
    }
    AiFailure::new(AiFailureKind::Offline)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_codes_map_onto_the_apps_vocabulary() {
        let cases = [
            (401, AiFailureKind::Unauthorized),
            (403, AiFailureKind::Forbidden),
            (404, AiFailureKind::BadResponse),
            (408, AiFailureKind::Timeout),
            (429, AiFailureKind::RateLimited),
            (500, AiFailureKind::Offline),
            (503, AiFailureKind::Offline),
            (504, AiFailureKind::Timeout),
        ];
        for (status, expected) in cases {
            assert_eq!(failure_for_status(status, None).kind, expected, "{status}");
        }
    }

    #[test]
    fn a_rate_limit_carries_its_retry_after_in_both_forms() {
        let now = chrono::DateTime::parse_from_rfc2822("Wed, 21 Oct 2015 07:28:00 GMT")
            .unwrap()
            .with_timezone(&chrono::Utc);
        assert_eq!(parse_retry_after(Some("30"), now), Some(30_000));
        assert_eq!(
            parse_retry_after(Some("Wed, 21 Oct 2015 07:28:20 GMT"), now),
            Some(20_000)
        );
        // A date in the past is "no wait", not a negative delay.
        assert_eq!(
            parse_retry_after(Some("Wed, 21 Oct 2015 07:27:00 GMT"), now),
            Some(0)
        );
        assert_eq!(parse_retry_after(Some("garbage"), now), None);
        assert_eq!(parse_retry_after(None, now), None);
        assert_eq!(parse_retry_after(Some(""), now), None);
    }

    #[test]
    fn sse_lines_are_classified_the_way_providers_send_them() {
        assert_eq!(
            parse_sse_line("data: {\"a\":1}"),
            SseLine::Data("{\"a\":1}".into())
        );
        assert_eq!(
            parse_sse_line("  data:   {\"a\":1}  "),
            SseLine::Data("{\"a\":1}".into())
        );
        assert_eq!(parse_sse_line("data: [DONE]"), SseLine::Done);
        assert_eq!(parse_sse_line("data:"), SseLine::Ignore);
        assert_eq!(parse_sse_line(": keep-alive"), SseLine::Ignore);
        assert_eq!(parse_sse_line(""), SseLine::Ignore);
        assert_eq!(parse_sse_line("event: ping"), SseLine::Ignore);
    }

    #[test]
    fn chunk_and_full_text_read_both_shapes() {
        let streamed: serde_json::Value =
            serde_json::from_str(r#"{"choices":[{"delta":{"content":"hi"}}]}"#).unwrap();
        assert_eq!(chunk_text(&streamed), Some("hi"));
        // An empty delta is not a chunk.
        let keep_alive: serde_json::Value =
            serde_json::from_str(r#"{"choices":[{"delta":{"content":""}}]}"#).unwrap();
        assert_eq!(chunk_text(&keep_alive), None);
        // A role-only first delta carries no content.
        let role_only: serde_json::Value =
            serde_json::from_str(r#"{"choices":[{"delta":{"role":"assistant"}}]}"#).unwrap();
        assert_eq!(chunk_text(&role_only), None);

        let whole: serde_json::Value =
            serde_json::from_str(r#"{"choices":[{"message":{"content":"hello"}}]}"#).unwrap();
        assert_eq!(full_text(&whole), Some("hello"));
    }

    #[test]
    fn a_failure_message_never_names_the_provider_body() {
        // The messages are ours; `message()` is the only source of text.
        let failure = failure_for_status(500, None);
        assert!(!failure.message.contains("http"));
        assert!(!failure.message.is_empty());
    }
}
