use serde_json::Value;

#[test]
fn csp_allows_configured_http_endpoints_without_wildcards() {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .expect("tauri.conf.json should be valid JSON");
    let csp = config["app"]["security"]["csp"]
        .as_str()
        .expect("Tauri CSP should be a string");
    let connect_sources: Vec<_> = csp
        .split(';')
        .map(str::trim)
        .find(|directive| directive.starts_with("connect-src "))
        .expect("CSP should define connect-src")
        .split_whitespace()
        .skip(1)
        .collect();

    for source in [
        "'self'",
        "ipc:",
        "http://ipc.localhost",
        "https://ipc.localhost",
        "http:",
        "https:",
    ] {
        assert!(
            connect_sources.contains(&source),
            "connect-src should allow {source}"
        );
    }
    assert!(
        !connect_sources.contains(&"*"),
        "connect-src must stay scoped"
    );
}

#[test]
fn file_dialog_capability_only_grants_selected_file_operations() {
    let capability: Value = serde_json::from_str(include_str!("../capabilities/default.json"))
        .expect("default capability should be valid JSON");
    let permissions = capability["permissions"]
        .as_array()
        .expect("default capability should list permissions");
    let identifiers: Vec<_> = permissions
        .iter()
        .filter_map(|permission| {
            permission
                .as_str()
                .or_else(|| permission["identifier"].as_str())
        })
        .collect();

    for permission in [
        "dialog:allow-open",
        "dialog:allow-save",
        "fs:allow-read-text-file",
        "fs:allow-write-text-file",
    ] {
        assert!(
            identifiers.contains(&permission),
            "default capability should include {permission}"
        );
    }
    assert!(
        identifiers.iter().all(|permission| {
            !permission.starts_with("fs:scope")
                && !matches!(
                    *permission,
                    "fs:default"
                        | "fs:read-all"
                        | "fs:write-all"
                        | "fs:read-files"
                        | "fs:write-files"
                )
        }),
        "file dialogs must not grant a broad filesystem scope"
    );
}
