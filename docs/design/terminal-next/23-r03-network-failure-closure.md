# R03 — 断流与慢网：一个无法中止的调用，和两层缺失的时限

> 本文回答 R03 的两个要求：**区分 `EXPECTED_NETWORK_FAILURE` 与 `TEST_INFRA_FAILURE`**，
> 以及「如果底层库存在无法及时中止的调用，先形成最小复现与风险报告，再决定是否单独修复」。
>
> 所有数字都是本机 macOS arm64 实测。没有一处是推断。

---

## 一、结论先行

| 断言 | 判定 | 证据 |
| --- | --- | --- |
| 断流后产品报错、而不是静默成功 | **成立**（`cut-download` 6/2，见 §五） | 有界运行 + 逐用例判定 |
| 断流后 Rust SFTP **写**调用能**及时**中止 | **不成立** | 30/60/180/300 s 全部无 verdict，§二 |
| 断流后 Rust SFTP **读**调用能及时中止 | **成立** | `cut-download` 33 秒给出完整结果，§五 |
| 整形场景有测试时限 | **原本不成立**，已修 | 30 s 时限 → 31 s 退出，§三 |
| fixture 生命周期测试自身可信 | **原本不成立**，已修 | 一个用例永久挂起并**泄漏 sshd**，§四 |
| `EXPECTED_NETWORK_FAILURE` / `TEST_INFRA_FAILURE` 可区分 | **现已成立** | 三态退出码 + 双向变异，§六 |

一句话：**慢网本身工作，慢网失败时的收尾不工作。** 前者是产品行为，后者是测试基础设施，
而这两件事在过去一直被同一个「绿」掩盖着。

---

## 二、无法及时中止的调用（风险报告）

### 最小复现

```bash
# 整形代理在 4 MiB 处对上行发 RST，然后跑 command-level SFTP 测试
T16_SHAPING=cut-upload node scripts/verify-install/sftp-command-e2e.mjs
```

### 实测

| 观测 | 值 |
| --- | --- |
| 挂起时长 | **1 小时 17 分 51 秒**（`cargo test` PID 64545） |
| 触发场景 | `T16_SHAPING=cut-upload`（上行 4 MiB 处 RST） |
| 卡住的测试 | `uploads_24_mib_through_the_production_upload_path` —— **第一个**跑到 24 MiB 的用例 |
| 进程状态 | `SN`（sleeping，非 CPU 忙转） |
| 该进程的 TCP socket 数 | **0** —— 连接早已被 RST 拆掉 |
| 1754 次栈采样 | 全部停在 `mio::poll` → `uv_run` 的 park |

**复现的可重复性**：同一个场景在 30 s、60 s、180 s、300 s 四种时限下**全部**没有 verdict，
每次都以上限被杀。这不是偶发的慢，是一个确定性的永不返回。

**关键点**：`lsof` 显示该进程**一个 TCP socket 都没有**。断言「底层调用不可中止」必须有
这一条——不是「网络慢所以还在传」，是连接已经死了、任务却还在等一个永远不会就绪的 I/O
future。

**日志形态**：最后一行是 `running the command-level tests` 之后就没再打印任何测试名——
libtest 连 `test … ... ` 的起始行都没输出，说明它卡在第一个用例内部，而不是某个用例失败后
的清理。

### 影响面

- **不是产品缺陷**（至少现在不能这么断言）。产品路径里 Rust 命令有超时；挂住的是
  **测试进程里的 tokio 运行时**，它在等一个 `SftpSession` 的 future。
- **是测试基础设施缺陷**，且形状最坏：它**不报错、不超时、不退出**，只是永远等。CI 上
  表现为 job 卡到 `timeout-minutes`，而日志里最后一行是「shaping cut-upload on …」——
  看起来像网络问题，实际是没人给它时限。

### 处置

**本轮不改底层库。** 理由：`russh-sftp` 的 `read`/`write` 在底层连接被 RST 后是否会返回
错误而不是挂起，需要单独的最小复现（一个 50 行的 tokio 程序，不经过任何测试框架）。
把它和 R03 的收口混在一个 PR 里，会让「断流行为是否正确」这个结论无法归因。

