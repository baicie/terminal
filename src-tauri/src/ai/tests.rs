//! The AI transport against a real loopback HTTP server.
//!
//! The design (§10) asks for exactly this: "a real local fake HTTP server covering
//! every status; Mock PASS and `REAL_MODEL_E2E` kept separate". Nothing here is a
//! mock of `reqwest` — the request is really sent, the server really answers, and the
//! SSE body really streams. What is fake is only the far end.
//!
//! The refusals are tested through [`super::ai_generate`] itself where they need a
//! database and a vault; the parts that need neither are tested at the unit level in
//! their own modules (digest, endpoint, prompt, profile).

use std::io::{BufRead, BufReader, Write as _};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;

use super::prompt::AiAction;
use super::transport::{self, AiEvent, CancelFlag, RunRequest};
use super::AiFailureKind;

/// What one request the server received looked like.
#[derive(Debug, Clone)]
struct Captured {
    request_line: String,
    headers: Vec<(String, String)>,
    body: String,
}

impl Captured {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    fn path(&self) -> &str {
        self.request_line.split_whitespace().nth(1).unwrap_or("")
    }
}

/// A one-shot HTTP server: accepts one connection, answers with `response`, and
/// reports what it received.
///
/// Hand-rolled rather than a framework: the point is to be a *real socket speaking
/// real HTTP* with no library between the test and the assertion, and the bodies here
/// are small enough that chunked parsing would be more code than the thing under test.
fn serve_once(response: String) -> (String, mpsc::Receiver<Captured>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let address = listener.local_addr().expect("addr");
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let Ok((stream, _)) = listener.accept() else {
            return;
        };
        let captured = read_request(&stream);
        let _ = tx.send(captured);
        let mut write = stream;
        // The response is small; a single write is enough for the client to parse,
        // and closing the socket after it is what ends a body without a length.
        let _ = write.write_all(response.as_bytes());
        let _ = write.flush();
    });
    (format!("http://{address}"), rx)
}

fn read_request(stream: &TcpStream) -> Captured {
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();
    let _ = reader.read_line(&mut request_line);
    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            headers.push((name.trim().to_string(), value.trim().to_string()));
        }
    }
    let length = headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = vec![0u8; length];
    if length > 0 {
        use std::io::Read as _;
        let _ = reader.read_exact(&mut body);
    }
    Captured {
        request_line,
        headers,
        body: String::from_utf8_lossy(&body).to_string(),
    }
}

fn sse_response(chunks: &[&str]) -> String {
    let mut body = String::new();
    for chunk in chunks {
        body.push_str(&format!(
            "data: {{\"choices\":[{{\"delta\":{{\"content\":{}}}}}]}}\n\n",
            serde_json::to_string(chunk).unwrap()
        ));
    }
    body.push_str("data: [DONE]\n\n");
    format!(
        "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}

/// Serve one SSE body, but write it in pieces at byte boundaries the caller chooses.
///
/// This is what makes a multi-byte UTF-8 character able to straddle two TCP reads,
/// which is the case a per-chunk `from_utf8_lossy` gets wrong. `connection: close` and
/// a short delay between writes keep the pieces from coalescing into one read.
fn serve_split(body: String, split_at: impl Fn(&[u8]) -> Vec<usize>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let address = listener.local_addr().expect("addr");
    let header = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        body.len()
    );
    let bytes = format!("{header}{body}").into_bytes();
    let boundaries = split_at(&bytes);
    thread::spawn(move || {
        let Ok((mut stream, _)) = listener.accept() else {
            return;
        };
        // Read the request so the client is not blocked writing it.
        let mut reader = BufReader::new(stream.try_clone().expect("clone"));
        let mut line = String::new();
        while reader.read_line(&mut line).unwrap_or(0) > 0 {
            if line.trim_end().is_empty() {
                break;
            }
            line.clear();
        }
        let mut start = 0usize;
        for boundary in boundaries {
            let end = boundary.min(bytes.len());
            if end <= start {
                continue;
            }
            let _ = stream.write_all(&bytes[start..end]);
            let _ = stream.flush();
            start = end;
            // A small gap so each write is its own read on the client side.
            thread::sleep(std::time::Duration::from_millis(15));
        }
        if start < bytes.len() {
            let _ = stream.write_all(&bytes[start..]);
        }
        let _ = stream.flush();
    });
    format!("http://{address}")
}

fn json_response(status: u16, reason: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status} {reason}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn request(endpoint: String, overrides: impl FnOnce(&mut RunRequest)) -> RunRequest {
    let mut request = RunRequest {
        endpoint,
        model_id: "test-model".to_string(),
        temperature: None,
        max_output_tokens: 64,
        streaming: true,
        timeout: std::time::Duration::from_secs(10),
        api_key: Some(zeroize::Zeroizing::new("sk-test-key".to_string())),
        action: AiAction::ExplainSelection,
        text: "kubectl get pods".to_string(),
    };
    overrides(&mut request);
    request
}

/// Run on the current-thread runtime the tests use.
fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime")
        .block_on(future)
}

