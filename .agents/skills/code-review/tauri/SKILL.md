---
name: code-review-tauri
description: Code review skill for Tauri projects (Rust backend + web frontend). Covers Tauri command design, IPC between Rust and TypeScript, security capabilities, Rust + TypeScript integration, and cross-layer patterns. Use when reviewing Tauri applications or when the user asks for a code review of a Tauri project.
---

# Code Review — Tauri (Rust + Web)

Framework-specific skill for Tauri applications combining Rust backend and web frontend.

## Review Dimensions

### 1. Tauri Command Design

- [ ] Commands use `#[tauri::command]` or `#[command]`
- [ ] Command handlers are async (`async fn`) for I/O operations
- [ ] No blocking operations in command handlers (offload to `tokio::spawn_blocking`)
- [ ] Command inputs validated before use
- [ ] Command outputs are serializable (`serde`)
- [ ] Large payloads handled via streaming or chunked transfer (not full in-memory)
- [ ] Commands are idempotent where appropriate

### 2. IPC — Rust ↔ TypeScript

- [ ] Type consistency between Rust structs and TypeScript types
- [ ] Errors propagated from Rust to frontend as typed error enums (not generic strings)
- [ ] Frontend uses `invoke()` with correct argument types
- [ ] No `unwrap()` or `expect()` in Tauri commands (return `Result<T, E>`)
- [ ] Frontend handles invoke errors with proper type narrowing
- [ ] Event names consistent between Rust `emit` and frontend `listen`

### 3. Security Capabilities

- [ ] `tauri.conf.json` capabilities follow principle of least privilege
- [ ] No `allow-all` capabilities in production
- [ ] File system access scoped to specific directories
- [ ] Shell execution whitelisted (no broad shell access)
- [ ] No debug capabilities in release builds
- [ ] CSP headers configured in `tauri.conf.json`
- [ ] IPC channels validated on both sides

### 4. State & Lifetime Management

- [ ] App state (`AppHandle`, `State<T>`) used correctly
- [ ] No shared mutable state without synchronization
- [ ] `Arc<Mutex<T>>` or channels used for cross-thread communication
- [ ] State cleaned up on app close (drop implementations)
- [ ] Event listeners unregistered on component unmount (frontend)
- [ ] Rust side handles frontend window close events

### 5. Performance

- [ ] Large data transfers use streaming (not buffered entirely)
- [ ] Images, assets served from Rust with proper caching headers
- [ ] No heavy computation on the main thread (use `tokio::spawn`)
- [ ] Frontend uses virtualization for large lists
- [ ] Rust binary size considered (no unnecessary dependencies)
- [ ] WebView loads remote content over HTTPS

### 6. Project Conventions

- [ ] `src-tauri/` structure clean — no business logic in `main.rs`/`lib.rs`
- [ ] Tauri configuration versioned and validated
- [ ] Cargo workspace used for large projects
- [ ] Frontend bundler (Vite) configured for Tauri compatibility
- [ ] Cross-platform testing (Windows, macOS, Linux)
- [ ] Build targets appropriate for supported platforms

## Cross-Layer Patterns

### Correct — Typed IPC

```rust
// src-tauri/src/lib.rs
#[derive(Serialize, Deserialize)]
pub struct HostInfo {
    pub id: String,
    pub name: String,
    pub connected: bool,
}

#[tauri::command]
async fn get_hosts(state: State<'_, AppState>) -> Result<Vec<HostInfo>, String> {
    // ...
}
```

```typescript
// Frontend
const hosts = await invoke<HostInfo[]>('get_hosts')
```

### Incorrect — String-based IPC

```rust
// ❌ Stringly-typed errors — loses type information
#[tauri::command]
fn get_hosts() -> Result<String, String> {
    Err("Host not found".to_string())
}
```

### Correct — Event Streaming

```rust
// Rust emits events, frontend listens
app.emit("terminal-data", TerminalData { session_id, data })?;
```

```typescript
// Frontend subscribes and cleans up
useEffect(() => {
  const unlisten = listen<TerminalData>('terminal-data', handler)
  return () => { unlisten.then(fn => fn()) }
}, [])
```

## Common Pitfalls

- `unwrap()` in Tauri command → panic visible as cryptic error in frontend
- Forgetting to release Tauri resources → memory leak
- Large JSON serialization in IPC → slow cross-process communication
- Overly broad capability permissions → security risk
- Missing HTTPS for remote content in WebView

## Report Structure

Follow `COMMON.md` for the overall format. In the Tauri section, organize findings by:

1. Tauri Command Issues
2. IPC / Type Consistency Issues
3. Security Capability Issues
4. Cross-Layer Pattern Issues
5. Performance Issues
6. Convention Violations

## Additional Resources

- Common methodology: [](../COMMON.md)
- Framework checklist: [CHECKLIST.md](CHECKLIST.md)
- Correct/incorrect patterns: [PATTERNS.md](PATTERNS.md)
