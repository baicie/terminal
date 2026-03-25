# Code Review Checklist — Python

Exhaustive per-dimension checklist for Python projects.

---

## 1. Type Hints

- [ ] All function signatures have type hints
- [ ] Return type `-> None` for procedures (not `-> None` omitted)
- [ ] No `Any` in function signatures (except `# type: ignore` justified)
- [ ] Generics used correctly: `list[int]`, `dict[str, Any]`, not `List[int]`, `Dict[str, Any]`
- [ ] `Optional[X]` used or `X | None` used consistently
- [ ] `Union[X, Y]` vs `X | Y` used consistently
- [ ] Type aliases defined for complex repeated types
- [ ] `mypy --strict` passes (or declared `--strictness` level met)
- [ ] `Protocol` used for structural subtyping
- [ ] `TypeVar` used for generic functions
- [ ] `cast()` used only when mypy can't infer and runtime type is known
- [ ] `# type: ignore` comments justified with explanation

---

## 2. Async Patterns

- [ ] All async functions declared `async def`
- [ ] No blocking calls in async functions:
  - `time.sleep` → `asyncio.sleep`
  - `requests.get` → `aiohttp` or `httpx.AsyncClient`
  - `socket.recv` → `asyncio.open_connection`
  - `os.listdir` → `asyncio.to_thread(os.listdir)`
- [ ] `asyncio.gather` used for concurrent tasks
- [ ] `asyncio.create_task` stored in a collection for later cleanup
- [ ] `asyncio.CancelledError` handled or propagated correctly
- [ ] `async with` used for async context managers
- [ ] `async for` used for async iterables
- [ ] No `async def` in `__init__` — use factory pattern
- [ ] `asyncio.Event` / `asyncio.Condition` used for synchronization
- [ ] Background tasks registered with lifecycle management

---

## 3. Security

- [ ] No `eval()`, `exec()`, `compile()` with user input
- [ ] SQL: parameterized queries only (`?` or named params), ORM used
- [ ] No `subprocess.run(shell=True)` or `os.system` with user input
- [ ] YAML loaded with `yaml.safe_load` (not `yaml.load`)
- [ ] `pickle` not used with untrusted data
- [ ] `secrets` module used for CSRF tokens, session IDs, passwords
- [ ] No hardcoded secrets — use `os.environ` or `pydantic-settings`
- [ ] File path validated against traversal attacks
- [ ] User-uploaded files stored outside web root, served via handler
- [ ] Input validation on all public-facing functions
- [ ] HTML escaped before rendering (Jinja2 auto-escapes, be careful with `| safe`)

---

## 4. Django / Flask / FastAPI

### Django
- [ ] `select_related` on `ForeignKey` / `OneToOneField` queries
- [ ] `prefetch_related` on `ManyToManyField` / reverse FK queries
- [ ] N+1 queries identified and fixed (use `django-debug-toolbar`)
- [ ] `bulk_create`, `bulk_update` for batch inserts
- [ ] `only()` / `defer()` used when full model isn't needed
- [ ] `values()` / `values_list()` for dict/tuple results
- [ ] `@login_required` on views requiring auth
- [ ] `@transaction.atomic` for multi-model writes
- [ ] Migrations are atomic and tested
- [ ] Signals used sparingly (side effects tracked)
- [ ] `F()` expressions used for database-level computations

### Flask
- [ ] `create_app()` factory pattern used
- [ ] Blueprints for modular routing
- [ ] `g` object for request-scoped data (not global variables)
- [ ] `current_app` accessed within request context
- [ ] `abort()` used for HTTP error responses
- [ ] `make_response` for custom responses

### FastAPI
- [ ] Pydantic models for all request/response bodies
- [ ] `Depends()` for dependency injection
- [ ] `BackgroundTasks` for async side effects (not `asyncio.create_task`)
- [ ] `async def` for I/O-bound handlers, `def` for sync handlers
- [ ] `response_model` declared on endpoints
- [ ] `HTTPException` used for expected errors
- [ ] Middleware order correct
- [ ] OpenAPI schema reviewed for correctness

---

## 5. Performance

- [ ] List comprehensions for simple transformations
- [ ] Generator expressions for large or infinite sequences
- [ ] `itertools` used for efficient iteration
- [ ] `@functools.lru_cache` or `@functools.cache` for memoization
- [ ] No mutable default arguments (`def f(items=None)` → `def f(items=None): if items is None: items=[]`)
- [ ] `__slots__` on frequently instantiated classes
- [ ] `dataclasses` or `attrs` for plain data objects
- [ ] DB connection pooling configured (`pool_size`, `max_overflow`)
- [ ] HTTP client pooling configured (`httpx` or `aiohttp`)
- [ ] Response streaming for large files
- [ ] `cProfile` or `py-spy` used for profiling
- [ ] No string concatenation in loops (`''.join()`)

---

## 6. Project Conventions

- [ ] `pyproject.toml` used (not `setup.py` / `setup.cfg` for new projects)
- [ ] Virtual environment activated or container used
- [ ] `ruff` configured (or `flake8` + `isort` + `mypy`)
- [ ] `black` or `ruff format` configured
- [ ] `pytest` for testing (or `unittest` for stdlib)
- [ ] Fixtures used in pytest (not manual setup/teardown)
- [ ] Parametrized tests for multiple cases
- [ ] No `from module import *` imports
- [ ] Absolute imports used in packages
- [ ] `__all__` declared in `__init__.py`
- [ ] Docstrings on public modules, classes, and functions
- [ ] `conftest.py` for shared pytest fixtures

---

*Last updated: 2026-03-25*
