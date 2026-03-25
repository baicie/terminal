# Code Review Patterns — Rust

Correct vs. incorrect code patterns for fast, evidence-backed judgments during review.

---

## 1. Error Propagation — ? Operator

### Correct — ? with Context

```rust
use anyhow::{Context, Result};

fn read_config(path: &Path) -> Result<Config> {
    let content = std::fs::read_to_string(path)
        .context("Failed to read config file")?;
    let config: Config = toml::from_str(&content)
        .context("Failed to parse config as TOML")?;
    Ok(config)
}
```

### Incorrect — Unwrap in Production

```rust
// ❌ Unwrap panics in production — cryptic error to user
fn read_config(path: &Path) -> Config {
    let content = std::fs::read_to_string(path).unwrap()  // ⚠️ panic on I/O error
}
```

---

## 2. Async — Lock Across Await

### Correct — RwLock Read Guard

```rust
use tokio::sync::RwLock;

struct AppState {
    data: RwLock<Vec<u8>>,
}

impl AppState {
    async fn read(&self) -> Vec<u8> {
        let guard = self.data.read().await;
        guard.clone()  // ✅ lock dropped after clone
    }
}
```

### Incorrect — Mutex Lock Across Await

```rust
// ❌ Holding std::sync::Mutex across await point blocks other tasks
let guard = self.data.lock().unwrap();
let _ = some_async_op().await;  // ⚠️ lock held across await — deadlock risk
drop(guard);
```

---

## 3. Async — Task Spawning Without JoinHandle

### Correct — Store JoinHandle

```rust
use tokio::task::JoinHandle;

struct Worker {
    handle: JoinHandle<()>,
}

impl Worker {
    fn spawn<F>(f: F) -> Self
    where F: Future<Output = ()> + Send + 'static {
        Worker { handle: tokio::spawn(f) }
    }

    async fn shutdown(self) {
        self.handle.abort();
        let _ = self.handle.await;
    }
}
```

### Incorrect — Fire and Forget

```rust
// ❌ No JoinHandle — can't await, can't cancel, can't detect panic
async fn do_work() {
    tokio::spawn(async {
        loop {
            // ...
        }
    });  // ⚠️ fire and forget — leaked goroutine
}
```

---

## 4. Ownership — Clone vs. Borrow

### Correct — Borrowed Reference

```rust
fn process(data: &[u8]) -> usize {
    data.iter().filter(|&&b| b > 0).count()  // ✅ borrows, no clone
}
```

### Incorrect — Unnecessary Clone

```rust
// ❌ Unnecessary heap allocation — clone copies entire vec
fn process(data: &Vec<u8>) -> usize {
    data.clone().iter().filter(|&b| b > 0).count()  // ⚠️ clone on borrow
}
// Better: fn process(data: &[u8]) or fn process(data: &Vec<u8>)
```

---

## 5. Option — Chaining Methods

### Correct — and_then

```rust
fn find_user(id: &str) -> Option<User> {
    users
        .get(id)
        .and_then(|u| u.profile.as_ref())
        .filter(|p| p.is_active)
        .cloned()
}
```

### Incorrect — Nested Match

```rust
// ❌ Verbose nested match — harder to read
fn find_user(id: &str) -> Option<User> {
    match users.get(id) {
        Some(user) => match &user.profile {
            Some(profile) => {
                if profile.is_active {
                    Some(user.clone())
                } else {
                    None
                }
            }
            None => None,
        },
        None => None,
    }
}
```

---

## 6. String vs. &str

### Correct — &str Parameter

```rust
fn greeting(name: &str) -> String {
    format!("Hello, {}!", name)  // ✅ borrows, no allocation
}
```

### Incorrect — &String Parameter

```rust
// ❌ Unnecessary constraint — &String doesn't accept &str literals
fn greeting(name: &String) -> String {
    format!("Hello, {}!", name)  // ⚠️ requires explicit &String
}

greeting(&"World".to_string()); // ✅ works
// greeting("World"); // ❌ error: expected &String, found &str
```

---

## 7. Iterator — Chain vs. collect

### Correct — Iterator Chain

```rust
fn odds_and_evens(items: &[i32]) -> Vec<i32> {
    items
        .iter()
        .filter(|&&x| x % 2 == 0)
        .chain(items.iter().filter(|&&x| x % 2 != 0))
        .copied()
        .collect()
}
```

### Incorrect — Intermediate Vec

```rust
// ❌ Allocates intermediate collections — defeats lazy evaluation
fn odds_and_evens(items: &[i32]) -> Vec<i32> {
    let evens: Vec<_> = items.iter().filter(|&&x| x % 2 == 0).collect();
    let odds: Vec<_> = items.iter().filter(|&&x| x % 2 != 0).collect();
    evens.into_iter().chain(odds).copied().collect()  // ⚠️ two allocations
}
```

---

## 8. Unsafe — Safety Comment

### Correct — Documented Invariant

```rust
unsafe {
    // SAFETY: ptr is valid and aligned, lifetime managed by caller
    let value = *ptr;
}
```

### Incorrect — Bare Unsafe

```rust
unsafe {
    let value = *ptr;  // ⚠️ no safety comment — invariant unclear
}
```

---

## 9. Trait — async_trait

### Correct — async_trait on Impl

```rust
use async_trait::async_trait;

#[async_trait]
impl Database for SqliteDb {
    async fn query(&self, sql: &str) -> Result<Vec<Row>> {
        // implementation
    }
}
```

### Incorrect — async_trait on Trait

```rust
// ❌ async_trait on trait definition causes double Box
#[async_trait]
trait Database {
    async fn query(&self, sql: &str) -> Result<Vec<Row>>;
    // ⚠️ boxed twice: Box<dyn Future> + Box<dyn Database>
}
```

---

## 10. thiserror — Library Error Types

### Correct — thiserror Derive

```rust
use thiserror::error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("failed to read file: {0}")]
    Io(#[from] std::io::Error),

    #[error("failed to parse TOML: {0}")]
    Parse(#[from] toml::de::Error),

    #[error("missing required field: {field}")]
    Missing { field: String },
}
```

### Incorrect — Manual Error Enum

```rust
// ❌ Manual error implementation — verbose, no std::error::Error impl
pub enum ConfigError {
    Io(std::io::Error),
    Parse(String),
    Missing(String),
}
```

---

*Last updated: 2026-03-25*
