# Code Review Checklist — Rust

Exhaustive per-dimension checklist for Rust projects.

---

## 1. Ownership & Borrowing

- [ ] No references outliving their referent
- [ ] No `Rc<RefCell<T>>` without justification (single-threaded shared mutability)
- [ ] `Arc<Mutex<T>>` used for multi-threaded shared state
- [ ] `Arc<RwLock<T>>` considered for read-heavy workloads
- [ ] Lifetimes annotated on functions returning references
- [ ] Lifetime elision rules understood (no unnecessary `'a` annotations)
- [ ] Structs holding references have bounded lifetimes
- [ ] No cyclic `Rc` references (use `Rc<Vec<Rc<T>>>` or `Rc<T>` + graph)
- [ ] `Cow<'a, T>` used for "clone on write" efficiency
- [ ] `Pin<T>` used correctly for self-referential types
- [ ] `unsafe` blocks have safety comments explaining invariants

---

## 2. Async & Concurrency (Tokio)

- [ ] All `tokio::spawn` calls store the `JoinHandle` for cleanup
- [ ] Shutdown handler calls `.cancel()` or `.abort()` on running tasks
- [ ] `select!` with `biased` clause used only when ordering is intentional
- [ ] `tokio::sync::broadcast` used for fan-out; `mpsc` for pipeline
- [ ] `tokio::sync::Mutex` (not `std::sync::Mutex`) in async contexts
- [ ] No `.lock().await` holding lock across await points (use `RwLock` with read guard)
- [ ] `spawn_blocking` used for sync I/O and CPU-bound work
- [ ] Channel senders cloned or owned correctly (not double-closed)
- [ ] `#[tokio::test]` used for async tests (not `#[test]`)
- [ ] `tokio::time::timeout` wraps potentially hanging operations
- [ ] Backpressure on bounded channels (producer waits when full)

---

## 3. Error Handling

- [ ] `Result<T, E>` returned from fallible functions (not `Option<T>` for error cases)
- [ ] `?` operator used consistently (not `.unwrap()` / `.expect()`)
- [ ] `anyhow::Context` / `.context()` used for application error context
- [ ] `thiserror` derive used for library error types
- [ ] Custom error types implement `std::error::Error` where needed
- [ ] No `.unwrap()` in production code (use `.context()` + `?` or `.unwrap_err()` after checking)
- [ ] `Option<T>` methods used (`map`, `and_then`, `unwrap_or`, `unwrap_or_else`)
- [ ] `Option<T>` vs `Result<T, E>` chosen by whether "absence" is an error or not
- [ ] Errors logged at the point they are handled (not just propagated silently)
- [ ] Sentinel errors compared with `errors::Is`

---

## 4. Trait Design

- [ ] Traits defined at the right level of abstraction (not too broad)
- [ ] `async_trait` used correctly (`#[async_trait]` on impl, not on trait definition)
- [ ] `Send + Sync` bounds declared where needed for concurrent use
- [ ] Object-safe traits don't have methods with generic types
- [ ] Default implementations in traits used appropriately
- [ ] Sealed traits used to control implementation (prevents downstream impl)
- [ ] `IntoIterator` implemented for custom collection types
- [ ] `Deref` / `DerefMut` used for delegation, not inheritance
- [ ] No `#[derive(Clone)]` on types holding `Rc`, `Arc`, `Mutex` (deep clone semantics unclear)

---

## 5. Memory & Performance

- [ ] `String` used when ownership matters; `&str` when borrowing
- [ ] `Vec` capacity reserved (`Vec::with_capacity`) when size is known
- [ ] `HashMap` / `BTreeMap` chosen based on key ordering needs
- [ ] Small `struct`s passed by value (copy semantics) or by reference (`&T`)
- [ ] `&str` slices preferred over `&String`
- [ ] `Iterator` chains used for transformative operations (avoids intermediate collections)
- [ ] `match` exhaustive (use `_ =>` only for truly catch-all)
- [ ] `#[inline]` / `#[inline(always)]` used sparingly (compiler usually knows better)
- [ ] `dbg!()` calls removed from production code
- [ ] `format!()` avoided in hot paths (use `write!` to existing buffer)
- [ ] `SmallVec<[T; N]>` considered for small hot-path vectors
- [ ] `string_cache` / interning considered for frequently duplicated strings

---

## 6. Project Conventions

### Cargo.toml

- [ ] All dependencies have version constraints
- [ ] `[profile.release]` settings reviewed (LTO, codegen-units)
- [ ] `[features]` defined orthogonally
- [ ] Dev dependencies separated (`[dev-dependencies]`)
- [ ] No workspace member packages missing from `[workspace.members]`

### Code Structure

- [ ] `lib.rs` for library crate, `main.rs` only for binary
- [ ] `mod.rs` used in modules (or `foo.rs` + `foo/mod.rs` preferred in 2018 edition)
- [ ] Tests in `tests/` integration tests, `#[cfg(test)]` for unit tests
- [ ] `src/bin/` for multiple binaries
- [ ] `examples/` for runnable examples
- [ ] `benches/` for benchmarks

### Documentation

- [ ] Public API documented with `///` doc comments
- [ ] `//!` used for module-level docs
- [ ] `CHANGELOG.md` updated on releases
- [ ] `README.md` explains the crate purpose and usage
- [ ] MSRV declared if compatibility matters

### Tooling

- [ ] `clippy` warnings addressed (run `cargo clippy -- -W clippy::all`)
- [ ] `cargo fmt` applied
- [ ] `cargo test` passes
- [ ] `cargo deny` / `cargo auditable` used for supply chain security

---

*Last updated: 2026-03-25*
