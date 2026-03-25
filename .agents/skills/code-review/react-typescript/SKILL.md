---
name: code-review-react-typescript
description: Code review skill for React + TypeScript projects. Covers React 19, Next.js, Vite, shadcn/ui, Tailwind CSS, Zustand, MobX, React Query, and general TypeScript strictness. Use when reviewing React/TypeScript codebases or when the user asks for a code review of frontend code.
---

# Code Review — React / TypeScript

Framework-specific skill for React and TypeScript projects.

## Review Dimensions

### 1. React Patterns

- [ ] Component purity — no side effects in render
- [ ] Hook dependency arrays are minimal and correct
- [ ] No missing cleanup in `useEffect`
- [ ] `useCallback` / `useMemo` used for expensive operations, not overused
- [ ] Context usage — not overused, values are memoized
- [ ] Server Components vs. Client Components boundaries are correct
- [ ] No prop drilling — use Context or composition instead

### 2. TypeScript Strictness

- [ ] No `any` type — use `unknown` when type is uncertain
- [ ] `@typescript-eslint/no-explicit-any` set to warn or error
- [ ] `@typescript-eslint/consistent-type-imports` enabled
- [ ] Explicit return types on public functions
- [ ] No non-null assertions (`!`) without justification
- [ ] Discriminated unions used for state machines / request states
- [ ] `interface` vs. `type` used appropriately

### 3. State Management

- [ ] Single source of truth — no duplicate state
- [ ] Zustand / MobX / Redux used consistently (no mixing)
- [ ] Derived state computed (not stored manually)
- [ ] Async state handled with loading / error / data triple
- [ ] State updates are immutable
- [ ] No prop-drilled callbacks — use context or state management

### 4. Performance

- [ ] Large lists virtualized (react-virtual, @tanstack/virtual)
- [ ] Images lazy-loaded with `loading="lazy"` or IntersectionObserver
- [ ] Heavy components code-split with `React.lazy` + `Suspense`
- [ ] `useMemo` for expensive computations
- [ ] `useCallback` for stable callback references
- [ ] No inline object/array literals in JSX props (causes re-renders)
- [ ] Debounce / throttle on frequent events (search input, resize)

### 5. Security

- [ ] No `dangerouslySetInnerHTML` without sanitization
- [ ] User input validated before use
- [ ] No secrets in component code or props
- [ ] URLs validated before opening (especially `javascript:` links)
- [ ] XSS prevention — escape user data in HTML context

### 6. Project Conventions

- [ ] Component file naming: `PascalCase.tsx`
- [ ] Hook naming: `use` prefix
- [ ] Path alias `@/` used consistently
- [ ] No relative path abuse (`../../../../`)
- [ ] shadcn/ui components used for UI primitives (no Ant Design)
- [ ] Tailwind classes used for styling (no inline styles except dynamic values)
- [ ] ESLint `@typescript-eslint` rules enabled appropriately

## React 19 Specific

- [ ] `use()` hook used correctly (not in render)
- [ ] New `ref` as prop pattern followed
- [ ] Action functions properly typed
- [ ] Server Component data fetching patterns observed

## Vite / Build

- [ ] Dynamic imports used for route-based splitting
- [ ] Environment variables typed and validated
- [ ] No `process.env` in client code

## Report Structure

Follow `COMMON.md` for the overall format. In the TypeScript/React section, organize findings by:

1. Component / Hook Issues
2. Type Safety Issues
3. State Management Issues
4. Performance Issues
5. Convention Violations

## Additional Resources

- Common methodology: [](../COMMON.md)
- Framework checklist: [CHECKLIST.md](CHECKLIST.md)
- Correct/incorrect patterns: [PATTERNS.md](PATTERNS.md)
