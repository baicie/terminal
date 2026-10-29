# Code Review Checklist — Go

Exhaustive per-dimension checklist for Go projects.

---

## 1. Goroutines & Concurrency

- [ ] Every `go func()` call has a corresponding cancellation or wait mechanism
- [ ] `context.Context` passed and respected in all async operations
- [ ] `sync.WaitGroup.Add()` called before `go func()`
- [ ] `errgroup.Group` used for structured concurrent operations
- [ ] No sending on closed channels (will panic)
- [ ] No ranging over channels with only one sender (will deadlock)
- [ ] Buffered channels sized appropriately (unbounded = potential memory leak)
- [ ] `sync.Map` used only for specific concurrent map workloads (usually a map + mutex is better)
- [ ] `atomic` operations used for simple counters/flags
- [ ] `sync.Pool` used for frequently allocated objects
- [ ] `select` with `default` not used for polling (use `time.Ticker`)
- [ ] No goroutine started inside a `for range` loop without fixing the loop variable capture

---

## 2. Error Handling

- [ ] `fmt.Errorf("context: %w", err)` used for wrapping
- [ ] No `errors.New("...")` for external-facing errors (define sentinel errors)
- [ ] `errors.Is()` used to check sentinel errors
- [ ] `errors.As()` used to extract typed errors
- [ ] Errors not discarded with `_` (unless intentionally ignored)
- [ ] Errors logged at the point they are handled (not propagated silently)
- [ ] No panics in library code (reserve `panic` for truly unrecoverable states)
- [ ] `recover()` used only at top-level goroutine boundaries
- [ ] Error messages lowercase, no punctuation (convention)
- [ ] `errors.Join()` used for multiple errors

---

## 3. Interface Design

- [ ] Interfaces defined at the consumer side (not the producer)
- [ ] Small interfaces (1-3 methods) preferred
- [ ] Interface naming: `er` suffix for single-method (`Reader`, `Closer` → `ReadCloser`)
- [ ] Interfaces accepted as parameters (not returned from constructors)
- [ ] No interface pollution (no `interface{}` or `any` unless necessary)
- [ ] `error` interface implicitly satisfied (no need to declare)
- [ ] `io.Reader`, `io.Writer`, `io.Closer` used for standard interfaces
- [ ] Custom interfaces documented

---

## 4. Context Propagation

- [ ] `context.Context` first parameter in function signatures
- [ ] `ctx` not stored in struct fields
- [ ] `defer cancel()` called on all paths (including errors)
- [ ] `context.Background()` used for initialization, not `TODO()` in long-term code
- [ ] `context.WithTimeout` / `context.WithDeadline` used for operations with deadlines
- [ ] Context values used only for request-scoped data (not optional parameters)
- [ ] Context values checked with `v := ctx.Value(key)` and type-asserted
- [ ] No sensitive data stored in context values without encryption

---

## 5. Memory & Performance

- [ ] `make([]T, 0, capacity)` pre-allocated when size known
- [ ] `append` reassigned: `slice = append(slice, elem)`
- [ ] `strings.Builder` used for string concatenation in loops
- [ ] `bytes.Buffer` used for byte concatenation in loops
- [ ] `sync.Pool` used for object pooling of expensive allocations
- [ ] `for range` over slice (index, value) copies value; use `for i := range slice` if index needed
- [ ] `for range` over map is random order — sort if order needed
- [ ] `defer` not used in tight loops (stack allocation overhead)
- [ ] `逃` method receivers: `*T` for large structs, `T` for small structs consistently
- [ ] `go vet` passes
- [ ] `go build -gcflags="-m"` analyzed for escape analysis insights
- [ ] Benchmark tests in `_test.go` files with `b.ReportAllocs()`

---

## 6. Project Conventions

### Module Management

- [ ] `go.mod` present with module path following `domain/org/repo` convention
- [ ] `go.sum` committed alongside `go.mod`
- [ ] `go mod tidy` run before committing
- [ ] No `replace` directives in `go.mod` (except for local development)
- [ ] Vendor directory committed if offline builds needed

### Code Organization

- [ ] Flat package structure preferred over deep `pkg/` hierarchies
- [ ] `internal/` packages used for private packages
- [ ] `cmd/` for binary entry points
- [ ] `pkg/` for public packages
- [ ] `api/` for API definitions (protobuf, OpenAPI)
- [ ] Tests colocated: `foo.go` → `foo_test.go`
- [ ] Example files: `examples/` directory

### Tooling

- [ ] `go fmt` applied
- [ ] `go vet` passes
- [ ] `golangci-lint` configured and passing
- [ ] `staticcheck` used for static analysis
- [ ] Security linter (`gosec`) considered
- [ ] `stringer` / `go generate` used for boilerplate (enums, String methods)

### Documentation

- [ ] `package` doc comments on every package
- [ ] `// Export ` comments for exported identifiers
- [ ] README explains the project purpose, installation, and usage
- [ ] CHANGELOG maintained
- [ ] LICENSE file present

---

*Last updated: 2026-03-25*
