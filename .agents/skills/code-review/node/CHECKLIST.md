# Code Review Checklist — Node.js / JavaScript

Exhaustive per-dimension checklist for Node.js backend projects.

---

## 1. Async Patterns

- [ ] No callback-style code mixed with Promises or async/await
- [ ] `async` / `await` used for all asynchronous operations
- [ ] `Promise.all` used for parallel independent async operations
- [ ] `Promise.allSettled` used when partial failure is acceptable
- [ ] `Promise.race` used with timeout pattern
- [ ] No `.then().then()` chains when async/await would be cleaner
- [ ] `for await...of` used for async iterables
- [ ] Async iterators and generators used for streaming data
- [ ] `process.nextTick` used correctly (runs before I/O callbacks)
- [ ] `setImmediate` used correctly (runs after I/O callbacks)
- [ ] No `setTimeout(fn, 0)` when `setImmediate` is more appropriate

---

## 2. Event Loop & Blocking

- [ ] No synchronous loops over large datasets in request handlers
- [ ] CPU-intensive work offloaded to Worker Threads
- [ ] Streams used for file I/O on large files
- [ ] Backpressure handled in stream pipelines (`.pipe(res)` checks)
- [ ] `crypto` module used instead of custom hashing
- [ ] `Buffer` used for binary data (not string manipulation)
- [ ] Timers cleared with `clearTimeout` / `clearInterval` on cleanup
- [ ] No infinite loops or recursive async calls without exit condition

---

## 3. HTTP / API

- [ ] Request body size limit set (e.g., `express.json({ limit: '10mb' })`)
- [ ] URL query parameters validated
- [ ] HTTP headers validated (content-type, accept)
- [ ] Proper HTTP status codes used (200, 201, 400, 401, 403, 404, 500, etc.)
- [ ] Response Content-Type set correctly
- [ ] GZIP / Brotli compression enabled
- [ ] CORS configured explicitly (not `*` in production unless intentional)
- [ ] Rate limiting applied to public endpoints
- [ ] Input sanitized before database queries
- [ ] Output sanitized before sending to client (no internal paths, stack traces)
- [ ] No cache headers on sensitive data
- [ ] Security headers set (`helmet`)

---

## 4. Security

- [ ] No `eval()`, `new Function()`, `vm.compileFunction()`
- [ ] No `child_process.exec` with unsanitized user input (use `execFile` with args array)
- [ ] SQL parameterized queries only (no string concatenation)
- [ ] Command injection prevented in shell commands
- [ ] Path traversal prevented (`path.resolve`, `path.join`)
- [ ] No secrets in code (use environment variables)
- [ ] `.env` in `.gitignore`
- [ ] `npm audit` run and vulnerabilities addressed
- [ ] Dependencies pinned to exact versions via lock file
- [ ] No `innerHTML` / `document.write` in server code (SSR)

---

## 5. Package Management

- [ ] No duplicate dependencies (`npm ls` to check)
- [ ] No transitive dependency conflicts
- [ ] Peer dependencies declared and installed
- [ ] Scripts in `package.json` reviewed (no `curl | bash` patterns)
- [ ] `"engines"` field set for Node.js version requirement
- [ ] `"private": true` on library packages
- [ ] `sideEffects` declared for tree-shaking
- [ ] TypeScript types installed (`@types/*`) for JS projects
- [ ] Dev dependencies not bundled in production build

---

## 6. Error Handling

- [ ] Centralized error handler middleware
- [ ] Async route handlers wrapped (Express 5 handles natively, older versions use `express-async-errors`)
- [ ] Errors logged with stack trace in development
- [ ] Errors sanitized before sending to client (no internal paths, SQL, env vars)
- [ ] `domain` or `async_hooks` considered for request-scoped error tracking
- [ ] Graceful shutdown: `SIGTERM` / `SIGINT` handled
- [ ] DB connections closed on shutdown
- [ ] File handles closed on shutdown
- [ ] HTTP server `.close()` called before process exit
- [ ] Exit code set appropriately (`process.exit(1)` for errors)

---

*Last updated: 2026-03-25*
