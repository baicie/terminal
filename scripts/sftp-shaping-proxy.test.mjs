// 代理本身必须先被证明可信，否则「慢网络下的产品行为」全是猜测。
//
// 四件事要验证：
//
//   1. **字节不变**：穿过代理的数据与直连完全一致（SHA-256 对照）；
//   2. **延迟可观测**：设了 delay 的传输确实更慢，且量级对得上；
//   3. **限速可观测**：设了 rate 的传输时间与文件大小/速率相符；
//   4. **断流是真的截断**：cutAfterBytes 之后接收方拿到的字节数少于完整文件，且
//      连接被销毁（不是礼貌地关闭）。
//
// 第 4 条尤其重要：如果代理只是「关掉一个方向的写」而另一端还能读完缓冲，那它模拟的
// 是优雅关闭，不是断流——两者对产品是不同的事件。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer, connect } from 'node:net'
import { afterEach, describe, it } from 'node:test'
import { startShapingProxy } from './sftp-shaping-proxy.mjs'

/** A server that echoes back exactly what it receives, and reports what it got. */
function startEchoServer() {
  const received = []
  const server = createServer(socket => {
    /*
     * Both handlers are required, and the `error` one is not cosmetic.
     *
     * The proxy resets connections to simulate a cut. Without an `error` listener here,
     * the echo server's `socket.write` throws `EPIPE` out of the event loop and aborts
     * the whole test run — measured, and it looked like "the proxy test failed" rather
     * than "the cut worked".
     */
    socket.on('data', chunk => {
      received.push(...chunk)
      if (!socket.destroyed) socket.write(chunk)
    })
    socket.on('error', () => {
      socket.destroy()
    })
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        received,
        close: () => new Promise(done => server.close(done)),
      })
    })
  })
}

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')

/** Send `payload` through `port` and collect everything that comes back. */
function roundTrip(port, payload, { timeoutMs = 30_000, expectBytes = null } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const socket = connect(port, '127.0.0.1')
    // `end` means the peer closed the write side cleanly; `close` can follow it, and a
    // destroy produces `close` without `end`. The two must be distinguishable, because
    // "truncated by a reset" and "truncated by a polite close" are different events to
    // the product. `end` is therefore recorded and `close` settles the promise.
    let endedCleanly = false
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`round trip did not finish within ${timeoutMs} ms`))
    }, timeoutMs)
    const settle = extra => {
      clearTimeout(timer)
      resolve({ bytes: Buffer.concat(chunks), ended: endedCleanly, ...extra })
    }
    socket.on('connect', () => socket.write(payload))
    socket.on('data', chunk => {
      chunks.push(chunk)
      // A caller that expects the echo back can finish as soon as it has it: the echo
      // server never closes, so waiting for `close` would wait for the timeout.
      if (expectBytes !== null && Buffer.concat(chunks).length >= expectBytes) {
        socket.destroy()
        settle()
      }
    })
    socket.on('end', () => {
      endedCleanly = true
    })
    /*
     * An unhandled `error` on a net.Socket throws out of the event loop and aborts the
     * test — measured: `Error: read ECONNRESET` escaped and failed the run even though
     * the reset was the *expected* outcome. Both `error` and `close` settle the promise;
     * whichever comes first wins.
     */
    socket.on('close', () => settle())
    socket.on('error', error => settle({ error: error.code }))
  })
}

/** Deterministic, incompressible-ish bytes of a given size. */
function payload(size) {
  const buffer = Buffer.alloc(size)
  let state = 0x12345678
  for (let index = 0; index < size; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    buffer[index] = state & 0xff
  }
  return buffer
}

let cleanup = []
afterEach(async () => {
  for (const dispose of cleanup) await dispose()
  cleanup = []
})

async function setup(options) {
  const echo = await startEchoServer()
  const proxy = await startShapingProxy({ targetPort: echo.port, ...options })
  cleanup.push(() => proxy.close(), () => echo.close())
  return { echo, proxy }
}

