//! B02 — the file-system capability must not be path-unrestricted.
//!
//! ## The defect this pins
//!
//! `capabilities/default.json` listed `fs:allow-read-text-file` and
//! `fs:allow-write-text-file` as bare strings. In Tauri 2 a permission with no
//! `allow` scope entry grants the command **for every path** — verified by reading the
//! capability file: `permissions` contained no objects at all, so no scope was
//! attached to anything.
//!
//! The app only reads files the user picked in a dialog or a fixed rc path, so a
//! path-unrestricted read is wider than any feature needs. It matters because it is
//! the difference between "a compromised renderer can read what the user chose" and
//! "a compromised renderer can read `~/.ssh/id_ed25519`".
//!
//! ## What is and is not a fix here
//!
//! The narrow scope below lists the rc files the shell-integration feature reads plus
//! the resource dir the app owns. Everything else — including every file the user
//! picks — arrives through the dialog plugin, which adds the selected path to the fs
//! scope at runtime. Removing the broad permission therefore does not remove the
//! feature; it removes the part of the surface the feature never used.

use std::fs;
use std::path::PathBuf;

fn capability() -> serde_json::Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("capabilities/default.json");
    serde_json::from_str(&fs::read_to_string(&path).expect("capability file"))
        .expect("capability is JSON")
}

/// The `permissions` entries that are objects with an `allow` scope.
fn scoped_permissions(cap: &serde_json::Value) -> Vec<&serde_json::Value> {
    cap["permissions"]
        .as_array()
        .expect("permissions array")
        .iter()
        .filter(|entry| entry.is_object())
        .collect()
}

#[test]
fn the_file_system_permissions_carry_a_path_scope() {
    let cap = capability();
    let scoped = scoped_permissions(&cap);
    assert!(
        !scoped.is_empty(),
        "no permission carries a scope, so fs:allow-read-text-file / \
         fs:allow-write-text-file are unrestricted for every path"
    );

    for identifier in ["fs:allow-read-text-file", "fs:allow-write-text-file"] {
        let entry = scoped
            .iter()
            .find(|entry| entry["identifier"] == identifier)
            .unwrap_or_else(|| {
                panic!(
                    "{identifier} must be declared as an object with an allow scope, \
                     not a bare string; scoped entries are {scoped:?}"
                )
            });
        let allow = entry["allow"].as_array().expect("allow array");
        assert!(!allow.is_empty(), "{identifier} has an empty allow scope");
        // Every scope entry has to name a path or a glob; an entry that names neither
        // is a silent wildcard.
        for rule in allow {
            assert!(
                rule["path"].is_string() || rule["path"].is_object(),
                "{identifier} has a scope rule without a path: {rule}"
            );
        }
    }
}

#[test]
fn the_scope_lists_the_rc_files_the_feature_reads() {
    // shell-rc.ts reads exactly these two. If the scope drops one, the feature breaks
    // in a way that looks like a missing file; if it keeps a broad `$HOME/**`, the
    // scope is decoration.
    let cap = capability();
    let rendered = serde_json::to_string(&scoped_permissions(&cap)).unwrap_or_default();
    for expected in [".bashrc", ".zshrc"] {
        assert!(
            rendered.contains(expected),
            "the fs scope must name {expected}; scope is {rendered}"
        );
    }
    assert!(
        !rendered.contains("\"$HOME/**\""),
        "a whole-home glob defeats the purpose of the scope: {rendered}"
    );
}

#[test]
fn the_sql_capability_is_not_default_plus_select() {
    // `sql:default` already includes select/execute against every loaded connection,
    // so keeping `sql:default` next to the explicit ones means the explicit ones say
    // nothing. The app talks to its own database only; the capability should say that
    // rather than inherit a bundle.
    let cap = capability();
    let raw = serde_json::to_string(&cap["permissions"]).unwrap_or_default();
    assert!(
        !raw.contains("\"sql:default\""),
        "sql:default grants more than this app uses and hides what it does grant"
    );
}
