---
name: code-review
description: Multi-framework code review dispatcher. Routes to the correct language/framework skill (React/TypeScript, Rust, Node.js, Python, Go, Tauri) based on detected file extensions and project structure. Use when the user asks for a code review, quality check, or review report — the dispatcher selects the appropriate specialized skill automatically.
---

# Code Review Skill — Dispatcher

Routes to the correct framework-specific review skill.

## How Dispatching Works

1. **Detect the stack** — scan file extensions and package metadata
2. **Select the skill** — route to the most specific matching skill
3. **Execute the review** — follow the selected skill's methodology
4. **Output the report** — merge findings into a unified report

## Stack → Skill Mapping

| Stack | Skill | Triggers |
|-------|-------|----------|
| React + TypeScript | `react-typescript/` | `.tsx`, `.jsx`, `package.json` with `react` |
| Rust | `rust/` | `.rs`, `Cargo.toml` |
| Node.js / JavaScript | `node/` | `package.json` without `react`, `.js`, `.mjs` |
| Python | `python/` | `.py`, `requirements.txt`, `pyproject.toml` |
| Go | `go/` | `.go`, `go.mod` |
| Tauri (Rust + Web) | `tauri/` | `src-tauri/`, `tauri.conf.json` |

## Skill Priority

When multiple stacks are detected, prefer in this order:

1. **Tauri** — if `src-tauri/` or `tauri.conf.json` found
2. **React + TypeScript** — if `.tsx`/`.jsx` files found
3. **Rust** — if `.rs` files found
4. **Go** — if `.go` files found
5. **Python** — if `.py` files found
6. **Node.js** — fallback for JavaScript projects

## Per-Framework Skills

Each framework skill contains:

- **SKILL.md** — framework-specific review dimensions and workflow
- **CHECKLIST.md** — exhaustive checklist of review items
- **PATTERNS.md** — correct vs. incorrect code pattern pairs

### React / TypeScript

`react-typescript/`

- Hook dependency correctness
- React Server Components vs. Client Components
- TypeScript strictness
- React 19 / Next.js / Vite conventions

### Rust

`rust/`

- Ownership and borrowing correctness
- Async patterns with Tokio
- Error handling with `Result`/`Option`
- Trait design and generics

### Node.js

`node/`

- Async patterns (callbacks vs. Promises vs. async/await)
- Event loop blocking
- Package security
- Express/Fastify/Hono conventions

### Python

`python/`

- Type hints and mypy compliance
- Async patterns with asyncio
- Django/Flask/FastAPI conventions
- Security (SQL injection, command injection)

### Go

`go/`

- Goroutine leaks
- Error wrapping
- Interface design
- Context propagation

### Tauri

`tauri/`

- Tauri command design
- IPC between Rust and web layer
- Security capabilities
- Rust + TypeScript integration

## Output

When multiple frameworks are present, produce a **unified report** with a per-framework section:

```
# Code Review Report — <project>

## Summary

| ID | Severity | Framework | Description |
|----|----------|-----------|-------------|
| 1  | 🟡       | Rust      | Unchecked arithmetic |
| 2  | 🟢       | TypeScript | Redundant type assertion |

## React / TypeScript Findings
...

## Rust Findings
...
```

## Language

All output is written in **English**.

## Additional Resources

- Common methodology: [COMMON.md](COMMON.md)
- Framework-specific skills: see subdirectories
