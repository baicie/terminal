//! Issue #T19 — the SFTP **IPC boundary**: what it proves, and what it cannot.
//!
//! ## The gap this addresses
//!
//! `sftp_command_e2e_tests.rs` drives `staged_upload` and `receive_download` against a
//! real OpenSSH server and states its own limit:
//!
//! > The Tauri command wrapper itself (argument validation, `AppHandle` progress
//! > emission) is not exercised — that needs a running app. So this is
//! > **command-level**, not GUI-level.
//!
//! Between the frontend's `invoke('sftp_connect', { sessionId })` and those functions
//! sit four things the command-level suite cannot see: Tauri's payload deserialisation
//! (the `sessionId` -> `session_id` rename), the macro-generated wrapper, `State`
//! resolution, and error serialisation.
//!
//! ## What was measured, and why it changes the claim
//!
//! This file was written to drive those four through `tauri::test::mock_runtime`. It
//! does not work, and the reason is a real property of this app rather than a test bug:
//!
//!   * `mock_context` builds an empty ACL, so `invoke` is refused by the IPC authority
//!     with `"sftp_connect not allowed. Plugin not found"` **before** the command runs.
//!   * Using the real `generate_context!()` does not help: the generated app ACL
//!     manifest is `[]` — this app declares **no** application-command permissions, so
//!     production permits them by absence, and the mock runtime has no equivalent
//!     fallback.
//!
//! So `MOCK_IPC_SFTP_E2E` is **not achievable** without either giving every command an
//! ACL permission (a production security-surface change) or a running WebView. The
//! first is not this task's call; the second is the GUI suite.
//!
//! ## What this file therefore asserts
//!
//! The facts that are provable today, each of which would otherwise be an untested
//! assumption:
//!
//!   1. the commands are registered in the production `invoke_handler`;
//!   2. the state they require is `manage`d, so `State` extraction cannot panic;
//!   3. the IPC authority refuses an unpermitted application command with a structured
//!      error rather than executing it — observed, not assumed;
//!   4. the exact frontend payload shape (`sessionId`, camelCase) is pinned, so a rename
//!      in either direction fails here;
//!   5. the set of commands whose signature allows a mock-runtime test is enumerated, so
//!      adding `AppHandle` to one of them is a visible change.
//!
//! And the remaining gap is named: `MOCK_IPC_SFTP_E2E=NOT_ACHIEVABLE`,
//! `GUI_SFTP_REAL_E2E=NOT_RUN`.
#![cfg(all(test, feature = "gui-e2e"))]

use serde_json::json;

/// The SFTP commands, and whether their signature allows a `MockRuntime` invocation.
///
/// `AppHandle` defaults to the `Wry` runtime, so a command taking it cannot be
/// registered on `MockRuntime` without changing production signatures.
const SFTP_COMMANDS: &[(&str, bool)] = &[
    ("sftp_connect", true),
    ("sftp_list", true),
    ("sftp_cancel_transfer", true),
    ("sftp_mkdir", true),
    ("sftp_delete", true),
    ("sftp_rename", true),
    // These take `AppHandle` for progress emission.
    ("sftp_upload", false),
    ("sftp_download", false),
    ("sftp_local_checksum", false),
    ("sftp_remote_checksum", false),
];

fn sftp_source() -> String {
    std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/sftp.rs"))
        .expect("sftp.rs must be readable")
}

fn lib_source() -> String {
    std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/lib.rs"))
        .expect("lib.rs must be readable")
}

/// The parameter list of `pub async fn <name>(…)`, found by brace counting.
fn signature_of(source: &str, command: &str) -> String {
    let marker = format!("pub async fn {command}(");
    let Some(start) = source.find(&marker) else {
        return String::new();
    };
    let rest = &source[start + marker.len()..];
    let mut depth = 1usize;
    for (offset, character) in rest.char_indices() {
        match character {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return rest[..offset].to_string();
                }
            }
            _ => {}
        }
    }
    String::new()
}

// ## 1. Registration

#[test]
fn every_sftp_command_is_registered_in_the_production_invoke_handler() {
    let lib = lib_source();
    let handler = lib
        .split("invoke_handler(")
        .nth(1)
        .expect("lib.rs must have an invoke_handler");
    for (command, _) in SFTP_COMMANDS {
        assert!(
            handler.contains(command),
            "{command} is in the SFTP command list but not in lib.rs's invoke_handler, so the \
             frontend cannot call it at all"
        );
    }
}

// ## 2. State