**本轮要做的是让失败可见**：给每一层加有界时限（§三），让这种挂起变成一条
`TEST_INFRA_FAILURE` 而不是一个 77 分钟的空转。

---

## 三、两层缺失的时限

### 层一：`node --test` 的 `--test-timeout` 挡不住泄漏的句柄

实测：给 fixture 生命周期测试传 `--test-timeout=90000`，它跑了 **1 小时 17 分**仍未结束。

原因不是 Node 的 bug：超时定时器活在**同一个事件循环**上，而泄漏的 sshd 子进程正是把
那个循环撑住的东西。用例里 `assert` 先抛，`fixture.stop()` 从未执行，sshd 成为测试进程的
活子进程 —— 此后任何基于计时器的超时都不会被调度到。

**这条必须写下来**，因为直觉上「加了 `--test-timeout` 就有上限了」，而它不是。

### 层二：整形场景没有 `execFile` 时限

`scripts/verify-install/sftp-command-e2e.mjs` 的 `execFileAsync('cargo', [...])` **没有
`timeout` 选项**。所以：

- 一个挂住的 Rust 测试可以无限期占用 harness；
- harness 的 `finally` 永远不执行；
- fixture 的 sshd 与临时目录一直留着。

这就是 §二 的 77 分钟能发生的机制。

---

## 四、被修掉的测试基础设施缺陷（先红后绿）

### 4.1 「证明回收」的用例自己泄漏

`scripts/terminal-smoke-sshd.lifecycle.test.mjs` 的最后一个用例读 `fixture.pid`，
而 fixture 暴露的是 **`daemonPid`**（getter —— `restart`/`interrupt` 会换掉 daemon 句柄，
存下来的数字会指向错误的进程）。

```js
const pid = fixture.pid ?? fixture.child?.pid   // 两者都不存在 → undefined
assert.equal(typeof pid, 'number', …)            // 在这里抛出
await fixture.stop()                             // 永远不执行
```

sshd 存活 → 事件循环不空 → 进程不退出 → **没有任何 verdict**。

**这不是「测试失败」，是测试永远不结束。** 一个证明回收的测试，失败时自己泄漏了它要
证明被回收的东西。

修复：读 `daemonPid`，并把 `stop()` 放进 `finally`。

**变异验证**：把 `daemonPid` 改回 `fixture.pid ?? fixture.child?.pid`，同一文件
**3.9 秒内红色失败、零残留**；修复版 **3.7 秒 5/5 通过、零残留**。

### 4.2 一个把目录结构当成泄漏的断言

```js
const leftover = readdirSync(root)
leftover.every(name => !name.includes('sshd'))   // 恒假：root/sshd/ 是 fixture 自己的布局
```

`root/sshd/` 是 fixture 在启动 daemon **之前**建的，放 host key、配置和 pid 文件。
所以这个断言在**健康的 fixture 上也会失败**，而它想证明的「进程泄漏」一点没测到。

修复：改成「daemon 写下的 pid 文件不得指向一个活进程」——那才是后续运行会信任、并且
真的能反映泄漏的东西。守进程存活的断言由同文件其它三个用例承担。

---

## 五、慢网本身：产品行为

`slow-upload`（2 MiB/s 上行 + 20 ms 延迟）此前实测 **8/8 通过、105 秒、24 MiB 字节
完整性成立**（见 `22-sftp-gui-closure.md` §七）。本轮复核结论不变。

### `cut-download`：期望失败被正确识别（37 秒）

上行完好、下行 4 MiB 处 RST。结果 **6 通过 / 2 失败**，失败的正是两个 24 MiB 传输：

```
test result: FAILED. 6 passed; 2 failed; … finished in 33.24s
SFTP command-level: EXPECTED_NETWORK_FAILURE (by design for "cut-download"):
  downloads_24_mib…, uploads_24_mib… failed because the link was cut; every other test passed
exit=0
```

