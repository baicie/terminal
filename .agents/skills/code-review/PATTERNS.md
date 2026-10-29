# Code Review Patterns

Correct vs. incorrect code patterns for fast, evidence-backed judgments during review.

---

## 1. State Management

### Zustand Store (Correct)

```typescript
import { create } from 'zustand'

interface HostState {
  hosts: Host[]
  loading: boolean
  error: string | null
  fetchHosts: () => Promise<void>
  addHost: (host: Host) => void
}

export const useHostStore = create<HostState>((set, get) => ({
  hosts: [],
  loading: false,
  error: null,

  fetchHosts: async () => {
    set({ loading: true, error: null })
    try {
      const hosts = await loadHosts()
      set({ hosts, loading: false })
    } catch (error) {
      set({ error: String(error), loading: false })
    }
  },

  addHost: (host) => {
    set((state) => ({ hosts: [...state.hosts, host] }))
  },
}))
```

### MobX Mixed In (Incorrect)

```typescript
import { observable } from 'mobx'

// ❌ Mixing MobX decorators with Zustand store
class HostStore {
  @observable hosts: Host[] = []
}
```

---

## 2. Database Operations

### Query with Error Handling (Correct)

```typescript
export async function executeQuery(sql: string, params: unknown[] = []) {
  try {
    const database = await getDb()
    return await database.execute(sql, params)
  } catch (error) {
    console.error('[Database] Query error:', {
      sql: sql.substring(0, 100),
      params,
      error: error instanceof Error ? error.message : String(error),
    })
    throw new Error('Database query failed')
  }
}

export async function select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    const database = await getDb()
    return await database.select<T[]>(sql, params)
  } catch (error) {
    console.error('[Database] Select error:', error)
    return []
  }
}
```

### No Error Handling (Incorrect)

```typescript
// ❌ No try-catch — SQL errors propagate uncaught
export async function executeQuery(sql: string, params: unknown[] = []) {
  const database = await getDb()
  return database.execute(sql, params)  // ⚠️ unhandled
}
```

---

## 3. LIKE Query Escaping (Correct)

```typescript
export async function searchCommandHistory(query: string, limit = 20) {
  // ✅ Escape LIKE special chars to prevent ReDoS and injection
  const escapedQuery = query.replace(/[%_]/g, '\\$&')
  return database.select(
    'SELECT * FROM command_history WHERE command LIKE ? ESCAPE "\\" ORDER BY executed_at DESC LIMIT ?',
    [`%${escapedQuery}%`, Math.min(limit, 100)],
  )
}
```

### LIKE Without Escaping (Incorrect)

```typescript
// ❌ Special LIKE characters % and _ are not escaped
export async function searchCommandHistory(query: string, limit = 20) {
  return database.select(
    'SELECT * FROM command_history WHERE command LIKE ? ORDER BY executed_at DESC LIMIT ?',
    [`%${query}%`, limit],  // ⚠️ % and _ in query break LIKE semantics
  )
}
```

---

## 4. Static vs Dynamic Imports

### Static Import (Correct)

```typescript
import { updateConnectionLog } from '@/service/database'
import { app } from '@/store/app'

class SSHService {
  async disconnect(sessionId: string): Promise<void> {
    try {
      await invoke('ssh_disconnect', { sessionId })
      const logInfo = activeConnectionLogs.get(sessionId)
      if (logInfo) {
        const duration = Math.round((Date.now() - logInfo.startTime) / 1000)
        await updateConnectionLog(logInfo.logId, {
          ended_at: Date.now(),
          duration_seconds: duration,
        })
        activeConnectionLogs.delete(sessionId)
      }
    } catch (error) {
      console.error('Disconnect error:', error)
    }
  }
}
```

### Dynamic Import (Incorrect)

```typescript
// ❌ Dynamic import inside function — harder to tree-shake, no top-level visibility
async disconnect(sessionId: string): Promise<void> {
  await invoke('ssh_disconnect', { sessionId })
  await import('@/service/database').then(({ updateConnectionLog }) => {
    updateConnectionLog(logInfo.logId, { ... })  // ⚠️ dynamic
  })
}
```