#[test]
fn the_state_the_sftp_commands_require_is_managed_by_the_app() {
    // `sftp_connect` and friends take `tauri::State<'_, SharedStateType>`. `State`
    // extraction panics when the type is not managed, and that panic happens inside the
    // command — a user would see the window freeze rather than an error.
    let lib = lib_source();
    assert!(
        lib.contains(".manage(std::sync::Arc::clone(&shared_state))")
            || lib.contains(".manage(shared_state)"),
        "SharedStateType must be managed or every SFTP command panics at runtime"
    );
    // And each command's requirement is read from its own signature rather than assumed.
    // `sftp_cancel_transfer` and `sftp_local_checksum` genuinely take no state; the rest
    // do. Asserting a uniform shape would be an assertion about this table, not the
    // product.
    let source = sftp_source();
    let mut with_state = Vec::new();
    let mut without_state = Vec::new();
    for (command, _) in SFTP_COMMANDS {
        let signature = signature_of(&source, command);
        if signature.contains("SharedStateType") {
            with_state.push(*command);
        } else {
            without_state.push(*command);
        }
    }
    assert!(
        with_state.contains(&"sftp_connect"),
        "sftp_connect must take the shared state; it is the command that opens the session"
    );
    assert!(
        !without_state.is_empty(),
        "if every command now takes state, the exception list above is stale"
    );
}

// ## 3. The IPC authority actually refuses

#[test]
fn the_ipc_authority_refuses_an_unpermitted_application_command() {
    // Observed while building this suite: a mock context has an empty ACL, and `invoke`
    // returns `"sftp_connect not allowed. Plugin not found"` without running the command.
    // That is the security property worth pinning — an unpermitted command does not
    // execute — and it is the reason a mock-runtime *execution* test is impossible here.
    let app = tauri::test::mock_builder()
        .invoke_handler(tauri::generate_handler![crate::sftp::sftp_connect])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("the mock app must build");
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("the mock webview must build");

    let response = tauri::test::get_ipc_response(
        &webview,
        tauri::webview::InvokeRequest {
            cmd: "sftp_connect".into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().expect("a valid URL"),
            body: tauri::ipc::InvokeBody::Json(json!({ "sessionId": "x" })),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    );

    let error = response.expect_err("an unpermitted command must be refused");
    let message = error.to_string();
    assert!(
        message.contains("not allowed"),
        "the refusal must be the authority's, not a command error: {message}"
    );
    // The command body never ran: an empty session id would have produced a
    // `SessionNotFound`-shaped error instead.
    assert!(
        !message.to_lowercase().contains("session not found"),
        "the command executed despite lacking permission: {message}"
    );
}

#[test]
fn the_app_declares_no_application_command_permissions() {
    // This is *why* the mock runtime cannot execute the commands: production permits them
    // by absence rather than by an explicit ACL entry, and the mock runtime has no
    // equivalent default. If someone later adds explicit permissions, this test fails and
    // the mock-runtime execution test becomes possible — which is the point of pinning it.
    let manifest = concat!(env!("CARGO_MANIFEST_DIR"), "/gen/schemas/acl-manifests.json");
    let Ok(text) = std::fs::read_to_string(manifest) else {
        // The schema directory is generated by `tauri-build`; absent in a clean checkout.
        return;
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) else {
        return;
    };
    let app_permissions = parsed
        .get("__app-acl__")
        .and_then(|app| app.get("permissions"))
        .and_then(|permissions| permissions.as_object())
        .map(|map| map.len())
        .unwrap_or(0);
    assert_eq!(
        app_permissions, 0,
        "the app now declares application-command permissions; a mock-runtime execution \
         test may be possible — revisit `MOCK_IPC_SFTP_E2E`"
    );
}

// ## 4. The frontend payload shape

#[test]
fn the_frontend_payload_keys_match_what_the_commands_expect() {
    // Tauri renames `sessionId` -> `session_id`. A rename on either side (frontend
    // `session_id`, or command `sessionId`) is a silent "SFTP is broken" in the app.
    let source = sftp_source();
    for command in ["sftp_connect", "sftp_list"] {
        let signature = signature_of(&source, command);
        assert!(
            signature.contains("session_id: String"),
            "{command} must take `session_id`; the frontend sends `sessionId` and Tauri \
             performs the rename"
        );
    }
    // And the frontend really does send camelCase — read from its own source rather than
    // trusting this comment.
    let frontend = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../packages/frontend/src/service/sftp-transfer-channel.ts"
    ));
    if let Ok(frontend) = frontend {
        assert!(
            frontend.contains("sessionId"),
            "the frontend no longer sends `sessionId`; the rename contract changed"
        );
    }
}

// ## 5. The coverable set

#[test]
fn the_mock_runtime_coverable_set_is_what_this_file_says() {
    // If a command gains or loses `AppHandle`, the set of commands a future mock-runtime
    // test could drive changes. Failing here makes that a deliberate edit.
    let source = sftp_source();
    for (command, coverable) in SFTP_COMMANDS {
        let signature = signature_of(&source, command);
        assert!(!signature.is_empty(), "{command} signature not found in sftp.rs");
        let has_app_handle = signature.contains("AppHandle");
        assert_eq!(
            *coverable,
            !has_app_handle,
            "{command}: signature has AppHandle={has_app_handle} but the table says \
             coverable={coverable}"
        );
    }
}

#[test]
fn the_remaining_gap_is_named_rather_than_hidden() {
    // A test whose only job is to keep the claim honest in the code itself.
    let me = include_str!("sftp_ipc_e2e_tests.rs");
    assert!(me.contains("MOCK_IPC_SFTP_E2E=NOT_ACHIEVABLE"));
    assert!(me.contains("GUI_SFTP_REAL_E2E=NOT_RUN"));
}
