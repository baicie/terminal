# Code Review Patterns — Python

Correct vs. incorrect code patterns for fast, evidence-backed judgments during review.

---

## 1. Type Hints — Modern Syntax

### Correct — Modern Generics

```python
from typing import Optional, Union

def process(items: list[int], threshold: int) -> dict[str, int]:
    return {str(i): i for i in items if i > threshold}
```

### Incorrect — Old-Style Imports

```python
# ❌ Old typing.List, typing.Dict — not compatible with newer Python
from typing import List, Dict

def process(items: List[int], threshold: int) -> Dict[str, int]:
    return {str(i): i for i in items if i > threshold}
```

---

## 2. Mutable Default Arguments

### Correct — None Default

```python
def send_emails(recipients: list[str], template: str, cc: list[str] | None = None) -> int:
    cc = cc or []  # ✅ creates new list each call
    for recipient in recipients:
        send(recipient, template, cc)
    return len(recipients)
```

### Incorrect — Mutable Default

```python
# ❌ Mutable default argument shared across all calls
def send_emails(recipients: list[str], template: str, cc: list[str] = []) -> int:
    cc.append("default@example.com")  # ⚠️ mutates default — persists across calls
    for recipient in recipients:
        send(recipient, template, cc)
```

---

## 3. Async — Blocking Calls in Async

### Correct — aiohttp for Async HTTP

```python
import aiohttp

async def fetch_user(session: aiohttp.ClientSession, user_id: int) -> dict:
    url = f"https://api.example.com/users/{user_id}"
    async with session.get(url) as response:
        return await response.json()
```

### Incorrect — requests in Async

```python
import asyncio
import requests

async def fetch_user(user_id: int) -> dict:
    # ❌ requests is synchronous — blocks the event loop
    response = requests.get(f"https://api.example.com/users/{user_id}")
    return response.json()  # ⚠️ blocks entire event loop during network I/O
```

---

## 4. Security — YAML Safe Load

### Correct — Safe Loader

```python
import yaml

with open("config.yaml") as f:
    config = yaml.safe_load(f)  # ✅ safe — no arbitrary code execution
```

### Incorrect — Unsafe Loader

```python
import yaml

with open("config.yaml") as f:
    config = yaml.load(f, Loader=yaml.FullLoader)  # ⚠️ or worse: yaml.load(f)
    # ⚠️ yaml.load without Loader= can execute arbitrary Python code
```

---

## 5. Security — SQL Parameterized

### Correct — Parameterized

```python
import psycopg2

def get_user(user_id: int) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, name, email FROM users WHERE id = %s",
            (user_id,)
        )
        row = cur.fetchone()
        return dict(row) if row else None
```

### Incorrect — String Formatting

```python
# ❌ SQL injection — user_id directly in query string
def get_user(user_id: int) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT id, name, email FROM users WHERE id = {user_id}"  # ⚠️ SQL injection
        )
```

---

## 6. Context Manager — Async

### Correct — async with

```python
import aiofiles

async def read_config(path: str) -> str:
    async with aiofiles.open(path) as f:  # ✅ async context manager
        return await f.read()
```

### Incorrect — sync open in async

```python
# ❌ open() is synchronous — blocks the event loop
async def read_config(path: str) -> str:
    with open(path) as f:  # ⚠️ blocks event loop
        return f.read()
```

---

## 7. Iteration — Generator vs. List

### Correct — Generator Expression

```python
# ✅ Generator — lazy evaluation, O(1) memory
def find_matching_users(users: list[User], pattern: str) -> Iterator[User]:
    return (u for u in users if pattern.lower() in u.name.lower())
```

### Incorrect — List Comprehension in Memory

```python
# ❌ List comprehension — O(n) memory for large datasets
def find_matching_users(users: list[User], pattern: str) -> list[User]:
    return [u for u in users if pattern.lower() in u.name.lower()]
```

---

## 8. Django — Select Related

### Correct — select_related

```python
# ✅ Single query with JOIN — no N+1
posts = Post.objects.select_related('author', 'category').filter(
    published=True
)[:20]

for post in posts:
    print(post.author.name)  # ✅ no additional query
    print(post.category.name)  # ✅ no additional query
```

### Incorrect — N+1 Queries

```python
# ❌ N+1 problem — 1 query for posts + N queries for authors + M for categories
posts = Post.objects.filter(published=True)[:20]

for post in posts:
    print(post.author.name)  # ⚠️ 1 additional query per iteration
    print(post.category.name)  # ⚠️ 1 additional query per iteration
```

---

## 9. FastAPI — Pydantic Models

### Correct — Typed Request/Response

```python
from pydantic import BaseModel

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    age: int | None = None

class UserResponse(BaseModel):
    id: int
    name: str
    email: str

@router.post("/users", response_model=UserResponse)
def create_user(user: UserCreate) -> UserResponse:
    new_user = User.objects.create(**user.model_dump())
    return UserResponse.model_validate(new_user)
```

### Incorrect — dict Without Validation

```python
# ❌ No request/response validation — accepts anything
@router.post("/users")
def create_user(request: Request):
    data = await request.json()
    new_user = User.objects.create(**data)
    return {"id": new_user.id, **data}
```

---

## 10. functools — LRU Cache

### Correct — Cached Expensive Computation

```python
from functools import lru_cache

@lru_cache(maxsize=128)
def expensive_computation(n: int) -> int:
    # CPU-intensive work
    return sum(i * i for i in range(n))
```

### Incorrect — Repeated Computation

```python
# ❌ No caching — recomputes every call
def expensive_computation(n: int) -> int:
    return sum(i * i for i in range(n))
```

---

*Last updated: 2026-03-25*
