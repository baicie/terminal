# Code Review Patterns — Go

Correct vs. incorrect code patterns for fast, evidence-backed judgments during review.

---

## 1. Goroutine — WaitGroup for Cleanup

### Correct — WaitGroup

```go
func processAll(items []Item) error {
    var wg sync.WaitGroup
    errCh := make(chan error, len(items))

    for _, item := range items {
        wg.Add(1)
        go func(it Item) {
            defer wg.Done()
            if err := process(it); err != nil {
                errCh <- err
            }
        }(item)
    }

    wg.Wait()
    close(errCh)

    for err := range errCh {
        return err
    }
    return nil
}
```

### Incorrect — Fire and Forget

```go
// ❌ No wait mechanism — goroutines may not complete before function returns
func processAll(items []Item) {
    for _, item := range items {
        go func(it Item) {
            process(it) // ⚠️ fire and forget — no way to wait or detect error
        }(item)
    }
}
```

---

## 2. Context — Propagation and Cancellation

### Correct — Context Passed and Cancelled

```go
func fetchUser(ctx context.Context, id string) (*User, error) {
    req, err := http.NewRequestWithContext(ctx, "GET", "/users/"+id, nil)
    if err != nil {
        return nil, err
    }

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return nil, fmt.Errorf("fetch user: %w", err)
    }
    defer resp.Body.Close()

    var user User
    if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
        return nil, fmt.Errorf("decode response: %w", err)
    }
    return &user, nil
}
```

### Incorrect — Background Context with Timeout

```go
// ❌ context.Background() ignores cancellation from callers
func fetchUser(id string) (*User, error) {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second) // ⚠️
    defer cancel()
    // ... rest of function
}
```

---

## 3. Error Wrapping — fmt.Errorf with %w

### Correct — Wrapped Error

```go
func readConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("reading config %q: %w", path, err)  // ✅ wrapped
    }
    var cfg Config
    if err := json.Unmarshal(data, &cfg); err != nil {
        return nil, fmt.Errorf("parsing config %q: %w", path, err)  // ✅ wrapped
    }
    return &cfg, nil
}
```

### Incorrect — Error Without Context

```go
// ❌ Wrapped only at top level — no context in intermediate layers
func readConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, err  // ⚠️ "no such file or directory" — no path context
    }
    // ...
}
```

---

## 4. Slices — Preallocate with Capacity

### Correct — make with Capacity

```go
func filterUsers(users []*User, active bool) []*User {
    result := make([]*User, 0, len(users))  // ✅ pre-allocated
    for _, u := range users {
        if u.Active == active {
            result = append(result, u)
        }
    }
    return result
}
```

### Incorrect — Append Without Preallocation

```go
// ❌ Append grows the slice by doubling — multiple reallocations
func filterUsers(users []*User, active bool) []*User {
    var result []*User  // ⚠️ starts at nil, grows by doubling
    for _, u := range users {
        if u.Active == active {
            result = append(result, u)
        }
    }
    return result
}
```

---

## 5. Strings — Builder for Concatenation

### Correct — strings.Builder

```go
func formatErrors(errs []error) string {
    var sb strings.Builder  // ✅ efficient — no allocations per write
    for i, err := range errs {
        if i > 0 {
            sb.WriteString(", ")
        }
        sb.WriteString(err.Error())
    }
    return sb.String()
}
```

### Incorrect — += in Loop

```go
// ❌ String concatenation creates a new string each iteration — O(n²)
func formatErrors(errs []error) string {
    result := ""
    for i, err := range errs {
        if i > 0 {
            result += ", "
        }
        result += err.Error()  // ⚠️ new string each iteration
    }
    return result
}
```

---

## 6. Interface — Small Focused Interface

### Correct — io.Reader

```go
// ✅ Small interface — easy to implement, single concern
type Processor interface {
    Process(data []byte) error
}

// Usage: anything implementing Process() can be used
func ProcessAll(r io.Reader, p Processor) error { ... }
```

### Incorrect — Large Interface

```go
// ❌ God interface — hard to implement, violates interface segregation
type Handler interface {
    Handle(context.Context) error
    Validate() error
    Cache() error
    Log() error
    Metrics() error
    // ⚠️ Many implementations won't need all methods
}
```

---

## 7. Defer — Cleanup in Hot Paths

### Correct — Explicit Close

```go
func (s *Store) GetAll() ([]Item, error) {
    s.mu.Lock()
    defer s.mu.Unlock()  // ✅ defer in lock — acceptable if called rarely

    // ... read from map
    return items, nil
}
```

### Incorrect — Defer in Loop

```go
// ❌ Defer accumulates in loop — deferred calls added to stack
func processAll(conns []Connection) error {
    for _, conn := range conns {
        defer conn.Close()  // ⚠️ all defers kept until function returns
        if err := conn.Process(); err != nil {
            return err
        }
    }
    return nil
}
```

---

## 8. Channel — Closed Channel Panic

### Correct — Check Before Send

```go
func sendValue(ch chan<- int, value int) bool {
    select {
    case ch <- value:
        return true
    default:
        return false  // ✅ channel full or closed — don't block
    }
}
```

### Incorrect — Send on Closed Channel

```go
// ❌ Panic: send on closed channel
func sendValue(ch chan<- int, value int) {
    ch <- value  // ⚠️ panics if channel is closed
}
```

---

## 9. for range — Loop Variable Capture

### Correct — Capture as Parameter

```go
// ✅ Variable captured as parameter — each goroutine gets its own copy
for _, item := range items {
    go func(it Item) {
        process(it)  // ✅ it is a copy
    }(item)
}
```

### Incorrect — Closure Captures Loop Variable

```go
// ❌ Closure captures loop variable — all goroutines may see the same final value
for _, item := range items {
    go func() {
        process(item)  // ⚠️ all goroutines see the same `item` reference
    }()
}
```

---

## 10. Slices — append Reassignment

### Correct — Reassign append Result

```go
func addItem(slice []int, item int) []int {
    return append(slice, item)  // ✅ reassign
}
```

### Incorrect — Append Without Reassign

```go
// ❌ Append result not used — original slice unchanged
func addItem(slice []int, item int) {
    append(slice, item)  // ⚠️ result discarded — original slice unchanged
}
```

---

*Last updated: 2026-03-25*
