# Code Review Patterns — Tauri (Rust + Web)

Correct vs. incorrect code patterns for fast, evidence-backed judgments during review.

---

## 1. Tauri Command — Result Return with Typed Error

### Correct — Typed Error Enum

```rust
// src-tauri/src/lib.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub enum CommandError {
    NotFound(String),
    InvalidInput(String),
    IoError(String),
}

impl From<std::io::Error> for CommandError {
    fn from(err: std::io::Error) -> Self {
        CommandError::IoError(err.to_string())
    }
}

#[tauri::command]
async fn get_host(id: String, state: State<'_, AppState>) -> Result<Host, CommandError> {
    state
        .hosts
        .get(&id)
        .cloned()
        .ok_or_else(|| CommandError::NotFound(id))
}
```

### Incorrect — Stringly-Typed Error

```rust
// ❌ String error loses type information — frontend can't narrow type
#[tauri::command]
fn get_host(id: String, state: State<'_, AppState>) -> Result<Host, String> {
    state
        .hosts
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("Host {} not found", id))  // ⚠️ string error
}
```

---

## 2. TypeScript IPC — Typed invoke

### Correct — Typed invoke

```typescript
// src/types/tauri.ts
export interface Host {
  id: string
  name: string
  connected: boolean
}

export type CommandError =
  | { type: 'NotFound'; id: string }
  | { type: 'InvalidInput'; message: string }
  | { type: 'IoError'; message: string }

// src/hooks/useHost.ts
import { invoke } from '@tauri-apps/api/core'
import type { Host, CommandError } from '@/types/tauri'

async function getHost(id: string): Promise<Host> {
  try {
    return await invoke<Host>('get_host', { id })  // ✅ typed
  } catch (err) {
    const error = err as CommandError  // ✅ narrowed
    if (error.type === 'NotFound') {
      throw new Error(`Host ${error.id} not found`)
    }
    throw new Error(error.message)
  }
}
```

### Incorrect — Untyped invoke

```typescript
// ❌ No type annotation — any error structure accepted silently
const host = await invoke('get_host', { id })  // ⚠️ returns unknown
```

---

## 3. Rust State — Arc<Mutex<T>> for Shared Mutability

### Correct — Thread-Safe State

```rust
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub hosts: Arc<Mutex<HashMap<String, Host>>>,
}

#[tauri::command]
fn add_host(host: Host, state: State<'_, AppState>) -> Result<(), String> {
    let mut hosts = state.hosts.lock().map_err(|e| e.to_string())?;
    hosts.insert(host.id.clone(), host);
    Ok(())
}
```

### Incorrect — MutexGuard Leaked

```rust
// ❌ MutexGuard returned from command — held across IPC boundary
#[tauri::command]
fn get_all_hosts(state: State<'_, Mutex<HashMap<String, Host>>>) -> MutexGuard<HashMap<String, Host>> {
    state.lock().unwrap()  // ⚠️ guard held in frontend — can't release
}
```

---

## 4. Frontend — Event Listener Cleanup

### Correct — Cleanup on Unmount

```typescript
// src/hooks/useTerminalData.ts
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { onUnmounted } from 'vue'  // or useEffect in React

export function useTerminalData(sessionId: string, handler: (data: string) => void) {
  let unlisten: UnlistenFn | null = null

  listen<{ data: string }>(`terminal-${sessionId}-data`, (event) => {
    handler(event.payload.data)
  }).then((fn) => {
    unlisten = fn
  })

  onUnmounted(() => {
    unlisten?.()  // ✅ cleanup on component unmount
  })
}
```

### Incorrect — No Cleanup

```typescript
// ❌ Listener never removed — memory leak on component unmount
export function useTerminalData(sessionId: string, handler: (data: string) => void) {
  listen<{ data: string }>(`terminal-${sessionId}-data`, (event) => {
    handler(event.payload.data)  // ⚠️ no cleanup — accumulates listeners
  })
}
```

---

## 5. Security — Capability Least Privilege

### Correct — Scoped Capabilities

```json
// src-tauri/capabilities/main.json
{
  "identifier": "main-capability",
  "description": "Main window capabilities",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:event:default",
    "fs:allow-read-file",
    {
      "identifier": "fs:allow-read",
      "allow": [
        { "path": "$APPDATA/**" },
        { "path": "$HOME/.ssh/**" }
      ]
    },
    "shell:allow-open"
  ]
}
```

### Incorrect — Overly Broad Permissions

