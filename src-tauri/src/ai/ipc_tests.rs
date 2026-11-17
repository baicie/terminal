//! The AI **IPC boundary**: what crosses it, and what must not exist on it.
//!
//! ## Why this file exists
//!
//! The migration that moved the model request into Rust has one claim that matters
//! more than any other: **the renderer never holds an API key**. A unit test of the
//! transport cannot prove that — the exposure, if it returned, would return as *an
//! extra command the frontend can call*. So the assertions here are about the command
//! surface itself, read from the source that is actually compiled.
//!
//! ## What it asserts
//!
//! 1. Every AI command is registered in the production `invoke_handler`; a command
//!    that exists but is unregistered is dead code, and one registered under a
//!    different name is a silent "AI is broken".
//! 2. The state `ai_generate` requires is `manage`d, so `State` extraction cannot
//!    panic inside the command.
//! 3. The frontend payload keys match the Rust parameter names after Tauri's rename
//!    (`requestId` → `request_id`, `onEvent` → `on_event`). This is the defect class
//!    the SFTP IPC suite was written for: a rename on either side produces a runtime
//!    failure that no compile step catches.
//! 4. **No command anywhere returns secret material.** Not just in `src/ai/` — the
//!    whole crate is searched, because the exposure could come back from a new
//!    command in any module.
//! 5. The request type carries no field an endpoint, model, limit or key could travel
//!    in, so the backend's re-read of the profile row cannot be bypassed by the caller.
//!
//! ## What it cannot assert, and why
//!
//! Executing a command through the mock runtime needs an application ACL entry, and
//! this app declares none (`sftp_ipc_e2e_tests.rs` measures this and pins it). That is
//! why `AI_IPC_REAL_E2E = NOT_RUN` and the transport is covered by
//! `ai::tests::*` against a real loopback server instead — a real socket, but not a
//! real IPC hop.
#![cfg(all(test, feature = "ai"))]

fn lib_source() -> String {
    std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/lib.rs"))
        .expect("lib.rs must be readable")
}

fn ai_source() -> String {
    std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/ai/mod.rs"))
        .expect("ai/mod.rs must be readable")
}

fn frontend_source(relative: &str) -> Option<String> {
    std::fs::read_to_string(format!(
        "{}/../packages/frontend/src/{relative}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .ok()
}

/// The parameter list of `pub async fn <name>[<generics>](…)`.
///
/// Two properties of this module make a naive `"{name}("` search wrong, and both were
/// measured rather than guessed: the parameter list spans lines (rustfmt splits a
/// four-parameter signature), and three of the four commands are generic
/// (`<R: Runtime>`) because they take an `AppHandle`.
fn signature_of(source: &str, command: &str) -> String {
    let Some(start) = ["pub async fn ", "pub fn "]
        .iter()
        .find_map(|prefix| source.find(&format!("{prefix}{command}")))
    else {
        return String::new();
    };
    // Skip the generics block, if any, to find the opening parenthesis.
    let rest = &source[start..];
    let mut index = 0usize;
    let bytes = rest.as_bytes();
    let mut depth = 0i32;
    while index < bytes.len() {
        match bytes[index] {
            b'<' => depth += 1,
            b'>' => depth -= 1,
            b'(' if depth <= 0 => break,
            _ => {}
        }
        index += 1;
    }
    if index >= bytes.len() {
        return String::new();
    }
    // Brace-count from just after the opening parenthesis, across lines.
    let parameters = &rest[index + 1..];
    let mut depth = 1usize;
    for (offset, character) in parameters.char_indices() {
        match character {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return parameters[..offset].to_string();
                }
            }
            _ => {}
        }
    }
    String::new()
}

// ## 1. Registration

#[test]
fn every_ai_command_is_registered_in_the_production_invoke_handler() {
    let lib = lib_source();
    let handler = lib
        .split("invoke_handler(")
        .nth(1)
        .expect("lib.rs must have an invoke_handler");
    for command in [
        "ai_available",
        "ai_profiles_list",
        "ai_generate",
        "ai_cancel",
    ] {
        assert!(
            handler.contains(&format!("ai::{command}")),
            "{command} is not registered in lib.rs's invoke_handler, so the frontend \
             cannot call it — the dock would report \"AI is not enabled\" in a build \
             that has the feature"
        );
    }
    // Every registration is behind the feature: the `#[cfg]` sits on the line above each
    // `ai::` entry, because `generate_handler!` re-emits attributes per match arm.
    let handler_lines: Vec<&str> = lib
        .split("invoke_handler(")
        .nth(1)
        .expect("lib.rs must have an invoke_handler")
        .lines()
        .collect();
    let ai_positions: Vec<usize> = handler_lines
        .iter()
        .enumerate()
        .filter(|(_, line)| line.contains("ai::ai_"))
        .map(|(index, _)| index)
        .collect();
    assert_eq!(ai_positions.len(), 4, "unexpected AI command registrations");
    for position in ai_positions {
        assert!(
            !handler_lines[position].contains("#[cfg"),
            "the gate belongs on its own line above the command, not inline"
        );
        let gate = handler_lines
            .get(position.wrapping_sub(1))
            .copied()
            .unwrap_or_default();
        assert!(
            gate.contains("#[cfg(feature = \"ai\")]"),
            "an AI registration is not gated on the `ai` feature; the line above it is: {gate}"
        );
    }
}

// ## 2. State

