# DDQ05 / DDQ06 — Windows 原生资源采样

**DDQ05 判定：PASS（真实 Windows runner，100 轮）。**
**DDQ06 判定：UNIT_VERIFIED（受控进程 + 异常矩阵）。**

## 真实 Windows runner 实测（run `46124241301`，PR #177）

```
Windows e2e-09 → PASS
notes: 100 of 100 rounds sampled; RSS NO_LEAK_DETECTED, descriptors NO_LEAK_DETECTED, threads 24–28
descriptorMetric: handleCount
expected/observed: 100 / 100
perMetric: { rssBytes: 100, handleCount: 100, threads: 100 }
rss: 46,395,392 → 45,801,472 B   （44.25 → 43.68 MiB，−0.56 MiB）
```

这是 Windows 资源采样第一次产出真实曲线。此前该平台是 `NOT_RUN`（`wmic` 不在
runner 上），现在是 `100 of 100 rounds`、三个指标各 100 个有效样本。

证据里的能力表也确认了实现走的是预期路径：

```json
{"supported": true,
 "availableMetrics": ["rssBytes","handleCount","threads","cpuTimeMs"],
 "processIdentityMethod": "PowerShell Get-Process, pid cross-checked against the answer"}
```

同一次运行的 Windows e2e-08 也是 `PASS`（40 → 10040 行）。

**注意**：同一次运行的 Linux GUI E2E 报了 e2e-02 失败，重跑后通过。原因是陈旧列数
读数（1440 与 1280 都读到 142、1024 与 900 都读到 60），`rafObserved` 只证明 rAF 跑过、
不证明 resize 后的列数已更新。这是既有的 flake，与本次采样器改动无关——
本次没有触碰布局或 xterm。

---

## DDQ05 — 为什么 `wmic` 不能回来

旧实现：

```js
const output = run('wmic', ['process', 'get', 'ProcessId,ExecutablePath', '/format:csv'])
if (output === null) return null      // ← 实测就是这一行
```

`windows-latest` 上 `wmic` 不在 `PATH`，`run()` 返回 `null`，`e2e-09` 抛
「could not find the app process」——**一个平台能力缺口被报成了 harness 缺陷**，
而那个 job 本来就不可能产出采样。`wmic` 已被微软弃用并从当前镜像移除。

替换为 `Get-CimInstance Win32_Process`，`ExecutablePath` 就是 `argv[0]` 的对应物，
所以 POSIX 分支的「只匹配第一个 token」规则在 Windows 上同样成立。

---

## 一次调用，不是五次

`powershell.exe` 冷启动在本机与 runner 上实测 200–400 ms。每轮五次 = 100 轮最多
两分钟的进程启动开销，全落在测量窗口内。所以是**一个脚本一次调用**返回全部指标。

脚本（`windowsScript(pid)`）：

```powershell
$ErrorActionPreference = "Stop"
$p = Get-Process -Id <pid> -ErrorAction Stop
$o = [ordered]@{
  id           = $p.Id
  workingSet   = $p.WorkingSet64
  privateBytes = $p.PrivateMemorySize64
  handleCount  = $p.HandleCount
  threads      = $p.Threads.Count
  cpuMs        = [math]::Round($p.TotalProcessorTime.TotalMilliseconds)
  startTime    = $p.StartTime.ToUniversalTime().ToString("o")
}
$o | ConvertTo-Json -Compress
```

`-NoProfile -NonInteractive -ExecutionPolicy Bypass`，没有 `cmd /c`——`execFileSync`
直接启动二进制，没有 shell 参与，也就没有二次引用问题。

---

## 指标语义：`handleCount` 不是 `openFds`

| Windows | POSIX |
| --- | --- |
| `HandleCount` = 内核句柄（文件 + 注册表键 + 事件 + 互斥量 + 段） | `openFds` = `/proc/<pid>/fd` 条目，或 macOS 的 `lsof` 行 |
| 字段名 `handleCount` | 字段名 `openFds` |

**从不把前者写进后者。** 为了复用同一张图而混填，等于比较两个不可比的量。

`platformCapabilities('win32')` 因此：

```js
{
  supported: true,
  availableMetrics: ['rssBytes', 'handleCount', 'threads', 'cpuTimeMs'],
  processIdentityMethod: 'PowerShell Get-Process, pid cross-checked against the answer',
  openDescriptorsMeaning: null,     // 没有描述符计数可描述
  unsupportedReason: null,
}
```

`openFds` 故意**不在** `availableMetrics` 里：列一个填不上的指标，会让消费者拿到
静默的 null 而不是"这个平台没有"。

`cpuTimeMs` 仍然是**累计**值（`TotalProcessorTime.TotalMilliseconds`），与
`ps -o time=`、`/proc/<pid>/stat` 同量纲，所以三平台可比斜率。

---

## 硬时限