为什么这是**通过**而不是失败：24 MiB 的传输跨过 4 MiB 的断点，`expect("download 24 MiB")`
必然 panic。把它算成 `TEST_FAILURE` 会让每一个整形运行都是红的，从而掩盖这一轮真正要测的
东西。所以每个场景**显式声明**它预期打破哪些用例，判定要求失败集合**恰好**等于声明：

| 判定 | 条件 |
| --- | --- |
| `EXPECTED_NETWORK_FAILURE`（exit 0） | 失败集合 == 声明集合 |
| `TEST_FAILURE`（exit 1） | 有未声明的失败，或有「声明会失败却通过了」 |

**双向变异验证**：把 `cut-download` 的声明清空后重跑，同一份输出立刻变红，并指名两个
意外失败 —— `exit=1, unexpected failures: [downloads_24_mib…, uploads_24_mib…]`。

### `cut-upload` 与 `cut-download` 的不对称，本身是结论

同一个 4 MiB 断点，反方向的表现完全不同：

| 场景 | 行为 | 判定 |
| --- | --- | --- |
| `cut-download` | 33 秒给出 6/2 结果 | `EXPECTED_NETWORK_FAILURE` |
| `cut-upload` | **永不返回**（30/60/180/300 s 全部无 verdict） | `TEST_INFRA_FAILURE` |

下行断流后读取会报错并结束；上行断流后写入**不返回**。这指向 `russh-sftp` 的写路径在底层
连接被 RST 后不会让 pending 的写 future 失败——正是 §二 要单独复现的那件事。

### 五个场景的完整矩阵（全部有界运行）

| 场景 | 时长 | 结果 | 判定 |
| --- | --- | --- | --- |
| 无整形（基线） | **20 s** | 8/8 通过 | `PASS` |
| `slow-uplink-only`（512 KiB/s） | **151 s** | 8/8 通过 | `PASS` |
| `cut-download`（下行 4 MiB RST） | **37 s** | 6 过 / 2 失败 | `EXPECTED_NETWORK_FAILURE` |
| `handshake-reset`（握手期 RST） | **56 s** | 6 失败 | `EXPECTED_NETWORK_FAILURE`（不可确定子集） |
| `silent-server`（接受后不应答） | **166 s** | 8/8 失败 | `EXPECTED_NETWORK_FAILURE` |
| `cut-upload`（上行 4 MiB RST） | ≥300 s | **无 verdict** | `TEST_INFRA_FAILURE`（待修） |

## 五之二、三个场景的共同根因：`Fixture::connect` 没有截止时间

`handshake-reset` 与 `silent-server` 最初都是**永久挂起**（45 s / 150 s / 450 s 全部无
verdict）。根因不在整形代理，也不在 `russh-sftp`：

```rust
// 修改前
let mut handle = russh::client::connect(config, ("127.0.0.1", self.port), AcceptAnyHostKey)
    .await
    .expect("connect to the fixture sshd");
```

`russh::client::connect` 没有超时参数，一个永不完成的握手就是一个永不返回的 future。

**产品路径没有这个问题。** `src-tauri/src/session/ssh.rs` 的 `connect_tcp_with_shutdown`
用的是 `tokio::time::timeout_at` **加** `TcpShutdownGuard` —— 而且那个 guard 是必需的：
注释里写明 pending 的握手 future 不一定会自己观察到 socket 关闭。测试 fixture 两样都没有。

修复是给 `Fixture::connect` 的**每一步**加 20 秒上限（connect / auth / channel / subsystem
/ SFTP 握手）。选择每步而不是一个总 deadline：总 deadline 会让负载高但正常的 CI 机器误红，
而这个套件要区分的是「这一步从未完成」。

**修复后同一场景的行为**：

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| `silent-server` | 无 verdict（≥450 s） | **166 s，8/8 失败，有 verdict** |
| `handshake-reset` | 无 verdict（≥450 s） | **56 s，6/8 失败，有 verdict** |

### 为什么 `handshake-reset` 声明成「任意子集」