fn collect(request: RunRequest) -> (Vec<AiEvent>, Option<super::AiFailure>) {
    let events = Arc::new(parking_lot::Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let outcome = block_on(transport::run(request, CancelFlag::new(), move |event| {
        sink.lock().push(event)
    }));
    let collected = events.lock().clone();
    (collected, outcome.err())
}

#[test]
fn a_streamed_answer_arrives_chunk_by_chunk_and_completes() {
    let (endpoint, received) = serve_once(sse_response(&["It lists ", "pods."]));
    let (events, failure) = collect(request(endpoint, |_| {}));
    assert!(failure.is_none(), "unexpected failure: {failure:?}");
    assert_eq!(
        events,
        vec![
            AiEvent::Chunk {
                text: "It lists ".into()
            },
            AiEvent::Chunk {
                text: "pods.".into()
            },
            AiEvent::Done,
        ]
    );

    let captured = received.recv().expect("the server saw a request");
    // The fixture endpoint is `http://host:port` with no path, so the adapter appends
    // only `/chat/completions`. The `/v1` spelling is pinned by
    // `the_completions_path_appends_to_the_endpoints_own_path` below.
    assert_eq!(captured.path(), "/chat/completions");
    assert_eq!(
        captured.header("authorization"),
        Some("Bearer sk-test-key"),
        "the key must reach the provider, from the backend"
    );
    let body: serde_json::Value = serde_json::from_str(&captured.body).expect("json body");
    assert_eq!(body["model"], "test-model");
    assert_eq!(body["stream"], true);
    assert_eq!(body["messages"].as_array().unwrap().len(), 2);
    // The untrusted text is in the user message, never the system one.
    assert!(body["messages"][1]["content"]
        .as_str()
        .unwrap()
        .contains("kubectl get pods"));
    assert!(!body["messages"][0]["content"]
        .as_str()
        .unwrap()
        .contains("kubectl get pods"));
    // The key never appears in the body.
    assert!(!captured.body.contains("sk-test-key"));
}

#[test]
fn a_non_streamed_answer_is_one_chunk_then_done() {
    let (endpoint, _received) = serve_once(json_response(
        200,
        "OK",
        r#"{"choices":[{"message":{"content":"hello"}}]}"#,
    ));
    let (events, failure) = collect(request(endpoint, |request| request.streaming = false));
    assert!(failure.is_none(), "unexpected failure: {failure:?}");
    assert_eq!(
        events,
        vec![
            AiEvent::Chunk {
                text: "hello".into()
            },
            AiEvent::Done
        ]
    );
}

#[test]
fn every_rejection_status_maps_onto_its_own_failure_kind() {
    let cases = [
        (401, "Unauthorized", AiFailureKind::Unauthorized),
        (403, "Forbidden", AiFailureKind::Forbidden),
        (429, "Too Many Requests", AiFailureKind::RateLimited),
        (500, "Internal Server Error", AiFailureKind::Offline),
        (503, "Service Unavailable", AiFailureKind::Offline),
        (404, "Not Found", AiFailureKind::BadResponse),
    ];
    for (status, reason, expected) in cases {
        // The body deliberately contains a key-shaped string: it must not reach the
        // failure the UI renders.
        let (endpoint, _received) = serve_once(json_response(
            status,
            reason,
            r#"{"error":"sk-test-key was rejected","echo":"kubectl get pods"}"#,
        ));
        let (events, failure) = collect(request(endpoint, |_| {}));
        let failure = failure.expect("a rejection must be a failure");
        assert_eq!(failure.kind, expected, "status {status}");
        assert!(
            !failure.message.contains("sk-test-key") && !failure.message.contains("kubectl"),
            "the provider body leaked into the message: {}",
            failure.message
        );
        assert!(matches!(
            events.last(),
            Some(AiEvent::Failed { failure: reported }) if reported.kind == expected
        ));
    }
}

#[test]
fn a_rate_limit_carries_retry_after_to_the_ui() {
    let (endpoint, _received) = serve_once(
        "HTTP/1.1 429 Too Many Requests\r\nretry-after: 45\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
            .to_string(),
    );
    let (_, failure) = collect(request(endpoint, |_| {}));
    let failure = failure.expect("429 is a failure");
    assert_eq!(failure.kind, AiFailureKind::RateLimited);
    assert_eq!(failure.retry_after_ms, Some(45_000));
}

#[test]
fn a_stream_that_ends_without_content_is_a_bad_response() {
    // 200 with only keep-alives: reporting this as a completed empty answer would
    // present a broken provider as a model with nothing to say.
    let (endpoint, _received) = serve_once(
        "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: 4\r\nconnection: close\r\n\r\n: ka".to_string(),
    );
    let (_, failure) = collect(request(endpoint, |_| {}));
    assert_eq!(
        failure.expect("empty stream").kind,
        AiFailureKind::BadResponse
    );
}

#[test]
fn an_unreachable_endpoint_is_offline_rather_than_a_panic() {
    // Bind and immediately drop, so the port is almost certainly closed.
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let address = listener.local_addr().expect("addr");
    drop(listener);
    let (_, failure) = collect(request(format!("http://{address}"), |_| {}));
    assert_eq!(failure.expect("refused").kind, AiFailureKind::Offline);
}

#[test]
fn a_request_timeout_is_reported_as_a_timeout() {
    // Accept the connection and never answer: the client's own budget must fire.
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let address = listener.local_addr().expect("addr");
    thread::spawn(move || {
        let stream = listener.accept();
        if let Ok(stream) = stream {
            // Hold the connection open without writing.
            thread::sleep(std::time::Duration::from_secs(5));
            drop(stream);
        }
    });
    let (_, failure) = collect(request(format!("http://{address}"), |request| {
        request.timeout = std::time::Duration::from_millis(300);
    }));
    assert_eq!(failure.expect("timeout").kind, AiFailureKind::Timeout);
}

#[test]
fn a_cancel_stops_the_stream_and_is_reported_as_cancelled() {
    let (endpoint, _received) = serve_once(sse_response(&["a", "b", "c", "d"]));
    let cancel = CancelFlag::new();
    // Trip it before the first chunk arrives: the run must not send anyway.
    cancel.cancel();
    let events = Arc::new(parking_lot::Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let outcome = block_on(transport::run(
        request(endpoint, |_| {}),
        cancel,
        move |event| sink.lock().push(event),
    ));
    let failure = outcome.expect_err("a cancelled run is not a success");
    assert_eq!(failure.kind, AiFailureKind::Cancelled);
    // Nothing was appended: a cancelled run produces no answer.
    assert!(events
        .lock()
        .iter()
        .all(|event| !matches!(event, AiEvent::Chunk { .. })));
}

#[test]
fn a_no_key_request_sends_no_authorization_header() {
    // A local model server needs no key, and sending `Bearer ` with an empty value
    // makes some servers reject the request.
    let (endpoint, received) = serve_once(json_response(
        200,
        "OK",
        r#"{"choices":[{"message":{"content":"ok"}}]}"#,
    ));
    let _ = collect(request(endpoint, |request| {
        request.api_key = None;
        request.streaming = false;
    }));
    let captured = received.recv().expect("request");
    assert_eq!(captured.header("authorization"), None);
}

#[test]
fn the_endpoint_path_tolerates_a_full_completions_url() {
    let (endpoint, received) = serve_once(json_response(
        200,
        "OK",
        r#"{"choices":[{"message":{"content":"ok"}}]}"#,
    ));
    let full = format!("{endpoint}/v1/chat/completions");
    let _ = collect(request(full, |request| request.streaming = false));
    let captured = received.recv().expect("request");
    // Not `/v1/chat/completions/chat/completions`.
    assert_eq!(captured.path(), "/v1/chat/completions");
}

#[test]
fn a_multibyte_character_split_across_tcp_reads_is_not_corrupted() {
    // The bug this pins: decoding each chunk with `from_utf8_lossy` turns a UTF-8
    // sequence that straddles a read into two replacement characters. The frontend's
    // `TextDecoder({stream: true})` handled it; a naive port does not. The answer here
    // is Chinese, whose code points are three bytes each, so a split lands inside a
    // character easily.
    let answer = "错误：权限不足";
    let body_after_header = sse_response(&[answer]);
    // Split inside the JSON payload's UTF-8, a few bytes after the first delta's `“`
    // would be — found by searching for the answer's bytes so the split is certain to
    // be mid-character rather than at an arbitrary offset.
    let answer_bytes = answer.as_bytes();
    let split_at = |bytes: &[u8]| {
        let position = bytes
            .windows(answer_bytes.len())
            .position(|window| window == answer_bytes)
            .expect("the answer must be in the body");
        // One byte into the first character: `错` is E9 94 99, so this splits it.
        vec![position + 1]
    };
    let endpoint = serve_split(body_after_header, split_at);
    let (events, failure) = collect(request(endpoint, |_| {}));
    assert!(failure.is_none(), "unexpected failure: {failure:?}");
    let text: String = events
        .iter()
        .filter_map(|event| match event {
            AiEvent::Chunk { text } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(text, answer);
    assert!(
        !text.contains('\u{fffd}'),
        "a replacement character means the split corrupted the answer"
    );
}

#[test]
fn the_completions_path_appends_to_the_endpoints_own_path() {
    // A profile saved as `https://host/v1` must reach `/v1/chat/completions`, not
    // `/chat/completions`: the version segment is part of the user's endpoint.
    let (endpoint, received) = serve_once(json_response(
        200,
        "OK",
        r#"{"choices":[{"message":{"content":"ok"}}]}"#,
    ));
    let base = format!("{endpoint}/v1");
    let _ = collect(request(base, |request| request.streaming = false));
    let captured = received.recv().expect("request");
    assert_eq!(captured.path(), "/v1/chat/completions");
}