describe('sftp shaping proxy', () => {
  it('forwards bytes unchanged', async () => {
    // The baseline every other assertion depends on: a proxy that alters content would
    // make every downstream SHA-256 comparison meaningless.
    const { proxy } = await setup()
    const sent = payload(64 * 1024)
    const result = await roundTrip(proxy.port, sent, { expectBytes: sent.length })

    assert.equal(result.bytes.length, sent.length)
    assert.equal(sha256(result.bytes), sha256(sent), 'the echoed bytes must be identical')
  })

  it('a configured delay actually slows the transfer, by roughly what was asked', async () => {
    const { proxy } = await setup({ delayMs: { up: 25, down: 25 } })
    // 16 chunks of 4 KiB: every chunk pays the delay in each direction.
    const sent = payload(16 * 4 * 1024)
    const started = Date.now()
    const result = await roundTrip(proxy.port, sent, { expectBytes: sent.length })
    const elapsed = Date.now() - started

    assert.equal(sha256(result.bytes), sha256(sent))
    // A lower bound only: the point is that the delay is in the path, not that it is
    // exact. Timing assertions with an upper bound are the flaky ones.
    assert.ok(
      elapsed >= 40,
      `expected a measurable delay, got ${elapsed} ms for ${sent.length} bytes`,
    )
  })

  it('a configured rate bounds the throughput', async () => {
    // 256 KiB at 1 MiB/s ≈ 250 ms. Allow generous slack: the assertion is "the rate is
    // applied", not "the clock is precise".
    const { proxy } = await setup({ rateBytesPerSec: { up: 1024 * 1024, down: 0 } })
    const sent = payload(256 * 1024)
    const started = Date.now()
    const result = await roundTrip(proxy.port, sent, { expectBytes: sent.length })
    const elapsed = Date.now() - started

    assert.equal(sha256(result.bytes), sha256(sent))
    assert.ok(
      elapsed >= 150,
      `256 KiB at 1 MiB/s should take at least 150 ms, took ${elapsed} ms`,
    )
  })

  it('a cut truncates the stream and destroys the connection', async () => {
    /*
     * The difference that matters for the product: a truncated stream is not a graceful
     * close. If the proxy ended the write side politely, the reader would see EOF and a
     * hash of the partial file would "succeed" — which is exactly the failure T13's
     * disconnect test guards against.
     */
    const { proxy } = await setup({ cutAfterBytes: { up: 32 * 1024, down: 0 } })
    const sent = payload(128 * 1024)
    const result = await roundTrip(proxy.port, sent)

    assert.ok(
      result.bytes.length < sent.length,
      `the cut should truncate: got ${result.bytes.length} of ${sent.length} bytes`,
    )
    assert.equal(
      result.ended,
      false,
      'the connection should be reset, not ended politely: ' + JSON.stringify(result),
    )
    assert.ok(proxy.stats.cut >= 1, 'the proxy must record the cut')
  })

  it('a timed reset closes the connection even with no traffic', async () => {
    const { proxy } = await setup({ resetAfterMs: 120 })
    const sent = payload(1024)
    const started = Date.now()
    const result = await roundTrip(proxy.port, sent, { timeoutMs: 5_000 })
    const elapsed = Date.now() - started

    assert.ok(elapsed < 3_000, 'the reset should not wait for the round trip timeout')
    assert.equal(result.ended, false, 'a reset must not look like a clean end')
  })

  it('counts what it forwarded, per direction', async () => {
    // The stats are what a caller uses to prove traffic actually flowed; a proxy that
    // reports zero after a transfer would make "the file arrived" unfalsifiable.
    const { proxy } = await setup()
    const sent = payload(8 * 1024)
    await roundTrip(proxy.port, sent, { expectBytes: sent.length })

    assert.equal(proxy.stats.accepted, 1)
    assert.ok(proxy.stats.upBytes >= sent.length, `upBytes=${proxy.stats.upBytes}`)
    assert.ok(proxy.stats.downBytes >= sent.length, `downBytes=${proxy.stats.downBytes}`)
  })
})
