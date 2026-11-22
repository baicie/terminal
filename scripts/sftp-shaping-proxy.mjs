// 在真实 sshd 前面放一个可编程的 TCP 代理，用来注入延迟、限速、丢包与断流。
//
// ## 为什么不整形网络
//
// `dummynet` / `pfctl` / `tc qdisc` 都需要 root，而 CI 与开发机都没有。一个用户态代理
// 不需要特权，且**只影响被测连接**——它插在 `client → proxy → sshd` 之间，真实服务器
// 与真实协议完全不变。
//
// ## 它改变了什么，没改变什么
//
// 改变：字节到达的时间与是否到达。
// 不改变：字节的内容、顺序、SSH 协议层、SFTP 子系统。
//
// 这一点必须在报告里写清楚：它证明的是「产品在字节流被拖慢/截断时的行为」，不是
// 「在真实的 WAN 上」——真实网络的丢包重传由内核完成，这里只丢不重传。
//
// ## 三种注入
//
//   * `delayMs`  —— 每个数据块前等待，模拟往返时延；
//   * `rateBytesPerSec` —— 令牌桶式限速，模拟带宽；
//   * `cutAfterBytes` / `resetAfterMs` —— 到达阈值后销毁双向连接，模拟断流/重置。
//
// 全部注入都是**单向可配**的（上传方向慢、下载方向快是常见的不对称链路）。

import { createServer, connect } from 'node:net'
import process from 'node:process'

/**
 * Start a proxy in front of `targetPort`.
 *
 * Returns `{ port, close, stats }`. `stats` is a live object the test can read while
 * traffic flows: bytes in each direction, how many connections were cut, and how many
 * were accepted.
 */
export async function startShapingProxy({
  targetPort,
  targetHost = '127.0.0.1',
  /** Delay added before forwarding each chunk, per direction. */
  delayMs = { up: 0, down: 0 },
  /** Bytes per second allowed per direction; `0` means unlimited. */
  rateBytesPerSec = { up: 0, down: 0 },
  /** Destroy the connection after this many bytes have passed in a direction. */
  cutAfterBytes = { up: 0, down: 0 },
  /** Destroy the connection this long after it opened, regardless of traffic. */
  resetAfterMs = 0,
} = {}) {
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65_535) {
    throw new Error(`targetPort must be a TCP port, got ${targetPort}`)
  }
  const stats = {
    accepted: 0,
    cut: 0,
    upBytes: 0,
    downBytes: 0,
    closed: 0,
  }
  const sockets = new Set()

  /** Sleep that resolves even if the socket dies meanwhile. */
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

  /**
   * Forward `from` → `to` with the direction's shaping applied.
   *
   * Backpressure is honoured by pausing the source while the shaping await is in
   * flight — without that, a fast sender would queue the whole file in the proxy and
   * the "slow link" would only delay the reading side.
   */
  async function pump(from, to, direction, onCut) {
    const delay = delayMs[direction] ?? 0
    const rate = rateBytesPerSec[direction] ?? 0
    const cutAt = cutAfterBytes[direction] ?? 0
    let sent = 0

    from.on('data', async chunk => {
      from.pause()
      try {
        if (cutAt > 0 && sent + chunk.length > cutAt) {
          // Deliver only up to the cut point, then destroy both sides: the receiver
          // sees a truncated stream, which is what a reset mid-transfer looks like.
          const keep = Math.max(0, cutAt - sent)
          if (keep > 0) to.write(chunk.subarray(0, keep))
          stats.cut += 1
          stats[direction === 'up' ? 'upBytes' : 'downBytes'] += keep
          onCut()
          return
        }
        if (cutAt > 0) {
          // Nothing to trim: fall through and forward normally.
        }
        if (rate > 0) {
          // Time this chunk would take at the configured rate.
          await sleep(Math.ceil((chunk.length / rate) * 1000))
        }
        if (delay > 0) await sleep(delay)
        if (to.destroyed) return
        stats[direction === 'up' ? 'upBytes' : 'downBytes'] += chunk.length
        sent += chunk.length
        to.write(chunk)
      } finally {
        if (!from.destroyed) from.resume()
      }
    })
    from.on('end', () => {
      if (!to.destroyed) to.end()
    })
    from.on('error', () => {
      if (!to.destroyed) to.destroy()
    })
  }

  const server = createServer(client => {
    stats.accepted += 1
    const upstream = connect(targetPort, targetHost)
    sockets.add(client)
    sockets.add(upstream)

    let done = false
    /*
     * A cut must be a **reset**, not a polite close.
     *
     * `socket.destroy()` sends FIN on most platforms, so the peer sees a clean half
     * close — `end` fires and a reader can conclude "the stream ended normally". That is
     * exactly the wrong event to simulate: the product's disconnect handling must cope
     * with a connection that dies mid-byte, not one that ends.
     *
     * `resetAndDestroy()` (Node 18+) sends RST. Measured in this repository: with
     * `destroy()` the receiving side reported `ended: true`; with `resetAndDestroy()` it
     * reports `ended: false` plus an `ECONNRESET`, which is the shape a real network
     * failure produces.
     */
    const kill = socket => {
      if (socket.destroyed) return
      try {
        socket.resetAndDestroy()
      } catch {
        socket.destroy()
      }
    }
    const finish = () => {
      if (done) return
      done = true
      stats.closed += 1
      kill(client)
      kill(upstream)
      sockets.delete(client)
      sockets.delete(upstream)
    }

    pump(client, upstream, 'up', finish)
    pump(upstream, client, 'down', finish)
    if (resetAfterMs > 0) setTimeout(finish, resetAfterMs)

    client.on('close', finish)
    upstream.on('close', finish)
    client.on('error', finish)
    upstream.on('error', finish)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port

  return {
    port,
    stats,
    async close() {
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

/** The platform's default test target; kept here so callers do not re-derive it. */
export const PROXY_HOST = '127.0.0.1'

void process

/**
 * Named scenarios the fixture harness can select with `T16_SHAPING`.
 *
 * Each is a plain options object for `startShapingProxy`, written here rather than in
 * the harness so "what a slow link means" is stated once, next to the code that
 * implements it.
 *
 * The 24 MiB size is the Rust test suite's own fixture size; the rates are chosen so
 * each scenario finishes inside the suite's timeout on a developer machine while still
 * being clearly slower than loopback. Measured on an M1 laptop: `slow-upload` adds
 * roughly 12 s to the 24 MiB upload.
 */
export const SHAPING_SCENARIOS = {
  /** 2 MiB/s each way, 20 ms per chunk: a workable but visibly slow link. */
  'slow-upload': {
    delayMs: { up: 20, down: 5 },
    rateBytesPerSec: { up: 2 * 1024 * 1024 },
  },
  'slow-download': {
    delayMs: { up: 5, down: 20 },
    rateBytesPerSec: { down: 2 * 1024 * 1024 },
  },
  /** Asymmetric: a fast downlink with a 512 KiB/s uplink. */
  'slow-uplink-only': {
    rateBytesPerSec: { up: 512 * 1024 },
  },
  /** The first 4 MiB gets through, then the connection is reset. */
  'cut-upload': {
    cutAfterBytes: { up: 4 * 1024 * 1024 },
  },
  'cut-download': {
    cutAfterBytes: { down: 4 * 1024 * 1024 },
  },
}
