---
name: code-review-go
description: Code review skill for Go projects. Covers goroutine leaks, error wrapping, interface design, context propagation, Go idioms, and Go best practices. Use when reviewing Go codebases or when the user asks for a code review of Go code.
---

# Code Review — Go

Framework-specific skill for Go projects.

## Review Dimensions

### 1. Goroutines & Concurrency

- [ ] Goroutines have finite lifetimes — no leaked goroutines
- [ ] `sync.WaitGroup` used to wait for concurrent operations
- [ ] Context used to cancel goroutines on shutdown
- [ ] `sync.Mutex` / `sync.RWMutex` used for shared state (not channels for everything)
- [ ] `sync.Map` used only for specific read-heavy concurrent maps (usually a plain map + mutex is faster)
- [ ] No sending to closed channel (panic)
- [ ] No receiving from closed channel (zero value returned, no block)
- [ ] Buffered channels sized appropriately (no unbounded unless intentional)
- [ ] `select` with `default` case not used for busy-waiting
- [ ] `errgroup` used for structured concurrency groups

### 2. Error Handling

- [ ] Errors wrapped with `fmt.Errorf("context: %w", err)`
- [ ] Sentinel errors (`errors.Is`, `errors.As`) used for comparison
- [ ] No error strings capitalized (log-friendly, `errors.Join` compatible)
- [ ] Errors not discarded with `_` (always handled or explicitly ignored)
- [ ] Error types structured for `errors.As` when behavior differs
- [ ] Panics recovered only at top-level boundaries (not silently caught)

### 3. Interfaces

- [ ] Interfaces defined where behavior is needed (not concrete types)
- [ ] Interface segregation — small, focused interfaces (e.g. `io.Reader`, `io.Writer`)
- [ ] Interfaces accepted (input), concrete types returned (output)
- [ ] No interface pollution — don't create interfaces "just in case"
- [ ] Interface naming: `er` suffix for single-method interfaces (`Reader`, `Closer` → `ReadCloser`)

### 4. Context Propagation

- [ ] Context passed as first argument
- [ ] Context never stored in structs
- [ ] Operations respect context cancellation and deadlines
- [ ] Context with values used for request-scoped data (not for optional parameters)
- [ ] Background context used for operations not tied to a request
- [ ] Context canceled on function exit (defer `cancel()`)

### 5. Memory & Performance

- [ ] `make([]T, 0, n)` pre-allocated when size is known
- [ ] `sync.Pool` used for frequently allocated/free'd objects
- [ ] No benchmarking code left in production (`testing.B` / `b.ReportAllocs()`)
- [ ] `defer` used correctly (not in hot loops — stack allocation overhead)
- [ ] Strings used correctly — immutable, concatenating in loop uses `strings.Builder`
- [ ] `append` used correctly — reassign to variable: `slice = append(slice, elem)`
- [ ] `range` over maps is random order — not used for ordered traversal without sorting
- [ ] `go vet` passes

### 6. Project Conventions

- [ ] `go mod` used (not `GOPATH`)
- [ ] Module path follows `github.com/org/repo` convention
- [ ] `go fmt` applied
- [ ] Tests colocated (`foo.go` → `foo_test.go`)
- [ ] Table-driven tests used for multiple test cases
- [ ] `internal/` packages used to enforce internal boundaries
- [ ] Vendor directory or `go.sum` committed
- [ ] Build tags used for platform-specific code
- [ ] No `pkg/` anti-pattern (flat package structure preferred by Go style)

## Common Pitfalls

- Goroutine leak: spawned without context cancellation or wait
- Mutex held while calling unknown code → deadlock risk
- Sending on unbuffered channel without receiver → block forever
- Slicing a map and iterating → random order
- Not pre-allocating slices → repeated reallocation
- Ignoring `error` return value → silent failures

## Report Structure

Follow `COMMON.md` for the overall format. In the Go section, organize findings by:

1. Concurrency / Goroutine Issues
2. Error Handling Issues
3. Interface Design Issues
4. Context Issues
5. Performance Issues
6. Convention Violations

## Additional Resources

- Common methodology: [](../COMMON.md)
- Framework checklist: [CHECKLIST.md](CHECKLIST.md)
- Correct/incorrect patterns: [PATTERNS.md](PATTERNS.md)
