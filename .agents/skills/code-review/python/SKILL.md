---
name: code-review-python
description: Code review skill for Python projects. Covers type hints and mypy compliance, async patterns with asyncio, Django/Flask/FastAPI conventions, security (SQL injection, command injection), and idiomatic Python. Use when reviewing Python codebases or when the user asks for a code review of Python code.
---

# Code Review — Python

Framework-specific skill for Python projects.

## Review Dimensions

### 1. Type Hints

- [ ] All function signatures have type hints (return type + arguments)
- [ ] No `Any` type abuse — use `Unknown` or structural types
- [ ] `mypy` passes with strict mode or declared strictness level
- [ ] Generics used correctly (`list[int]`, `dict[str, Any]`, not `List[int]`)
- [ ] `Optional[X]` used instead of `X | None` (or consistently using union syntax)
- [ ] `Union` vs. `Optional` used appropriately
- [ ] Type aliases defined for complex repeated types
- [ ] Protocol used for structural subtyping (duck typing with types)

### 2. Async Patterns

- [ ] `async def` / `await` used consistently
- [ ] No blocking synchronous calls in async functions (`time.sleep`, `requests.get`)
- [ ] `asyncio.to_thread` or `run_in_executor` for blocking I/O
- [ ] `asyncio.gather`, `asyncio.create_task` used correctly
- [ ] Tasks cancelled with proper cleanup (`asyncio.CancelledError` handling)
- [ ] Async context managers used (`async with`)
- [ ] No async in `__init__` — use factory pattern or lifecycle hooks

### 3. Security

- [ ] No `eval()` or `exec()` with user input
- [ ] SQL injection prevented — use parameterized queries or ORM
- [ ] Command injection prevented — never `subprocess` with shell strings
- [ ] YAML deserialization safe (avoid `yaml.load` without `Loader=`)
- [ ] Secrets not hardcoded — use environment variables or secret manager
- [ ] User input validated and sanitized
- [ ] File paths validated (no path traversal with `os.path.join` tricks)
- [ ] `shutil.rmtree`, `os.remove` guarded against symlink attacks

### 4. Django / Flask / FastAPI Conventions

#### Django
- [ ] Views use `LoginRequiredMixin` or `@login_required` where needed
- [ ] ORM queries use `.select_related` / `.prefetch_related` for related objects
- [ ] No N+1 queries in hot paths
- [ ] `bulk_create`, `bulk_update` used for batch operations
- [ ] Signals used for side effects, not overused
- [ ] Migrations are atomic (single migration = single concern)
- [ ] `values()` or `values_list()` used when full objects not needed

#### Flask
- [ ] Application factory pattern used (`create_app`)
- [ ] Blueprints used for modular routing
- [ ] `g` object used for request-scoped data
- [ ] `current_app` accessed within request context

#### FastAPI
- [ ] `Depends` used for dependency injection
- [ ] `BackgroundTasks` used for async side effects
- [ ] Pydantic models used for request/response validation
- [ ] `async` vs. sync endpoints chosen correctly (don't use sync for CPU-heavy)

### 5. Performance

- [ ] List comprehensions vs. generators — generators for large sequences
- [ ] `itertools` used for efficient iteration
- [ ] `@lru_cache` or `functools.cache` for memoization
- [ ] No mutable default arguments (`def foo(items=[])` → `def foo(items=None)`)
- [ ] `__slots__` used on frequently instantiated classes
- [ ] `dataclasses` / `attrs` for plain data objects (faster attribute access)
- [ ] Connections pooled for database and HTTP clients
- [ ] Streaming used for large responses

### 6. Project Conventions

- [ ] `pyproject.toml` or `setup.py` used correctly
- [ ] Virtual environment or container used (not system Python)
- [ ] `ruff` or `flake8` / `pylint` linting configured
- [ ] `black` or `ruff format` formatting configured
- [ ] `pytest` or `unittest` tests with reasonable coverage
- [ ] Docstrings on public modules and classes
- [ ] No `from module import *` imports
- [ ] Relative imports avoided in packages (use absolute imports)

## Common Pitfalls

- Mutable default argument: `def foo(items=[])` → always `def foo(items=None)`
- Blocking in async: `time.sleep` in `async def` → `await asyncio.sleep`
- Shadowing builtins: `list = [1, 2, 3]` → breaks built-in
- EAFP anti-pattern: `try/except` used to check type instead of `isinstance`
- Dict iteration mutation: `for k in d: d.pop(k)` → RuntimeError

## Report Structure

Follow `COMMON.md` for the overall format. In the Python section, organize findings by:

1. Type Safety Issues
2. Async / Concurrency Issues
3. Security Issues
4. Framework-Specific Issues
5. Performance Issues
6. Convention Violations

## Additional Resources

- Common methodology: [](../COMMON.md)
- Framework checklist: [CHECKLIST.md](CHECKLIST.md)
- Correct/incorrect patterns: [PATTERNS.md](PATTERNS.md)