---

## 5. React Hooks — Effect Dependencies

### Using Refs for Callbacks (Correct)

```typescript
const sendDataRef = useRef(sendData)
const resizeRef = useRef(resize)

useEffect(() => {
  sendDataRef.current = sendData
  resizeRef.current = resize
}, [sendData, resize])

useEffect(() => {
  if (!term || !tabType) return

  const unlistenData = await listen(`${eventPrefix}-data`, (event) => {
    termRef.current?.write(event.payload.data)
  })

  const unlistenResize = term.onResize(({ cols, rows }) => {
    resizeRef.current?.(cols, rows)  // ✅ via ref
  })

  return () => {
    unlistenData()
    unlistenResize()
    term.dispose()
  }
}, [term, tabType, startShell]) // ✅ stable deps only
```

### Callbacks in Dependency Array (Incorrect)

```typescript
// ❌ Callbacks as deps cause effect to re-run on every render
}, [term, tabType, startShell, sendData, resize, disconnect])
//           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^  ⚠️ unstable
```

---

## 6. ID Generation

### crypto.randomUUID (Correct)

```typescript
// src/utils/id.ts
export function generateId(): string {
  return crypto.randomUUID()
}

export function generateShortId(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 12)
}
```

### Math.random (Incorrect)

```typescript
// ❌ Math.random is not cryptographically random and has collision risk
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`  // ⚠️
}
```

---

## 7. Terminal Data Buffering

```typescript
// ✅ Buffered writes reduce I/O overhead in high-latency networks
let writeBuffer = ''
let flushTimeout: ReturnType<typeof setTimeout> | null = null

const flushBuffer = () => {
  if (writeBuffer && termRef.current) {
    termRef.current.write(writeBuffer)
    writeBuffer = ''
  }
  flushTimeout = null
}

const unlistenData = await listen(`${eventPrefix}-data`, (event) => {
  writeBuffer += event.payload.data
  if (!flushTimeout) {
    flushTimeout = setTimeout(flushBuffer, 16) // ~60fps flush
  }
})
```

### Unbuffered Writes (Incorrect)

```typescript
// ❌ Every packet triggers a DOM write — poor performance on high-latency links
const unlistenData = await listen(`${eventPrefix}-data`, (event) => {
  termRef.current?.write(event.payload.data)  // ⚠️ no buffering
})
```

---

## 8. Map Type Parameters

### Correct — Typed Map

```typescript
interface TerminalSession {
  id: string
  term: Terminal
  createdAt: number
}

class TerminalStore {
  sessions: Map<string, TerminalSession> = new Map()

  getSession(id: string): TerminalSession | undefined {
    return this.sessions.get(id)
  }
}
```

### Incorrect — Untyped Map

```typescript
// ❌ Missing type parameters — defaults to Map<any, any>
sessions: new Map(),  // ⚠️
```

---

## 9. Sensitive Data Storage

### Keychain / Secure Storage (Correct)

```typescript
import { getPassword, setPassword } from '@/service/keychain'

async function connect(host: Host) {
  const password = await getPassword(host.id)  // ✅ from secure storage
  await invoke('ssh_connect', { ...host, password })
}
```

### Plain Text Storage (Incorrect)

```typescript
// ❌ Password in plain-text database
await database.execute(
  'INSERT INTO hosts (id, name, password) VALUES (?, ?, ?)',
  [host.id, host.name, host.password]  // ⚠️ plain text
)
```

---

## 10. Virtualized List

```typescript
import { useVirtualizer } from '@tanstack/react-virtual'

function HostList({ hosts }: { hosts: Host[] }) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: hosts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
  })

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={hosts[virtualRow.index].id}
            style={{
              position: 'absolute',
              top: 0,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <HostCard host={hosts[virtualRow.index]} />
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

*Last updated: 2026-03-25*