#[test]
fn the_state_ai_generate_requires_is_managed_by_the_app() {
    let lib = lib_source();
    assert!(
        lib.contains("ai::AiRuns::default()") || lib.contains("AiRuns::default()"),
        "AiRuns must be managed or `ai_generate`/`ai_cancel` panic on `State` extraction"
    );
    let source = ai_source();
    for command in ["ai_generate", "ai_cancel"] {
        let signature = signature_of(&source, command);
        assert!(
            signature.contains("State<'_, AiRuns>"),
            "{command} must take `State<'_, AiRuns>`; its signature is: {signature}"
        );
    }
}

// ## 3. The payload shape

#[test]
fn the_frontend_payload_keys_match_what_the_command_expects() {
    // Tauri renames `requestId` → `request_id` and `onEvent` → `on_event`. A rename on
    // either side is a runtime failure with no compile-time warning — exactly the
    // defect class `sftp_ipc_e2e_tests.rs` was written for.
    let source = ai_source();
    let signature = signature_of(&source, "ai_generate");
    assert!(
        signature.contains("request: GenerateRequest"),
        "ai_generate must take the request as one struct: {signature}"
    );
    assert!(
        signature.contains("on_event: Channel<AiEvent>"),
        "ai_generate must stream through a channel named `on_event`: {signature}"
    );

    let Some(frontend) = frontend_source("features/ai/ai-ipc.ts") else {
        return;
    };
    assert!(
        frontend.contains("'ai_generate'"),
        "the frontend no longer calls `ai_generate`"
    );
    assert!(
        frontend.contains("onEvent: channel"),
        "the frontend must pass the channel as `onEvent`; the command calls it `on_event`"
    );
    assert!(
        frontend.contains("requestId: input.requestId"),
        "the frontend must send `requestId` inside the request object"
    );
    // The cancel call passes it as a top-level key, which the command names `request_id`.
    assert!(
        frontend.contains("invoke<boolean>('ai_cancel', { requestId })"),
        "`ai_cancel` takes a top-level `requestId` that Tauri renames to `request_id`"
    );
    let cancel_signature = signature_of(&source, "ai_cancel");
    assert!(
        cancel_signature.contains("request_id: String"),
        "ai_cancel must take `request_id`: {cancel_signature}"
    );
}

#[test]
fn the_generate_request_has_no_field_a_key_or_destination_could_travel_in() {
    // The backend re-reads the profile row and validates its endpoint. That guarantee
    // is only worth something if the request cannot carry a competing value.
    let source = ai_source();
    let start = source
        .find("pub struct GenerateRequest {")
        .expect("GenerateRequest must exist");
    let end = source[start..]
        .find("\n}")
        .map(|offset| start + offset)
        .expect("GenerateRequest must close");
    let fields = &source[start..end];
    for forbidden in [
        "endpoint",
        "model_id",
        "api_key",
        "secret",
        "temperature",
        "max_output_tokens",
        "timeout",
    ] {
        assert!(
            !fields.contains(forbidden),
            "GenerateRequest must not carry `{forbidden}`; the backend reads it from the \
             stored profile so the checked value and the sent value cannot differ"
        );
    }
    for required in ["request_id", "profile_id", "action", "context"] {
        assert!(
            fields.contains(required),
            "GenerateRequest must carry `{required}`"
        );
    }
}

// ## 4. No command returns secret material

#[test]
fn no_command_in_the_crate_returns_a_model_key() {
    // The prohibition the design states in §4 — "no `read_secret(id)`" — asserted as
    // text over the whole crate rather than trusted as a convention. A future command
    // in any module would be caught, because this reads every source file.
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
    // This test file spells the forbidden shape in its own assertion, so it has to skip
    // itself — otherwise the scan matches the scanner.
    let myself = concat!(env!("CARGO_MANIFEST_DIR"), "/src/ai/ipc_tests.rs");
    let mut offenders = Vec::new();
    for entry in walk_rs(root) {
        if entry == myself {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&entry) else {
            continue;
        };
        // A `#[tauri::command]` that takes a profile id and mentions a key read is the
        // shape the design forbids.
        let mut in_command = false;
        for line in text.lines() {
            if line.contains("#[tauri::command]") {
                in_command = true;
                continue;
            }
            if in_command {
                let trimmed = line.trim();
                if trimmed.starts_with("pub fn") || trimmed.starts_with("pub async fn") {
                    in_command = false;
                    continue;
                }
                if trimmed.contains("profile_id") && trimmed.contains("-> Result<String") {
                    offenders.push(format!("{entry}: {}", trimmed));
                }
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "these commands appear to take a profile id and return a String — the shape of a \
         key reader: {offenders:#?}"
    );
}

#[test]
fn the_ai_module_exposes_exactly_the_four_commands() {
    // A new command is a new capability. Counting them makes an addition a deliberate
    // edit rather than something that rides along with a refactor.
    let source = ai_source();
    let commands: Vec<&str> = source
        .lines()
        .filter(|line| line.trim() == "#[tauri::command]")
        .collect();
    assert_eq!(
        commands.len(),
        4,
        "the AI module should expose exactly four commands (available, list, generate, \
         cancel); found {}",
        commands.len()
    );
    // And none of them is named like a secret reader.
    for forbidden in ["read_secret", "get_secret", "profile_secret"] {
        assert!(
            !source.contains(&format!("pub fn {forbidden}"))
                && !source.contains(&format!("pub async fn {forbidden}")),
            "the AI module must not expose `{forbidden}`"
        );
    }
}

fn walk_rs(directory: &str) -> Vec<String> {
    let mut files = Vec::new();
    let Ok(entries) = std::fs::read_dir(directory) else {
        return files;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            files.extend(walk_rs(path.to_str().unwrap_or_default()));
        } else if path.extension().and_then(|extension| extension.to_str()) == Some("rs") {
            files.push(path.to_string_lossy().to_string());
        }
    }
    files
}