每次调用都带 `timeout`。`execFileSync` 的超时用信号杀子进程，在 catch 里的错误形状
与非零退出难以区分——所以包了一层 `execWithTimeout`，把两种分开：

```js
const timedOut = error?.code === 'ETIMEDOUT' || error?.signal === 'SIGTERM'
```

超时被记成**超时**（`"powershell did not answer within N ms"`），而不是"值缺失"。
卡住的 WMI provider 是本轮唯一能挂起整轮的东西。

---

## 六种失败形状，每种都有自己的理由

| 形状 | 结果 |
| --- | --- |
| 进程已退出 | `Get-Process` 非零退出 → 记录 stderr 原文 |
| 采样超时 | `timedOut: true`，reason 含毫秒数 |
| 输出不是 JSON | `"powershell output was not JSON: …"` |
| 没有 `WorkingSet64` | `"Get-Process returned no WorkingSet64"` |
| pid 被回收（答案里的 id 不等于请求的） | 拒绝，`"reported pid N, asked for M"` |
| stdout 为空 | `"powershell printed nothing"` |

**pid 回收**这条最要紧：进程退出后 Windows 会复用 pid，采样器继续读会得到**真实的、
但属于另一个进程的**数字。这种情况必须拒绝，不是记零。

---

## DDQ06 — 受控进程

`controlled-process.mjs` 起一个真实 Node 子进程，接受五条指令并**逐条确认**：

| 指令 | 效果 |
| --- | --- |
| `allocate` | 持有 N MiB 并逐页触碰（未触碰的 Buffer 是虚拟内存，不进 RSS） |
| `release` | 释放并请求 GC（子进程带 `--expose-gc`） |
| `handles` | 打开 N 个文件 |
| `closeHandles` | 关闭它们 |
| `threads` | 起 N 个 worker |
| `exit` | 退出 |

确认机制是关键：测试可以断言"变化已发生"再采样，而不是睡一会儿祈祷。

**断言是方向性的，不是精确值**：

- RSS 至少涨到请求量的一半（分配器会复用、页可能尚未驻留）；
- 释放后 RSS **不再继续爬**（不声称回落到基线——那是对分配器的断言，不是对采样器的）；
- 句柄数至少涨到请求量的一半（macOS 的 `lsof` 行是代理量）；
- 关闭后**不再升高**（同样不声称回到基线——Node 子进程自己也在开关描述符）；
- 线程数至少 +1；
- 进程退出后**不返回数字**，返回 null 或带理由的 null 样本。

## 实测（本机 macOS，真实进程）

```
pid: 47505
allocate:  {"heldMib":32}
handles:   {"openHandles":16}
threads:   {"workers":4}
close:     {"openHandles":0}
```

`process-sampler-live.test.mjs` **6/6 通过**。

---

## 已跑的门禁

| 项 | 结果 |
| --- | --- |
| `process-sampler-windows.test.mjs` | 20/20 |
| `process-sampler.test.mjs` | 13/13 |
| `process-sampler-live.test.mjs` | 6/6 |
| 全部 fixture 测试 | 102（100 pass / 2 skip / 0 fail） |
| `source-size` | 796 production files passed |
| 本地 e2e-09（15 轮） | `INSUFFICIENT_DATA`，`descriptorMetric: openFds`，15/15 轮全采到 —— macOS 无回归 |

### 变异验证

| 变异 | 结果 |
| --- | --- |
| 去掉 `exec` 的 `timeoutMs` | 1 红（`carries a hard deadline`） |
| 接受回收的 pid（`if (false)`） | 1 红（`refuses a pid mismatch`） |

---

## e2e-09 的平台适配

第二个资源曲线此前恒为 `openFds`，在 Windows 上永远是 null，会让**每个** Windows run
判 `INSUFFICIENT_DATA`——为它从来提供不了的指标。

```js
const descriptorMetric = process.platform === 'win32' ? 'handleCount' : 'openFds'
```

证据里记录 `descriptorMetric`，读者知道这条曲线是哪一个量，不会跨平台比较。

---

## 剩余限制

- ~~真实 Windows runner 尚未跑过~~ —— **已跑过**，见文件顶部：`100 of 100 rounds`、PASS。
  仍需注意：这是**一台** runner 上的一次 100 轮；曲线是关于那台 runner 的假设，
  不是"Windows 上没有泄漏"的结论。
- `powershell.exe` 的真实启动耗时没有被单独测量。100 轮在 CI 上完成，
  但那个开销落在测量窗口内这件事只是推断，没有数字。
- `privateBytes` 在证据里记录，但没有曲线判读——macOS/Linux 没有对应量。
- `startTime` 采样了但没有用于归属判定：进程树归属（`OWNED_PROCESS_TREE`）仍未做，
  测量范围仍是 `MAIN_PROCESS`。
- DDQ06 要求的"权限不足"与"路径含空格"在真实 Windows 上无法在本机复现，
  只有引号规则与"查不到就返回 null"两条被测试覆盖。