```json
// ❌ allow-all grants everything — security risk
{
  "identifier": "main-capability",
  "permissions": [
    "core:default",
    "fs:allow-all",     // ⚠️ full filesystem access
    "shell:allow-all",   // ⚠️ arbitrary shell execution
    "dialog:allow-all"   // ⚠️ all dialogs
  ]
}
```

---

## 6. Async Command — spawn_blocking for CPU Work

### Correct — CPU Work Offloaded

```rust
use tokio::task;

#[tauri::command]
async fn compute_hash(data: Vec<u8>, algorithm: String) -> Result<String, String> {
    task::spawn_blocking(move || {
        match algorithm.as_str() {
            "sha256" => {
                let hash = sha2::Sha256::digest(&data);
                Ok(format!("{:x}", hash))
            }
            _ => Err(format!("Unknown algorithm: {}", algorithm)),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
```

### Incorrect — CPU Work on Async Thread

```rust
// ❌ CPU-intensive hashing blocks the async executor
#[tauri::command]
async fn compute_hash(data: Vec<u8>, algorithm: String) -> Result<String, String> {
    let hash = sha2::Sha256::digest(&data);  // ⚠️ blocks executor thread
    Ok(format!("{:x}", hash))
}
```

---

## 7. Event Streaming — Rust Emit + Frontend Listen

### Correct — Typed Event Payload

```rust
// Rust — emit typed event
app.emit("host-status-changed", HostStatusEvent {
    host_id: host.id.clone(),
    connected: true,
    timestamp: Utc::now().timestamp(),
}).map_err(|e| e.to_string())?;
```

```typescript
// Frontend — typed listener
import { listen } from '@tauri-apps/api/event'

interface HostStatusEvent {
  host_id: string
  connected: boolean
  timestamp: number
}

const unlisten = await listen<HostStatusEvent>('host-status-changed', (event) => {
  updateHostStatus(event.payload.host_id, event.payload.connected)  // ✅ typed
})
```

### Incorrect — Raw JSON String

```rust
// ❌ Raw string — no type safety, fragile
app.emit("host-status-changed", format!(
    r#"{{"host_id":"{}","connected":true}}"#, host.id
))?;
```

---

## 8. Rust — Input Validation on Commands

### Correct — Validated Input

```rust
#[tauri::command]
fn connect_host(hostname: String, port: u16, state: State<'_, AppState>) -> Result<SessionId, CommandError> {
    if hostname.is_empty() {
        return Err(CommandError::InvalidInput("hostname cannot be empty".into()))
    }
    if hostname.len() > 253 {
        return Err(CommandError::InvalidInput("hostname too long".into()))
    }
    if !(1..=65535).contains(&port) {
        return Err(CommandError::InvalidInput("port out of range".into()))
    }
    // ... rest of logic
}
```

### Incorrect — No Validation

```rust
// ❌ Frontend trusted — any input accepted
#[tauri::command]
fn connect_host(hostname: String, port: u16, state: State<'_, AppState>) -> Result<SessionId, String> {
    // ⚠️ hostname and port used directly — no validation
    let session = create_ssh_session(&hostname, port)?;
}
```

---

## 9. Frontend — Loading State from Tauri invoke

### Correct — Promise-based State

```typescript
const [loading, setLoading] = useState(false)
const [error, setError] = useState<string | null>(null)

async function connect() {
  setLoading(true)
  setError(null)
  try {
    await invoke('connect_host', { hostname, port })
    navigate('/terminal')
  } catch (err) {
    const error = err as CommandError
    if (error.type === 'NotFound') {
      setError(`Host not found: ${error.id}`)
    } else {
      setError(error.message)
    }
  } finally {
    setLoading(false)
  }
}
```

### Incorrect — No Error Handling

```typescript
// ❌ Error swallowed — user sees no feedback
async function connect() {
  await invoke('connect_host', { hostname, port })  // ⚠️ no catch
  navigate('/terminal')  // navigates even on failure
}
```

---

## 10. Rust — tokio::main Without #\[tokio::main\]

### Correct — Runtime Configured

```rust
#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init()
    run().await
}

async fn run() {
    tauri::Builder::default()
        .setup(|app| { ... })
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
```

### Incorrect — Missing Attribute

```rust
// ❌ Default single-threaded runtime — may not support all async features
async fn main() {  // ⚠️ no #[tokio::main] — synchronous entry point
    let app = tauri::Builder::default().run(tauri::generate_context!())
    app.expect("error while running")
}
```

---

*Last updated: 2026-03-25*
