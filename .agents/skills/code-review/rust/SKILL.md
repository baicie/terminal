---
name: code-review-rust
description: Code review skill for Rust projects. Covers ownership and borrowing, async patterns with Tokio, error handling with Result/Option, trait design, Cargo conventions, and idiomatic Rust. Use when reviewing Rust codebases or when the user asks for a code review of Rust code.
---

# Code Review — Rust

Framework-specific skill for Rust projects.

## Review Dimensions

### 1. Ownership & Borrowing

- [ ] No use-after-free or dangling references
- [ ] Borrow checker violations — `RefCell<T>`, `Mutex<T>` used only when needed
- [ ] Clone vs. borrow decision — clone only when ownership transfer is needed
- [ ] Lifetimes correctly annotated on structs and functions
- [ ] No unnecessary `Arc<Mutex<T>>` — prefer single-threaded ownership first
- [ ] `Rc<RefCell<T>>` vs. `Arc<Mutex<T>>` — correct choice for the concurrency model
- [ ] No cyclic references causing memory leaks
- [ ] Drop order understood and correct

### 2. Async & Concurrency (Tokio)

- [ ] `tokio::spawn` tasks are joined or aborted on shutdown
- [ ] No goroutine leaks — tasks have finite lifetimes
- [ ] `await` inside a lock held across an await point (use `tokio::sync::Mutex` or `RwLock`)
- [ ] `select!` branches handle fairness correctly
- [ ] `spawn_blocking` used for CPU-heavy work (not CPU-bound on async executor)
- [ ] Backpressure applied on async channels
- [ ] `#[tokio::main]` vs. custom runtime — appropriate for the use case

### 3. Error Handling

- [ ] `Result<T, E>` used instead of panicking for recoverable errors
- [ ] `anyhow::Result<T>` for application code (ergonomic, context-rich)
- [ ] `thiserror` used for library error types (structured, derive-based)
- [ ] No `.unwrap()` or `.expect()` in production code (except tests)
- [ ] Errors propagated with `?` operator, not discarded
- [ ] Error context added with `.context()` or `.with_context()`
- [ ] `Option<T>` used correctly — `map`, `and_then`, `unwrap_or`, etc.

### 4. Trait Design

- [ ] Trait bounds appropriate — avoid over-constraining
- [ ] `async_trait` used correctly (heap allocation aware)
- [ ] `Send + Sync` bounds correct for concurrent use
- [ ] Object safety considered for `dyn Trait`
- [ ] Default implementations used appropriately
- [ ] Sealed traits used to control trait implementors

### 5. Memory & Performance

- [ ] No unnecessary heap allocations (`Box<T>`, `Vec<T>`)
- [ ] `String` vs. `&str` — correct choice for the context
- [ ] Capacity reserved on `Vec` / `HashMap` when size is known
- [ ] Zero-cost abstractions — no hidden runtime overhead
- [ ] `Copy` vs. `Clone` — correct semantics
- [ ] Iterator chains used instead of manual loops where idiomatic
- [ ] No benchmarking-in-production mistakes (e.g. `dbg!()` left in)

### 6. Project Conventions

- [ ] `Cargo.toml` — no missing dependency version upper bounds
- [ ] Feature flags designed orthogonally
- [ ] `#[cfg(test)]` tests colocated or in `tests/`
- [ ] Documentation comments (`///` or `//!`) for public API
- [ ] `clippy` warnings addressed
- [ ] No `unsafe` blocks without safety comments
- [ ] Edition and MSRV appropriately set

## Common Pitfalls

- `.lock()` held across `.await` → deadlock risk
- `spawn` without storing the `JoinHandle` → leaked task
- `.unwrap()` in hot paths → panics under load
- Over-using `Box<dyn Trait>` → heap allocation, vtable lookup
- Missing `Send + Sync` bounds on `#[tokio::test]`

## Report Structure

Follow `COMMON.md` for the overall format. In the Rust section, organize findings by:

1. Ownership / Memory Issues
2. Async / Concurrency Issues
3. Error Handling Issues
4. Trait / Generics Issues
5. Performance Issues
6. Convention Violations

## Additional Resources

- Common methodology: [](../COMMON.md)
- Framework checklist: [CHECKLIST.md](CHECKLIST.md)
- Correct/incorrect patterns: [PATTERNS.md](PATTERNS.md)
