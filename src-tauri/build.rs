/**
 * Build script: Tauri configuration, plus an embedding step Cargo can actually track.
 *
 * ## The defect this exists for
 *
 * `tauri::generate_context!()` is a **macro**: it reads `frontendDist` and embeds the
 * files when the crate is expanded. Cargo has no idea the macro read `dist/`, so it
 * never invalidates the crate when `dist/` changes — any rebuild that does not touch a
 * `.rs` file produces a binary carrying the **previous** frontend.
 *
 * Measured on this machine: `node scripts/run-gui-e2e.mjs --spec e2e-06` built the
 * frontend with `VITE_TERMINAL_GUI_E2E=1`, then `tauri build` re-ran `beforeBuildCommand`
 * itself, and the resulting binary still had `pickerMarker: null` while `dist/` plainly
 * contained the E2E chunk. Tangled with that: a run whose E2E input was correct
 * reported **"6 passing" with 9 NOT_RUN** because every upload case returned early.
 *
 * The failure mode is not specific to E2E. A production build after a frontend-only
 * change ships the old UI — the same class as the grey-window bug this file's sibling
 * notes describe (a release binary with no embedded assets at all).
 *
 * ## The fix is the one Tauri documents
 *
 * `tauri_build`'s `codegen` context moves asset embedding into the build script and
 * emits the `rerun-if-changed` instructions Cargo needs. The application then uses
 * `tauri::tauri_build_context!()` instead of `tauri::generate_context!()`.
 *
 * `codegen` is behind tauri-build's `codegen` feature, which `Cargo.toml` enables. It
 * is a build-dependency feature: nothing in the shipped binary changes shape.
 *
 * ## What it costs when the frontend has not changed
 *
 * Cargo re-runs this script only when a watched path changed, and the context file is
 * rewritten with identical bytes — the crate then still recompiles, because a build
 * script's output invalidates it. That is the trade: correctness over a rebuild that
 * silently kept stale assets.
 */
fn main() {
    let attributes = tauri_build::Attributes::new()
        .codegen(tauri_build::CodegenContext::new());
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
