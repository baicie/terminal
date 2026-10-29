---
name: code-review-node
description: Code review skill for Node.js / JavaScript projects. Covers async patterns (Promises, async/await), event loop management, Express/Fastify/Hono conventions, npm security, and general JavaScript best practices. Use when reviewing Node.js backend code or when the user asks for a code review of server-side JavaScript.
---

# Code Review — Node.js / JavaScript

Framework-specific skill for Node.js backend projects.

## Review Dimensions

### 1. Async Patterns

- [ ] No mixing of callbacks, Promises, and async/await
- [ ] `async` / `await` used consistently (no `new Promise` where avoidable)
- [ ] No unhandled Promise rejections (always `.catch()` or `try/catch`)
- [ ] No synchronous code in async handlers blocking the event loop
- [ ] `Promise.all`, `Promise.allSettled`, `Promise.race` used appropriately
- [ ] No fire-and-forget async calls without error handling
- [ ] Correct use of `process.nextTick` vs. `setImmediate` vs. `setTimeout(fn, 0)`

### 2. Event Loop

- [ ] No CPU-intensive synchronous loops blocking the event loop
- [ ] Heavy computation offloaded to Worker Threads
- [ ] Streams used for large data (not buffered entirely in memory)
- [ ] Backpressure correctly handled in stream pipelines
- [ ] Timers cleaned up when no longer needed

### 3. HTTP / API

- [ ] Input validation on all endpoints
- [ ] Proper HTTP status codes used
- [ ] Response times tracked and monitored
- [ ] No sensitive data in error messages
- [ ] CORS configured correctly
- [ ] Rate limiting applied to public endpoints
- [ ] Request body size limits set

### 4. Security

- [ ] No `eval()` or `new Function()`
- [ ] Command injection prevented (no `child_process.exec` with user input)
- [ ] SQL injection prevented (parameterized queries, ORM usage)
- [ ] No secrets in environment variables committed to source
- [ ] Dependencies audited (`npm audit`)
- [ ] Dependencies pinned with exact versions or lock files
- [ ] No `innerHTML` or DOM manipulation with user input (server-side)

### 5. Package Management

- [ ] No unused dependencies (`npm ls --depth=0`)
- [ ] `package-lock.json` or `pnpm-lock.yaml` committed
- [ ] Scripts in `package.json` are safe (no inline shell scripts)
- [ ] Peer dependencies correctly declared
- [ ] Types package installed for JS projects (`@types/*`)

### 6. Error Handling

- [ ] Centralized error handling middleware
- [ ] Errors logged with stack traces in development
- [ ] Errors sanitized before sending to client
- [ ] Graceful shutdown handling (`process.on('SIGTERM')`)
- [ ] Connection pools closed on shutdown

## Framework Conventions

### Express

- [ ] Middleware order correct (logging → auth → routes → error handler)
- [ ] `express.json()` body parser limit set
- [ ] `helmet` or equivalent security middleware used
- [ ] `compression` used for response compression

### Fastify

- [ ] Plugins encapsulate their own dependencies
- [ ] Decorators scoped correctly (request vs. fastify instance)
- [ ] `schema` validation on routes

### Hono

- [ ] Middleware used correctly (order matters)
- [ ] Context passed correctly through async middleware
- [ ] Hono's built-in security headers used

## Report Structure

Follow `COMMON.md` for the overall format. In the Node.js section, organize findings by:

1. Async / Event Loop Issues
2. Security Issues
3. API / HTTP Issues
4. Dependency Issues
5. Error Handling Issues

## Additional Resources

- Common methodology: [](../COMMON.md)
- Framework checklist: [CHECKLIST.md](CHECKLIST.md)
- Correct/incorrect patterns: [PATTERNS.md](PATTERNS.md)
