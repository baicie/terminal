//! Where a request may be sent.
//!
//! ## Why the endpoint rule lives on both sides
//!
//! The frontend checks it when a profile is saved and again before a run, so the UI
//! can explain a refusal. Neither of those is a boundary: both run in the process
//! that is compromised in the threat model this migration exists for. The check
//! below is the one next to the socket, and it is applied to the *stored* endpoint
//! rather than to a value from the request.
//!
//! ## The rule
//!
//! - `https` is allowed.
//! - plain `http` to loopback is allowed: a local model server on `127.0.0.1:11434`
//!   is a normal setup and the traffic never leaves the machine.
//! - plain `http` anywhere else is refused. The frontend can ask the user to confirm
//!   one, and records that confirmation by saving the profile; the transport layer
//!   still refuses, because "the user confirmed it once in a form" is not something a
//!   socket should infer from a saved row.

use reqwest::Url;

/// The verdict for one endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EndpointVerdict {
    Allowed,
    Refused(&'static str),
}

/// Loopback by name and by address, including the IPv6 form.
fn is_loopback(host: Option<&str>) -> bool {
    let Some(host) = host else { return false };
    let host = host.to_ascii_lowercase();
    if matches!(host.as_str(), "localhost" | "127.0.0.1" | "[::1]" | "::1") {
        return true;
    }
    // 127.0.0.0/8 — the whole range is loopback, not just .1
    host.strip_prefix("127.").is_some_and(|rest| {
        let parts: Vec<&str> = rest.split('.').collect();
        parts.len() == 3
            && parts
                .iter()
                .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
    })
}

/// Decide whether a request may be sent to `endpoint`.
pub fn check_endpoint(endpoint: &str) -> EndpointVerdict {
    let Ok(url) = Url::parse(endpoint) else {
        return EndpointVerdict::Refused("the endpoint is not a valid URL");
    };
    match url.scheme() {
        "https" => EndpointVerdict::Allowed,
        "http" => {
            if is_loopback(url.host_str()) {
                EndpointVerdict::Allowed
            } else {
                // The frontend may have stored this after the user confirmed it. The
                // transport layer still refuses: consent recorded earlier is not a
                // property of this request.
                EndpointVerdict::Refused("plain HTTP to a non-loopback endpoint is not allowed")
            }
        }
        _ => EndpointVerdict::Refused("only https and loopback http are supported"),
    }
}

/// The URL a profile's endpoint resolves to.
///
/// A user may paste either `https://host/v1` or `https://host/v1/chat/completions`.
pub fn chat_completions_url(endpoint: &str) -> String {
    let trimmed = endpoint.trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_is_allowed_and_cleartext_remote_is_not() {
        assert_eq!(
            check_endpoint("https://api.example.com/v1"),
            EndpointVerdict::Allowed
        );
        assert!(matches!(
            check_endpoint("http://api.example.com/v1"),
            EndpointVerdict::Refused(_)
        ));
    }

    #[test]
    fn loopback_http_is_allowed_in_every_spelling() {
        for endpoint in [
            "http://localhost:11434/v1",
            "http://127.0.0.1:8080/v1",
            "http://127.1.2.3:8080/v1",
            "http://[::1]:8080/v1",
        ] {
            assert_eq!(
                check_endpoint(endpoint),
                EndpointVerdict::Allowed,
                "{endpoint}"
            );
        }
    }

    #[test]
    fn a_hostname_that_merely_looks_like_loopback_is_refused() {
        // The failure mode a substring check would have: `127.0.0.1.evil.test`
        // contains `127.0.0.1`, and `localhost.evil.test` starts with `localhost`.
        for endpoint in [
            "http://127.0.0.1.evil.test/v1",
            "http://localhost.evil.test/v1",
            "http://127.0.0.1.evil.test:8080/v1",
        ] {
            assert!(
                matches!(check_endpoint(endpoint), EndpointVerdict::Refused(_)),
                "{endpoint} should be refused"
            );
        }
    }

    #[test]
    fn other_schemes_are_refused() {
        for endpoint in [
            "ftp://example.com/x",
            "file:///etc/passwd",
            "javascript:alert(1)",
        ] {
            assert!(
                matches!(check_endpoint(endpoint), EndpointVerdict::Refused(_)),
                "{endpoint}"
            );
        }
        assert!(matches!(
            check_endpoint("not a url"),
            EndpointVerdict::Refused(_)
        ));
    }

    #[test]
    fn the_completions_url_tolerates_both_conventions() {
        assert_eq!(
            chat_completions_url("https://h/v1"),
            "https://h/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("https://h/v1/"),
            "https://h/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("https://h/v1/chat/completions"),
            "https://h/v1/chat/completions"
        );
    }
}
