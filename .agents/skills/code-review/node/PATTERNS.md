# Code Review Patterns — Node.js / JavaScript

Correct vs. incorrect code patterns for fast, evidence-backed judgments during review.

---

## 1. Async — await All Parallel Operations

### Correct — Promise.all

```javascript
// ✅ Parallel fetch — both requests run concurrently
const [users, posts] = await Promise.all([
  fetch('/api/users').then(r => r.json()),
  fetch('/api/posts').then(r => r.json()),
])
```

### Incorrect — Sequential awaits

```javascript
// ❌ Sequential — second request waits for first to complete
const users = await fetch('/api/users').then(r => r.json())
const posts = await fetch('/api/posts').then(r => r.json())  // ⚠️ waited unnecessarily
```

---

## 2. Async — Error Handling with try/catch

### Correct — try/catch Wrapper

```javascript
async function getUser(id) {
  try {
    const response = await fetch(`/api/users/${id}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } catch (error) {
    console.error('Failed to fetch user:', error)
    throw error  // re-throw so caller can handle
  }
}
```

### Incorrect — Unhandled Rejection

```javascript
// ❌ No catch — unhandled rejection crashes the process
async function getUser(id) {
  const response = await fetch(`/api/users/${id}`)
  return response.json()  // ⚠️ throws if network error, no handler
}
```

---

## 3. Child Process — execFile Not exec

### Correct — execFile with Args Array

```javascript
const { execFile } = require('child_process')

// ✅ args as array — no shell interpretation
execFile('node', ['--version'], (error, stdout) => {
  if (error) throw error
  console.log(stdout)
})
```

### Incorrect — exec with String

```javascript
// ❌ exec uses shell — command injection risk with user input
const { exec } = require('child_process')
const userInput = '&& rm -rf /'
exec(`node --version ${userInput}`, (error, stdout) => {
  // ⚠️ command injection — userInput can run arbitrary commands
})
```

---

## 4. SQL — Parameterized Queries

### Correct — Parameterized

```javascript
// ✅ Parameterized — SQL injection safe
const users = await db.query(
  'SELECT * FROM users WHERE id = $1 AND status = $2',
  [userId, 'active']
)
```

### Incorrect — String Concatenation

```javascript
// ❌ SQL injection — user input directly in query string
const userId = req.query.id  // e.g. "1; DROP TABLE users;--"
const users = await db.query(
  `SELECT * FROM users WHERE id = ${userId}`  // ⚠️ SQL injection
)
```

---

## 5. Environment Variables — No Secrets in Code

### Correct — env var

```javascript
// ✅ Loaded from environment — not in source
const apiKey = process.env.STRIPE_SECRET_KEY
if (!apiKey) throw new Error('STRIPE_SECRET_KEY not set')

stripe.charges.create({ amount: 100, currency: 'usd' })
```

### Incorrect — Hardcoded Secret

```javascript
// ❌ Secret in source code — committed to git history
const apiKey = 'sk_live_abc123xyz789'  // ⚠️ leaked secret
stripe.charges.create({ amount: 100, currency: 'usd' })
```

---

## 6. Streams — Backpressure Handling

### Correct — Pipeline with Backpressure

```javascript
const { pipeline } = require('stream/promises')

// ✅ pipeline handles backpressure automatically
await pipeline(
  fs.createReadStream('large-file.zip'),
  zlib.createGzip(),
  fs.createWriteStream('large-file.zip.gz')
)
```

### Incorrect — Pipe Without Backpressure

```javascript
// ❌ pipe() doesn't handle backpressure — memory overflow on large files
const readStream = fs.createReadStream('huge-file.bin')
const writeStream = fs.createWriteStream('output.bin')
readStream.pipe(writeStream)  // ⚠️ fast reader overwhelms slow writer
```

---

## 7. Express — Async Error Handler

### Correct — express-async-errors

```javascript
require('express-async-errors')  // ✅ wraps all handlers

app.get('/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id)
  res.json(user)  // ✅ async errors automatically forwarded to error handler
})

app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message })  // ✅ catches async errors
})
```

### Incorrect — Missing Async Error Handler

```javascript
app.get('/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id)
  res.json(user)
  // ❌ if User.findById throws, error is silently swallowed
  //    (Express doesn't catch async errors by default in older versions)
})
```

---

## 8. Graceful Shutdown

### Correct — Signal Handling

```javascript
const server = app.listen(3000)

async function shutdown() {
  console.log('SIGTERM received — shutting down')
  server.close(async () => {
    await db.pool.end()  // ✅ close DB connections
    console.log('Shutdown complete')
    process.exit(0)
  })
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
```

### Incorrect — No Cleanup

```javascript
// ❌ Abrupt exit — connections dropped, no cleanup
process.on('SIGTERM', () => {
  process.exit(0)  // ⚠️ connections dropped, no graceful shutdown
})
```

---

## 9. Rate Limiting

### Correct — rate-limit-flexible

```javascript
const RateLimit = require('rate-limit-flexible')

const limiter = new RateLimit({
  storeClient: redis,
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,  // limit each IP to 100 requests per window
})

app.use('/api', limiter.middleware())  // ✅ rate limited
```

### Incorrect — No Rate Limiting

```javascript
// ❌ No rate limiting — vulnerable to brute force and DoS
app.post('/api/login', async (req, res) => {
  const user = await authenticate(req.body)
  res.json(user)
})
```

---

## 10. Worker Threads — CPU Work

### Correct — Offload to Worker

```javascript
// main.js
const { Worker } = require('worker_threads')

const worker = new Worker('./crypto-worker.js', {
  workerData: { password, salt }
})

worker.on('message', (hash) => console.log('Hash:', hash))
worker.on('error', (err) => console.error('Worker error:', err))
```

### Incorrect — Blocking Event Loop

```javascript
// ❌ bcrypt is CPU-intensive — blocks the event loop
const bcrypt = require('bcrypt')
app.post('/hash', async (req, res) => {
  const hash = await bcrypt.hash(req.body.password, 10)
  // ⚠️ blocks all concurrent requests during hash
  res.json({ hash })
})
```

---

*Last updated: 2026-03-25*
