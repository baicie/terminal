# Code Review Checklist — React / TypeScript

Exhaustive per-dimension checklist for React + TypeScript projects.

---

## 1. React Patterns

### Hooks

- [ ] `useEffect` has all necessary dependencies, no extra deps
- [ ] `useEffect` cleanup function returns correctly (unsubscribe, cancel timers)
- [ ] No async `useEffect` without wrapper (use `useEffect(() => { fn(); }, [])` pattern)
- [ ] `useCallback` wraps callbacks passed to child components
- [ ] `useMemo` wraps expensive computed values
- [ ] `useRef` used for mutable values that don't trigger re-renders
- [ ] Custom hooks extract reusable logic (not one-off effect logic)
- [ ] `useReducer` considered when state logic is complex

### Component Design

- [ ] Components are pure — same props → same output
- [ ] No side effects in render method (no `fetch`, no `setState`)
- [ ] Props interface defined (no `any` props)
- [ ] Controlled vs. uncontrolled components followed for forms
- [ ] Error boundaries used around error-prone child components
- [ ] Fragments used to avoid unnecessary DOM nodes
- [ ] `React.memo` used for expensive pure components (not overused)

### State Management

- [ ] State colocated — don't lift state higher than necessary
- [ ] State updates are immutable (`{ ...state, value }`, not `state.value = x`)
- [ ] Derived state computed (not stored separately)
- [ ] Loading / error / data pattern for async state
- [ ] State reset handled on relevant prop changes

---

## 2. TypeScript Strictness

- [ ] `noImplicitAny` enabled
- [ ] `strictNullChecks` enabled
- [ ] `noUncheckedIndexedAccess` considered
- [ ] `exactOptionalPropertyTypes` considered
- [ ] Return types declared on all exported functions
- [ ] Discriminated unions for state machines
- [ ] `unknown` used instead of `any` where type is uncertain
- [ ] Type guards used to narrow `unknown` or union types
- [ ] No `as` casts without `// TODO: refine type` comment
- [ ] `interface` used for object shapes, `type` for unions/intersections
- [ ] Generics used for reusable component props

---

## 3. State Management Libraries

### Zustand

- [ ] Single store per concern (not one giant store)
- [ ] Selectors used to subscribe to slices (`useStore(s => s.count)`)
- [ ] No storing derived/computed data
- [ ] Async actions handled correctly (loading state)
- [ ] Store persisted with middleware (`persist`) only when needed

### MobX

- [ ] Observables used correctly
- [ ] Computed values marked `computed`
- [ ] Actions used for state mutations
- [ ] `observer()` HOC or hook used on components that observe store
- [ ] No MobX + Zustand mixing

### React Query / TanStack Query

- [ ] Query keys structured for cache invalidation
- [ ] `staleTime` and `gcTime` configured appropriately
- [ ] Optimistic updates handled correctly
- [ ] Mutations used for writes, queries for reads

---

## 4. Performance

- [ ] Lists with 100+ items virtualized (`@tanstack/react-virtual`)
- [ ] Heavy components lazy-loaded (`React.lazy` + `Suspense`)
- [ ] Route-based code splitting configured
- [ ] Images optimized (WebP, correct sizing, lazy loading)
- [ ] `loading="lazy"` on below-fold images
- [ ] `will-change` used sparingly (not blanket applied)
- [ ] Debounce on search inputs (`300ms` typical)
- [ ] Throttle on scroll handlers
- [ ] No inline functions in JSX `onClick`, `onChange` (use `useCallback`)
- [ ] No inline object literals in JSX props (creates new object on each render)
- [ ] CSS animations preferred over JS animations where possible
- [ ] `requestAnimationFrame` used for JS-driven animations

---

## 5. Security

- [ ] No `dangerouslySetInnerHTML` (or sanitized with `DOMPurify`)
- [ ] URLs validated before `window.open` (no `javascript:` scheme)
- [ ] User input escaped in HTML context
- [ ] Form inputs validated client-side (and server-side)
- [ ] No secrets in component code or props
- [ ] `localStorage` / `sessionStorage` not used for sensitive data
- [ ] WebSocket / SSE origins validated
- [ ] CSP meta tag configured

---

## 6. Project Conventions

### Naming

- [ ] Components: `PascalCase.tsx`
- [ ] Hooks: `useCamelCase.ts`
- [ ] Utils: `camelCase.ts`
- [ ] Constants: `UPPER_SNAKE_CASE`
- [ ] CSS modules / Tailwind: semantic naming

### Imports

- [ ] `@/` path alias used consistently
- [ ] No `../../../../` beyond 2 levels
- [ ] Type imports marked `import type { Foo }`
- [ ] No `import * as` (named imports only)
- [ ] No side-effect imports without comment

### shadcn/ui

- [ ] UI primitives from shadcn/ui (Button, Input, Dialog, etc.)
- [ ] No inline `className` hacks replacing proper component usage
- [ ] `cn()` utility used for merging classNames
- [ ] Components composed, not duplicated
- [ ] Theme variables used (`bg-primary`, `text-muted-foreground`)

### Vite

- [ ] Environment variables in `.env` files with `VITE_` prefix
- [ ] `process.env` not used in client code
- [ ] Proxy configured for dev server if needed
- [ ] Build configured for target browsers

---

*Last updated: 2026-03-25*
