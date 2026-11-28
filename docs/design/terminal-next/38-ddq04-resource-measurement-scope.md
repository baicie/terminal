# DDQ04 — 资源测量范围与判读语义

**回答一个问题**：`e2e-09` 报出的 RSS / 描述符 / 线程 / CPU，各自是什么东西，
到哪为止，以及"没有检测到泄漏"这句话能覆盖多大的范围。

这个文件不重复 DDQ03 的完整性契约（在 `fixtures/resource-series.mjs`），
只定义**指标语义**与**测量边界**。

---

## 1. 测量范围：`MAIN_PROCESS`，仅此而已

`e2e-09` 采的是一个进程：`argv[0]` 等于应用二进制的那个。

```
MEASUREMENT_SCOPE = {
  MAIN_PROCESS:        '已测量。argv[0] 即应用二进制；不含 WebView 渲染/GPU 辅助进程',
  OWNED_PROCESS_TREE:  '未测量。需要先证明每个后代进程的归属',
  WEBVIEW_PROCESS_GROUP: '未测量。共享的 WebView 进程无法安全归因',
}
```

**为什么只到主进程。** 用户感知的"这个应用占了多少内存"包含：

| 进程 | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Tauri 主进程 | ✅ 被测 | ✅ 被测（DDQ05 后） | ✅ 被测 |
| WebView 渲染 | WebContent | WebView2 renderer | WebKitGTK web process |
| GPU / 合成 | GPU process | （并入 renderer + GPU process） | （并入 web process） |
| 本地 shell | `/bin/zsh` 子进程 | `powershell.exe` | `bash` |

拿主进程的曲线说"应用没有泄漏"会**高估**结论。反过来，把 WebView 进程按名字抓进
测量里会**低估**——那些进程在多个应用之间共享或复用，把它们的内存算进来等于把别的
应用的行为记在这一个头上。

扩大范围的前提是能**证明归属**（同一 bundle、同一 session、由本进程 spawn，且有
可核对的启动时间）。这个证据当前不存在，所以范围不扩大，**并在证据里写清楚**。

证据字段：

```json
"measurement": {
  "processScope": "MAIN_PROCESS",
  "processScopeMeaning": "the single process whose argv[0] is the app binary; excludes WebView renderer/GPU helpers",
  "notMeasured": ["OWNED_PROCESS_TREE …", "WEBVIEW_PROCESS_GROUP …"],
  "capabilities": { … 平台能力表 … }
}
```

---

## 2. 每个指标的语义

| 指标 | Linux | macOS | 单位 | 是累计还是瞬时 |
| --- | --- | --- | --- | --- |
| `rssBytes` | `/proc/<pid>/statm` 字段 2 × page size | `ps -o rss=` × 1024 | 字节 | 瞬时 |
| `openFds` | `/proc/<pid>/fd` 条目数 | `lsof -p` 行数 − 表头 | 计数 | 瞬时 |
| `threads` | `/proc/<pid>/status` 的 `Threads:` | `ps -M` 行数 − 表头 | 计数 | 瞬时 |
| `cpuTimeMs` | `/proc/<pid>/stat` 的 utime+stime × 1000 / `CLK_TCK` | `ps -o time=` 解析 | 毫秒 | **累计** |

### `cpuTimeMs` 是累计值，不是利用率

这一点必须写死，因为两种量在同一个列里会互相破坏：

- **累计** CPU 时间单调不减，有意义的量是**斜率**；
- **利用率**本身已经是速率，对速率求平均与对斜率求平均不是同一件事。

选累计，是因为每个平台原生都给累计值，而且两个累计读数相减是精确的，对速率积分不是。
证据里记录的是累计值；想要"利用率"的读者应当自己用相邻两个样本的差除以经过时间。

测试 `records CPU time as a cumulative quantity, not a utilisation` 用"先烧 30 ms CPU
再采一次，断言不减"来钉住这个语义——如果哪天有人把实现换成瞬时利用率，这个断言会红。

