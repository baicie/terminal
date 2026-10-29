# Code Review Checklist — Tauri (Rust + Web)

Exhaustive per-dimension checklist for Tauri applications.

---

## 1. Tauri Command Design

- [ ] Commands declared with `#[tauri::command]` (not bare functions)
- [ ] Command handlers are `async fn` for I/O operations
- [ ] No blocking calls in async commands (use `tokio::spawn_blocking`)
- [ ] Command inputs validated before use (don't trust frontend)
- [ ] Command outputs derive `serde::Serialize`
- [ ] Large payloads transferred via events or streaming, not command returns
- [ ] Commands are idempotent where applicable
- [ ] Command naming consistent: `snake_case`
- [ ] No business logic in `lib.rs` / `main.rs` — use dedicated modules
- [ ] State injected via `State<T>` managed by `AppHandle`
- [ ] Commands return `Result<T, E>` where E implements `serde::Serialize`

---

## 2. IPC — Rust ↔ TypeScript

### Rust Side

- [ ] Typed payloads via `serde::Serialize` / `serde::Deserialize`
- [ ] Error enums serialized with variants that carry data
- [ ] Events emitted with typed payloads: `app.emit("event-name", payload)?`
- [ ] No raw JSON strings sent — use typed structs
- [ ] Frontend invoke calls wrapped in typed helper functions

### TypeScript Side

- [ ] `invoke<T>("command_name", args)` typed with expected return type
- [ ] Error narrowed via `error instanceof Object && 'kind' in error`
- [ ] Event listeners typed: `listen<T>("event-name", (event) => { ... })`
- [ ] Listeners cleaned up in `useEffect` return / `onUnmounted`
- [ ] No `.then()` on invoke without error handling

---

## 3. Security Capabilities

### tauri.conf.json

- [ ] No `"allow-all": true` capabilities in production
- [ ] File scope restricted: only needed directories
- [ ] Shell scope whitelisted: only specific commands
- [ ] Window creation controlled (no arbitrary window spawning)
- [ ] Dialogs scoped to specific types (open, save, message)
- [ ] Clipboard access scoped (read or write, not both unless needed)
- [ ] DevTools disabled in production (verify `build.devtools: false`)
- [ ] CSP header configured in `tauri.conf.json`

### IPC Security

- [ ] Rust validates all frontend inputs (never trust the client)
- [ ] Command arguments checked for type and range
- [ ] File paths sanitized (no `..` traversal)
- [ ] No `shellScope` with broad patterns

---

## 4. State & Lifetime Management

### Rust Side

- [ ] App state (`AppHandle`, `State<T>`) uses interior mutability correctly
- [ ] `Arc<Mutex<T>>` used for shared mutable state
- [ ] State dropped cleanly on app close (implement `Drop` if needed)
- [ ] `tauri::Emitter` / `tauri::Listener` cleaned up on window close
- [ ] No memory leaks from spawned tasks without cancellation
- [ ] `Configurable` trait implemented if app settings change at runtime

### Frontend Side

- [ ] `listen` returns `UnlistenFn` — called on component unmount
- [ ] No stale closures capturing old state
- [ ] Event listeners removed before re-adding (prevent duplicates)
- [ ] WebSocket / IPC connections closed on unmount
- [ ] `AbortController` used for cancellable fetch requests

---

## 5. Performance

- [ ] Large file operations streamed, not buffered in memory
- [ ] Images / assets served from Rust with caching headers
- [ ] Heavy Rust operations run on `tokio::spawn` (not blocking main thread)
- [ ] Frontend large lists virtualized (`@tanstack/react-virtual`)
- [ ] Code-splitting: Tauri commands imported dynamically where appropriate
- [ ] Rust binary size monitored (no unnecessary `Cargo.toml` dependencies)
- [ ] Remote content loaded over HTTPS in WebView
- [ ] `webviewInstallMode` considered for auto-updating WebView
- [ ] No blocking IPC calls in render-critical paths

---

## 6. Project Conventions

### Structure

- [ ] `src-tauri/src/` modules organized by domain (not flat)
- [ ] `src-tauri/tauri.conf.json` version-controlled
- [ ] Capabilities files in `src-tauri/capabilities/`
- [ ] Frontend in `src/` or `ui/` (Vite + React/TypeScript)
- [ ] Rust and frontend built via `tauri build`
- [ ] Multi-platform CI/CD configured

### Build Configuration

- [ ] `identifier` set in `tauri.conf.json`
- [ ] `productName` and `version` accurate
- [ ] Build targets (`targets`) set for supported platforms
- [ ] `bundle.active` configured for installer types
- [ ] Signing configured for production (macOS codesign, Windows signtool)
- [ ] `build.dangerousRemoteDomainIpcAccess` not used in production

### Frontend Integration

- [ ] `@tauri-apps/api` imported correctly
- [ ] Path alias `@/*` resolved to `src/` directory
- [ ] TypeScript types generated for Rust structs if using `tauri build --debug` schema
- [ ] Environment variables exposed via `tauri build` configuration

---

*Last updated: 2026-03-25*