第一次修好后它给出 3 通过 / 5 失败，声明「每个测试都失败」立刻变红并指出 3 个「声明会失败
却通过了」。那不是缺陷：代理在 accept 后 250 ms 才 RST，某个测试的握手能否挤进这个窗口
取决于机器负载，**这个场景本来就不确定**。

所以它用 `anySubsetMayFail`：下限是「至少一个失败」，并且**必须产出 verdict**。

关键是这个下限不是空的——如果一个都没失败，说明整形根本没生效（代理不在路径上，或 RST
没发出），这次运行什么也没证明，必须报错。

顺便，这个「恰好相等」的检查抓到了我自己的一个错误：`ALL_COMMAND_TESTS` 里我凭印象写了
`a_download_that_fails_never_replaces_the_local_target`，而那个测试**不存在**。判定立刻
报 `expected but passed: [a_download_that_fails_never_replaces_the_local_target]`。

---

## 六、`EXPECTED_NETWORK_FAILURE` 与 `TEST_INFRA_FAILURE`

过去的报告把两者混在一个「失败」里，导致两种完全相反的情况读数相同：

| 类别 | 含义 | 应该怎样 |
| --- | --- | --- |
| `EXPECTED_NETWORK_FAILURE` | 断流生效，产品正确地报错/停下 | **这是通过**，前提是断言了「报错而不是静默成功」 |
| `TEST_INFRA_FAILURE` | 测试自己坏了（挂起、fixture 泄漏、时限缺失） | **不是通过**，且必须与上一类分开计数 |
| `PRODUCT_FAILURE` | 产品在断流下静默成功或损坏数据 | 真正要修的东西 |

新增的判定规则（`sftp-command-e2e` 层）：

```
挂起 / 超时            → TEST_INFRA_FAILURE
RST 后产品返回错误      → EXPECTED_NETWORK_FAILURE（通过）
RST 后产品报告成功      → PRODUCT_FAILURE
```

每层都有自己的时限，任何一层越界都记为 `TEST_INFRA_FAILURE` 并**立即结束**，不进入下一层。

---

## 七、仍未闭合

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 断流后 Rust **写**路径是否必然中止 | `NOT_PROVEN`（已复现为「不中止」） | 需要不经过测试框架的最小复现，见 §二「处置」 |
| 下载中 RST | **已测** | `cut-download` 37 秒给出结果 |
| SSH 握手中断 | **已测** | `handshake-reset` 56 秒给出 verdict |
| 远端无响应 | **已测** | `silent-server` 166 秒给出 verdict |
| 延迟 + 限速 + 断流组合 | `NOT_RUN` | 已有 `delayMs` / `rateBytesPerSec` / `cutAfterBytes`，尚未组合跑 |
| 超时后重试 / UI 错误状态 / Session claim 释放 / 服务器端残留文件 | `NOT_RUN` | 需要 GUI 层；整形代理只接在 Rust 命令行路径 |
| GUI 层慢网（WebView 内传输队列） | `NOT_RUN` | 同上 |

### 已闭合

| 项 | 证据 |
| --- | --- |
| 整形场景有硬时限，超时杀整棵进程树 | 30 s 时限 → 31 s exit=2，零残留（§三） |
| 超时与产品失败可区分 | `TEST_INFRA_FAILURE`(2) / `TEST_FAILURE`(1) / `EXPECTED_NETWORK_FAILURE`(0) |
| `Fixture::connect` 不再无限等待 | `silent-server` 与 `handshake-reset` 从「无 verdict」变成 166 s / 56 s 有 verdict（§五之二） |
| 期望失败集合可双向验证 | 声明错 → 报 `unexpected`；漏声明 → 报 `expected but passed`；抓到了我写错的一个测试名 |
| fixture 生命周期测试不再挂死与泄漏 | 5/5，3.7 s，零残留；变异后 3.9 s 红色失败（§四） |
| 脚本套件 | **819/819，26 秒**（此前 819 项 2 失败，且曾挂 1 小时 17 分） |
