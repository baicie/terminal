# Code Review Checklist

Printable checklist ensuring no critical review point is skipped.

---

## 1. Architecture

- [ ] **State Management**
  - [ ] Single library used throughout (Zustand, MobX, Redux, etc.)
  - [ ] No mixing of state management paradigms
  - [ ] Store files are reasonably sized (≤500 lines)

- [ ] **Module Design**
  - [ ] Single-responsibility files
  - [ ] No god classes or files with too many concerns
  - [ ] No circular dependencies
  - [ ] Clear public API boundaries

- [ ] **Dependency Injection**
  - [ ] DI container usage is consistent
  - [ ] No new-ting of service classes bypassing DI

---

## 2. Logic

### Error Handling

- [ ] **Database Operations**
  - [ ] `executeQuery` / `select` have try-catch
  - [ ] Batch operations use transactions
  - [ ] Errors are logged with context

- [ ] **Network / I/O**
  - [ ] `connect` failures have retry or clear error messages
  - [ ] `disconnect` cleanup is robust (even on error)
  - [ ] Timeouts are set appropriately

- [ ] **Async**
  - [ ] No unhandled Promise rejections
  - [ ] No race conditions in concurrent operations
  - [ ] Async loops correctly await

### Imports

- [ ] **Static vs Dynamic**
  - [ ] No unnecessary dynamic `import()`
  - [ ] Static imports at the top of files

### Edge Cases

- [ ] **Null / Undefined**
  - [ ] Function parameters validated
  - [ ] Optional chaining `?.` used correctly
  - [ ] Empty array iteration is safe

- [ ] **Extreme Inputs**
  - [ ] Large numbers don't overflow
  - [ ] Very long strings are truncated or handled
  - [ ] Special characters are escaped correctly

---

## 3. Security

### Sensitive Data

- [ ] **Credentials**
  - [ ] Passwords not stored in plain text (use Keychain, Vault, or encrypted storage)
  - [ ] Private key passphrases not stored in plain text
  - [ ] API tokens are encrypted or use secure storage

- [ ] **Logging**
  - [ ] Passwords / tokens never appear in logs
  - [ ] Error messages don't expose internal details to users

### SQL Security

- [ ] **Parameterized Queries**
  - [ ] All SQL uses `?` placeholders
  - [ ] No SQL built by string concatenation with user input
  - [ ] LIKE queries escape special characters (`%`, `_`)

### API Security

- [ ] **Transport**
  - [ ] HTTPS used for all external requests
  - [ ] No sensitive data in URL query strings
  - [ ] CORS configured correctly

- [ ] **Input Validation**
  - [ ] User input is validated on both client and server
  - [ ] File paths are sandboxed (no path traversal)

---

## 4. Performance

### Rendering

- [ ] **Large Lists**
  - [ ] Lists with 100+ items use virtualization (react-virtual, @tanstack/virtual)
  - [ ] Pagination considered for very large datasets

- [ ] **UI Framework Optimization**
  - [ ] `useMemo` / `useCallback` used appropriately
  - [ ] Dependency arrays are minimal and correct
  - [ ] No unnecessary re-renders

### Network

- [ ] **Data Streaming**
  - [ ] Terminal / stream data has buffering
  - [ ] Large payloads are chunked or streamed

- [ ] **Request Efficiency**
  - [ ] Batch operations merge requests where possible
  - [ ] No unnecessary individual requests in loops

### Memory

- [ ] **Resource Cleanup**
  - [ ] Component unmount cancels subscriptions
  - [ ] Large data structures are dereferenced when done
  - [ ] No memory leaks from event listeners

---

## 5. TypeScript / Types

### Type Discipline

- [ ] **No `any`**
  - [ ] `@typescript-eslint/no-explicit-any` set to warn or error
  - [ ] `unknown` used instead of `any` where type is uncertain
  - [ ] Type assertions (`as`) are rare and documented

- [ ] **Generics**
  - [ ] `Map` has type parameters: `Map<string, Foo>`
  - [ ] Arrays typed consistently: `Foo[]` or `Array<Foo>`
  - [ ] Return types explicitly declared

### Type Exports

- [ ] **Clarity**
  - [ ] Types exported from a single source of truth (`types/index.ts`)
  - [ ] No duplicate type re-exports
  - [ ] Comments explain types coming from other modules

### Type Narrowing

- [ ] **Guards**
  - [ ] `typeof` checks used before type-sensitive operations
  - [ ] `instanceof` checks for class instances
  - [ ] Custom type guard functions for complex narrowing

---

## 6. Project Configuration

### ESLint / Linter

- [ ] **Rules**
  - [ ] `@typescript-eslint/no-explicit-any` is warn/error
  - [ ] `@typescript-eslint/consistent-type-imports` enabled
  - [ ] `no-console` considered for production builds
  - [ ] No overly permissive rule disables

### Dependencies

- [ ] **Health**
  - [ ] No unused dependencies (run `pnpm why <pkg>`)
  - [ ] No circular peer dependencies
  - [ ] Dependencies are not severely outdated
  - [ ] Security advisories addressed

### Path Configuration

- [ ] **Aliases**
  - [ ] `@/` alias used consistently
  - [ ] No abuse of relative paths (`../../../../`)
  - [ ] Path imports are not excessively long (extract common prefix)

---

## Quick-Fix Cheatsheet

| # | Issue | File | Fix |
|---|-------|------|-----|
| 1 | Remove unused mobx | `package.json` | `pnpm remove mobx mobx-react mobx-react-lite` |
| 2 | Remove unused DI framework | `package.json` | `pnpm remove tsyringe reflect-metadata` |
| 3 | Unify ID generation | `src/store/host.ts` | Replace `Math.random` with `crypto.randomUUID()` |
| 4 | Replace dynamic import | `src/service/ssh.ts` | Move `import()` to file top as static import |
| 5 | Add DB error handling | `src/service/database.ts` | Wrap all queries in try-catch |
| 6 | Virtualize long lists | `src/view/hosts/index.tsx` | Add `@tanstack/react-virtual` |
| 7 | Fix Map type params | `src/store/terminal.ts` | `new Map<string, Session>()` |
| 8 | Escape LIKE queries | `src/service/database.ts` | `query.replace(/[%_]/g, '\\$&')` |

---

*Last updated: 2026-03-25*
