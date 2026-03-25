# Code Review Patterns — React / TypeScript

Correct vs. incorrect code patterns for fast, evidence-backed judgments during review.

---

## 1. Hook Dependency Arrays

### Correct — Stable Deps Only

```typescript:47:52:src/hooks/use-terminal.ts
useEffect(() => {
  // Use refs to avoid stale closures
  const unlistenData = await listen(`${eventPrefix}-data`, (event) => {
    termRef.current?.write(event.payload.data)
  })

  return () => { unlistenData() }
}, [term, tabType, startShell]) // ✅ stable deps only
```

### Incorrect — Unstable Callbacks as Deps

```typescript
// ❌ Callbacks in deps cause effect to re-run every render
}, [term, tabType, startShell, sendData, resize, disconnect])
//           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^  unstable
```

---

## 2. State Update Immutability

### Correct — Immutable Update

```typescript
const addHost = (host: Host) => {
  set((state) => ({ hosts: [...state.hosts, host] }))  // ✅ new array
}
```

### Incorrect — Direct Mutation

```typescript
// ❌ Mutates state directly — React won't re-render
const addHost = (host: Host) => {
  state.hosts.push(host)  // ⚠️ mutation
}
```

---

## 3. useCallback for Stable References

### Correct — Memoized Callback

```typescript
const handleClick = useCallback((id: string) => {
  dispatch({ type: 'SELECT', payload: id })
}, [dispatch])

return <Child onClick={handleClick} />
```

### Incorrect — Inline Function

```typescript
// ❌ New function instance on every render → child re-renders
return <Child onClick={(id) => dispatch({ type: 'SELECT', payload: id })} />
```

---

## 4. TypeScript — unknown vs. any

### Correct — unknown with Guard

```typescript
function parseResponse(data: unknown): User {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid response')
  }
  if (!('id' in data) || typeof data.id !== 'string') {
    throw new Error('Missing id field')
  }
  return data as User  // ✅ cast after validation
}
```

### Incorrect — any with No Safety

```typescript
// ❌ No type safety — any error slips through
function parseResponse(data: any): User {
  return data as User  // ⚠️ unsafe cast
}
```

---

## 5. TypeScript — Discriminated Unions for State

### Correct — Tagged Union

```typescript
type FetchState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error }

function render(state: FetchState<User>) {
  switch (state.status) {
    case 'loading': return <Spinner />
    case 'success': return <div>{state.data.name}</div>  // ✅ data is typed
    case 'error': return <div>{state.error.message}</div>  // ✅ error is typed
  }
}
```

### Incorrect — Boolean Flags

```typescript
// ❌ Conflicting booleans: loading=true, error=undefined, data=User
interface State {
  loading: boolean
  error?: Error
  data?: User
}
```

---

## 6. Zustand — Selector for Minimal Re-renders

### Correct — Selector Slice

```typescript
// ✅ Only re-renders when count changes
const count = useStore((s) => s.count)
```

### Incorrect — Full Store Subscription

```typescript
// ❌ Re-renders on any store change
const { count, name, email } = useStore()  // ⚠️ subscribes to entire store
```

---

## 7. React.memo — Shallow Compare

### Correct — Custom Comparator

```typescript
const Row = React.memo(({ id, name, onClick }: RowProps) => {
  return <div onClick={() => onClick(id)}>{name}</div>
}, (prev, next) => {
  return prev.id === next.id && prev.name === next.name  // ✅ stable reference check
})
```

### Incorrect — No Comparator on Function Props

```typescript
const Row = React.memo(({ onClick, ... }: RowProps) => {
  return <div onClick={onClick}>{...}</div>
  // ❌ Default shallow compare — onClick always new reference → always re-renders
})
```

---

## 8. Virtualized List

### Correct — TanStack Virtual

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
        {virtualizer.getVirtualItems().map((vRow) => (
          <div key={hosts[vRow.index].id} style={{ position: 'absolute', transform: `translateY(${vRow.start}px)` }}>
            <HostCard host={hosts[vRow.index]} />
          </div>
        ))}
      </div>
    </div>
  )
}
```

### Incorrect — Render All Items

```typescript
// ❌ 1000+ hosts = 1000+ DOM nodes → scroll jank
return (
  <div className="h-full overflow-auto">
    {hosts.map((host) => <HostCard key={host.id} host={host} />)}
  </div>
)
```

---

## 9. Dangerously Set Inner HTML

### Correct — Sanitized with DOMPurify

```typescript
import DOMPurify from 'dompurify'

function SafeHTML({ html }: { html: string }) {
  const sanitized = DOMPurify.sanitize(html)  // ✅ sanitized
  return <div dangerouslySetInnerHTML={{ __html: sanitized }} />
}
```

### Incorrect — Raw HTML

```typescript
// ❌ XSS vulnerability — user-provided HTML rendered as-is
function UnsafeHTML({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />  // ⚠️ XSS
}
```

---

## 10. Environment Variables — Vite

### Correct — Typed with VITE Prefix

```typescript
// .env
VITE_API_URL=https://api.example.com
VITE_APP_VERSION=1.0.0

// Usage
const apiUrl = import.meta.env.VITE_API_URL as string  // ✅ typed
```

### Incorrect — Node-style Process Env

```typescript
// ❌ process.env not available in Vite client bundle
const apiUrl = process.env.API_URL  // ⚠️ undefined at runtime
```

---

*Last updated: 2026-03-25*