### macOS 的 `openFds` 是代理量，不是描述符数

`lsof -p <pid>` 的第一列混了**真实数字描述符**与**合成条目**：`txt`（可执行文件）、
`cwd`、`rtd`，以及较新 macOS 上的 `mem` 区域。所以行数**不等于**打开的文件描述符数，
本文件也**不**这样声称。

它是一个随描述符泄漏而单调变化的稳定代理量，记录在
`platformCapabilities('darwin').openDescriptorsMeaning` 里：

```
'lsof output lines minus header (includes txt/cwd/mem rows)'
```

**不得**把 macOS 的这个数与 Linux 的 `/proc/<pid>/fd` 条目数当同一个数比较。
两者量纲不同，跨平台的绝对数比较本来也不在判据里（见 §4）。

### 线程数只作描述，不参与判读

任务书点名的是 RSS、FD、CPU。线程数记录成 `threadMin`/`threadMax` 一个区间，
不进 `summariseSeries`——线程池的伸缩是正常行为，把它当曲线判会制造噪声。

---

## 3. 采样本身的开销，以及为什么它可能影响测量

macOS 上每轮 spawn 三个进程：`ps -o rss=`、`ps -M`、`lsof`。其中 `lsof` 在本机实测
约 20 ms，100 轮就是 2 秒的额外进程创建，**发生在被测区间内部**。

这不会让曲线失真到不可用（采样是均匀的，开销是常数项而非趋势项），但它确实意味着：

- 被测进程的 CPU 时间里，有一部分是我们采样它造成的；
- 采样越密的实现，测出来的 CPU 斜率越高。

证据里的 `roundLines` 与轮次对齐，读者可以据此判断每轮实际花了多久。
**未做的事**：没有为采样开销做扣除，也没有测量采样开销本身占多少 CPU。
这是一个已知的、记录在案的偏差来源，不是一个已解决的精度问题。

---

## 4. "没有检测到泄漏"覆盖到哪里

`NO_LEAK_DETECTED` 的准确含义是：

> 在 `MAIN_PROCESS` 范围内，在这 100 轮命令面板操作的采样序列里，
> 后半段的 floor 没有继续爬升。

它**不**意味着：

- 应用没有内存泄漏（WebView 侧没测）；
- 其他操作路径没有泄漏（SFTP / SSH 会话 / 分屏不在本轮 100 轮里，见 DDQ08）；
- 100 轮足够长（长时间运行下的慢泄漏可能短于此）；
- 换一台 runner 结论相同（曲线是关于那台 runner 的假设）。

跨平台比较的规则（`32-rc-readiness-report.md` 已定，这里重申）：

| 比较 | 允许 |
| --- | --- |
| 同一平台不同轮次的**形状** | ✅ |
| 不同平台的**绝对 RSS** | ❌ —— 二进制、WebView、分配器都不同 |
| 不同平台的**生命周期回收**（末值是否回落到基线量级） | ✅ |
| 轮次完整性 | ✅ |

---

## 5. 代码位置

| 关注点 | 位置 |
| --- | --- |
| 采样实现与能力表 | `e2e/gui/fixtures/process-sampler.mjs` |
| `MEASUREMENT_SCOPE` 常量 | 同上 |
| 完整性判定 | `e2e/gui/fixtures/resource-series.mjs` |
| 趋势判定 | `e2e/gui/fixtures/resource-curve.mjs` |
| 证据组装 | `e2e/gui/specs/e2e-09-resource-curve.e2e.mjs` |
| CPU 语义与能力表的测试 | `e2e/gui/fixtures/process-sampler.test.mjs` |

---

## 剩余限制

- Windows 的三个指标尚未实现，`platformCapabilities('win32').supported === false`，
  e2e-09 在 Windows 上是 `NOT_RUN` 并写明原因（DDQ05）。
- 子进程与 WebView 进程的归属证明未做，范围不扩大。
- 采样开销未扣除。
- 100 轮只覆盖命令面板这一条 GUI 路径（DDQ08 讨论代表性负载）。
