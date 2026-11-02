# Linux zsh 产品门禁三条超时的诊断（Issue #60）

对象：实机矩阵 Linux 作业里的产品门禁 `smoke:shell-probe:matrix`
（`.github/workflows/real-machine-matrix.yml:263`）。矩阵 run `41231265959`（sha `030fda4`）
macOS / Windows success，Linux failure。

本文每条结论都标注证据等级：**代码证明** / **实验证明** / **推断** / **NOT_RUN**。
本机是 macOS，没有 Linux runner，所以最后一步的闭合是 NOT_RUN，见第 6 节。

---

## 1. 先纠正一条写错的根因

`docs/issue.md:3874` 写：

> | `app` | `shell_startup.rs` 生成的 ZDOTDIR wrapper（`.zshenv` 带 `skip_global_compinit=1`） |

**这句话不成立。**（代码证明）

产品 wrapper 的 `.zshenv` 只有一行转发，没有那个开关
（`src-tauri/src/session/shell_startup.rs:63-78`，展开后）：

    if [ -r "${TERMINAL_REAL_ZDOTDIR:-$HOME}"/.zshenv ]; then source "${TERMINAL_REAL_ZDOTDIR:-$HOME}"/.zshenv; fi

全仓库 `src-tauri/` 里 `skip_global_compinit` 出现 **0 次**；它只出现在 Python 诊断脚本
`scripts/diagnose-zsh-rc.py:179`。

于是 Phase 9.0 的那张「真实 Linux runner 上 app 4/4 PASS」矩阵，测的不是产品。
诊断脚本的 `app` 变体给自己补了一行产品不会写的 `skip_global_compinit=1`，
**恰好把产品正在踩的那个坑填掉了**。这就是「诊断脚本 success ≠ 产品门禁通过」在本例中的具体形态：
不是路径不同（Rust PTY vs python pty）而已，而是 `app` 变体与产品之间存在一处实质差异，
且这处差异正好落在失败机制上。

---

## 2. 失败机制

### 2.1 探针的 HOME 是空目录（代码证明）

`scripts/run-terminal-shell-probe.mjs` 把 `HOME` 指向一个新建的 `mkdtemp` 目录
（原 `:403`、`:423`），在我改动之前**没有任何代码往里写启动文件**
（全文件只有一处 `writeFile`，写的是 SSH 配置）。

产品 wrapper 的 `.zshenv` 转发到 `$HOME/.zshenv`——那个文件不存在，转发是空操作。
所以整条启动链上没有一处设置 `skip_global_compinit`。

### 2.2 Debian 的系统 rc 于是停下来提问（代码证明 + 仓库既有实测）

zsh 启动顺序（`man zsh` STARTUP/SHUTDOWN FILES）：

    /etc/zshenv → $ZDOTDIR/.zshenv → /etc/zprofile → $ZDOTDIR/.zprofile
                → /etc/zsh/zshrc → $ZDOTDIR/.zshrc

`skip_global_compinit` 必须在 `.zshenv`（或 `.zprofile`）里设好，才来得及拦住 `/etc/zsh/zshrc`。
Debian 的 `/etc/zsh/zshrc` 会调 `compinit`，`compinit` 在 insecure directories 上停住提问
（本机 `/usr/share/zsh/5.9/functions/compinit:456-463`）。

这一条 Debian 行为不是本轮新测的，是仓库里已有的真实 Ubuntu runner 实测结论
（`docs/phase8/final-report.md:181`、`docs/phase8/reliability.md:128`，CI run `41189424959`）。

macOS 的 `/etc/zshrc` 不含 `compinit`（本机已核对），这解释了同一条门禁在 macOS 上一直是绿的
——不是 macOS 更健壮，是它根本不触发这个分支。

### 2.3 关键细节：`read -q` 只吃掉一个字符（代码证明）

这是本轮新找到的、也是解释「为什么只有三条失败」的那一环。

compinit 用 `read -q` 读那个回答（`compinit:460`）。`read -q` 的语义是
**只从终端读一个字符**（`man zshbuiltins`：“Read only one character from the terminal”）。

所以后果不是「shell 卡死」，而是：shell 活着，但探针接着键入的命令**被削掉了第一个字符**。

### 2.4 探针是盲打的（代码证明）

`automation-root.tsx:255-262` 在 `status === 'connected'` 时立刻发 setup 命令，不等提示符；
而 `connected` 是在 PTY 建好的那一刻就置位的（`terminal-session-io.ts:123-127` 的 `connect()`），
与 shell 是否到达提示符无关。所以那个被吞掉的字符一定落在 setup 命令的第一个字符上。

### 2.5 丢一个字符的后果，逐条用例（实验证明）

我用真实 zsh 5.9 跑了产品真实 setup 字符串的「完整」与「掉首字符」两种输入
（字符串由 `protocol.ts` 的 `shellProbeBody` 生成，逐字复制）：

| 用例 | 完整 | 掉 1 字符 | 掉字符后发生什么 |
| --- | --- | --- | --- |
| `readline-history` | ready | **NO-READY** | `printf`→`rintf`: command not found |
| `pty-resize` | ready | **NO-READY** | `printf`→`rintf`: command not found |
| `readline-tab` | ready | ready | `SHELL_PROBE_DIR=`→`HELL_PROBE_DIR=`，变量为空，alpha_probe 没落地 |
| `cat-eof` | ready | ready | `stty echo`→`tty echo` 报错，其余照跑 |
| `ctrl-c-interrupt` | ready | ready | 同上 |
| `vim-edit` | ready | ready | 同上，且 vim 自己会新建文件 |
| `nano-edit` | ready | ready | 同上 |

#### 与已记录现象的比对（务必分清两份记录的来源）

这里有两份不同的记录，**不能混为一谈**，混淆它们正是本项目记过的认知陷阱：

**(a) 产品门禁自己记录的失败集合**——只有「哪三条」，没有逐条错误文本。
出处是代码注释，不是我取到的日志：

- `.github/workflows/real-machine-matrix.yml:252-253`：
  "Three zsh cases (readline-history, readline-tab, pty-resize) time out
  without printing a single verdict line"
- `src-tauri/src/session/pty_diagnostics.rs:4-6`：同样的三条

我的机制预测**恰好**是这三条偏离、另外四条不受影响。**集合层面 3/3 吻合**，
这是本轮最强的一条对应关系。但它只对上了「哪三条」，没有对上「每条怎么失败」。

**(b) `docs/issue.md:3848-3856` 的九行矩阵**——有逐条错误文本，但它来自
**Phase 9.0 的 Python 诊断脚本**（`diagnose-zsh-rc.py` 的 `app`/`plain` 变体），
**不是产品门禁**。把它当成产品门禁的签名就是任务书点名的那个陷阱。

拿我的实验对 (b) 的 `plain` 四行比：

    plain | readline-history | TIMEOUT  ready marker never printed      <- 实验: NO-READY
    plain | pty-resize       | TIMEOUT  ready marker never printed      <- 实验: NO-READY
    plain | readline-tab     | TIMEOUT  no verdict before the deadline  <- 实验: ready 了但判不出
    plain | ctrl-c-interrupt | PASS                                     <- 实验: ready 且过

四行全中，**包括 `readline-tab` 的错误文本与另外两条不同**这一点——此前没有任何
解释能说明这个差异为什么存在。「只吃一个字符」可以。

**但必须说清**：`plain` 变体与产品门禁是两条不同的代码路径（前者 Python + 直接
`pty.fork` 起 zsh，后者 Tauri Rust local PTY + WebView）。两者在 Debian 上共享同一个
诱因（空 HOME + 系统 rc 的 compinit 提问），所以同一机制能同时解释两者是合理的；
**然而 (b) 的逐条吻合只是旁证，不是产品门禁的直接证据**。
产品门禁那三条的逐条错误文本，我没有取到，必须在 Linux runner 上取（见 §5）。

### 2.6 归因：这是门禁夹具缺陷，不是产品缺陷（代码证明）

- `compaudit` 审计的是 `$fpath` 和 `$ZDOTDIR/.zcompdump` 的属主，**不审计 `ZDOTDIR` 目录本身**
  （`compaudit:117-126`）。所以产品把 wrapper 放在 `/tmp` 下的 0700 临时目录
  （`shell_startup.rs:159-161`）**不是** insecure 判定的来源。
- newuser 向导在 `$ZDOTDIR` 有任一启动文件时就不触发，产品 wrapper 写满四个文件
  （`shell_startup.rs:63-78`），所以应用路径下向导不会出现。

也就是说：真实用户有自己的 `$HOME`，里面通常有 `.zshrc`；触发这条失败需要的是
「一个完全空的 HOME」，那是门禁夹具造出来的条件，不是产品在用户机器上的状态。
**但**产品 wrapper 确实没有对系统 rc 的阻塞做任何防护，所以一个 HOME 为空的真实
Debian 新账户在应用里应当会遇到同样的事——这一点是**推断**，本轮没有测。

---

## 3. 我改了什么

共 4 个文件改动 + 2 个新增文件，未 commit。

| 文件 | 性质 | 是否进源码指纹 |
| --- | --- | --- |
| `scripts/run-terminal-shell-probe.mjs` | 修复 | **是**（显式列入 `FINGERPRINT_PATHS`） |
| `src-tauri/src/session/pty_diagnostics.rs` | 让失败自解释 | **是**（`src-tauri/src` 下） |
| `scripts/run-terminal-shell-probe.test.mjs` | 回归 | 否（test 文件被排除） |
| `docs/issue.md` | 更正错误记载 | 否（docs 被排除） |
| `docs/phase9/linux-zsh-probe-diagnosis.md` | 新增，本文件 | 否 |
| `scripts/experiments/zsh-swallowed-byte-*` | 新增，可复跑实验 | 否 |

**对 evidence gate 的影响（必须知道）**：前两个文件在源码指纹路径里，所以本轮改动
**已经让源码指纹变化**（`c5cbea63…` → `3698e610…`）。`check-verification-evidence.mjs`
因此继续报 7 条 fingerprint 失配——**这与改动前完全一样**（AGENTS.md 已记录 Phase 7
起这 6 份证据就待重采），但本轮改动意味着那次重采必须在包含本改动的提交上做，
不能沿用更早的测量。

### 3.1 `scripts/run-terminal-shell-probe.mjs`（修复）

新增 `PROBE_HOME_STARTUP_FILES` 与 `seedProbeHome()`，在 app 启动前往探针的合成 HOME 写：

    .zshenv   skip_global_compinit=1
    .zshrc    PS1='probe$ '

依据：第 2 节。放在 `$HOME` 而不是改产品 wrapper，是因为产品 wrapper 的 `.zshenv`
**本来就转发到 `$HOME/.zshenv`**，所以种子文件是**经由产品真实的注入链**生效的，
不绕过被测对象。我已实验验证这条链成立（见 3.4）。

### 3.2 `src-tauri/src/session/pty_diagnostics.rs`（让失败自解释）

`MARKERS` 增加两条：`zsh-compinit-prompt`（`abort compinit`）、
`zsh-newuser-prompt`（`zsh-newuser-install`），并加一条 Rust 测试
`the_system_rc_prompts_that_swallow_input_are_named_in_the_trace`
（含一条「普通 compinit 横幅不得误报」的负面断言）。

依据：Phase 9.0 的教训是「读代码猜测连错 4 次，加插桩后每次一轮定位」。
这两条 marker 让下一次 Linux 运行在 artifact 里直接写出阻塞原因，
而不是只留一个 deadline。这个诊断在该作业里已经是开着的
（`real-machine-matrix.yml` 已设 `TERMINAL_PTY_DIAGNOSTICS_PATH` 并上传 artifact）。

### 3.3 `scripts/run-terminal-shell-probe.test.mjs`（回归）

新增 2 条断言：种子文件确实写了、且 `.zshenv` 必须含 `skip_global_compinit=1`。
另外给 4 个既有测试的 `dependencies` 补 `writeFile` stub——它们此前没有这个 stub，
因为改动前 `writeFile` 只在 SSH 分支被调用。

### 3.4 本机验证结果

- 产品 wrapper 转发链实验（真实 zsh 5.9）：HOME 为空时 `skip_global_compinit` 为空；
  种子文件到位后为 `1`，且在 `.zprofile` 时刻（即 `/etc/zsh/zshrc` 之前）已生效。**实验证明**
- 修复后重跑 2.5 的掉字符实验：三条原本 NO-READY 的用例变成 ready。**实验证明**
- `scripts/run-terminal-shell-probe.test.mjs`：21/21 通过（改前 19/19）。
- `node --test scripts/*.test.mjs`：294 passed / 4 failed；**这 4 条在 baseline 上完全相同**
  （逐条 diff 为空），全是沙箱 `/tmp` EPERM。
- `cargo test --lib`：291 passed / 11 failed；**这 11 条在 baseline 上完全相同**
  （逐条 diff 为空），全是沙箱 `openpty` / `bind` EPERM。
- `cargo clippy -D warnings`、`cargo fmt --check`、`check-source-size.mjs`（558 文件）：均通过。

---

## 4. 本机为什么不能闭合

- **沙箱禁止分配 PTY**：`/dev/ptmx` → EPERM，`openpty` → “out of pty devices”。
  所以本机无法驱动任何交互式 shell，2.5 的实验是用非 PTY 的 `zsh -c` 做的
  ——它能证明「掉一个字符会导致什么」，**不能**证明「Linux 上确实掉了那一个字符」。
- **Docker socket 不可达**：permission denied，无法起 Debian 容器。
- **GitHub API 被拦**：`api.github.com` deny，无法取 run 41231265959 的 Linux 日志。
  仓库内 `docs/verification/raw/41231265959/` 里的 shell-probe 日志是 **macOS** 作业的
  （路径为 `/Users/runner/...`），Linux 作业没有 tee 到文件。

所以第 2.2 节那条 Debian 行为，我用的是仓库里已有的真实 runner 实测
（run `41189424959`），不是本轮新测的。

---

## 5. 结论的证据等级汇总

| 结论 | 等级 |
| --- | --- |
| 产品 wrapper 不含 `skip_global_compinit`；`docs/issue.md:3874` 写错了 | 代码证明 |
| 诊断脚本 `app` 变体与产品在这一点上不一致，所以它的 Linux 4/4 不能代表产品 | 代码证明 |
| 探针 HOME 是空 mkdtemp，改动前无人写启动文件 | 代码证明 |
| 探针盲打 setup，不等提示符 | 代码证明 |
| `compinit` 用 `read -q`，只吃一个字符 | 代码证明 |
| 丢首字符 → 偏离的恰好是 `readline-history` / `readline-tab` / `pty-resize`，另外四条不受影响 | 实验证明（macOS，非 PTY）+ 与产品门禁自记的三条集合 3/3 吻合 |
| 丢首字符能解释两种不同的错误文本（两条 NO-READY、一条 ready 但判不出） | 实验证明；与 **Python 诊断脚本** `plain` 四行 4/4 吻合，**仅为旁证**，非产品门禁日志 |
| Debian `/etc/zsh/zshrc` 会在 compinit 上阻塞 | 仓库既有真实 runner 实测（run 41189424959） |
| 种子 `.zshenv` 经产品 wrapper 转发链生效，且早于 `/etc/zsh/zshrc` | 实验证明（macOS） |
| **Linux 上这三条用例在修复后转 PASS** | **NOT_RUN** |
| 真实空 HOME 的 Debian 新账户在应用里也会遇到此问题 | 推断 |

---

## 6. 仍需 Linux runner 取证（NOT_RUN）

**不要**因为本机全绿就把 #60 记为已修复。下面是需要在真实 Linux runner 上跑的取证。

### 6.1 直接复跑产品门禁

    xvfb-run -a pnpm smoke:shell-probe:matrix -- --shells zsh \
      readline-history,readline-tab,pty-resize

看什么：三条应全部 PASS。只要还有一条 TIMEOUT，第 2 节的机制就被推翻，别改参数重试。

### 6.2 读 PTY 诊断 artifact（判定是否同一机制）

该作业已设 `TERMINAL_PTY_DIAGNOSTICS_PATH` 并上传 `pty-diagnostics-linux`。
在**修复前**的产物里（例如重跑一次把 `seedProbeHome` 注掉），应能看到我新加的 marker：

    jq -r '.entries[] | "\(.at_ms) \(.kind) \(.detail)"' pty-diagnostics/*.json \
      | grep -E 'zsh-compinit-prompt|zsh-newuser-prompt'

看什么：
- 出现 `zsh-compinit-prompt` → 机制确认，就是 compinit 提问。
- 两条 marker 都没有，但三条用例仍超时 → 机制不是 compinit，第 2 节作废，
  此时应改读同一份 artifact 里 `write` 条目的 `echo_ms` 与紧随其后的 `read` detail，
  看第一条 write 的回显是否比键入内容少一个字符。

### 6.3 直接确认 Debian 的系统 rc 行为（一条命令，不依赖本项目）

    docker run --rm -it debian:stable bash -lc \
      'apt-get update -qq && apt-get install -y -qq zsh >/dev/null && \
       grep -n "compinit\|skip_global_compinit" /etc/zsh/zshrc'

看什么：`/etc/zsh/zshrc` 里是否确有 `compinit` 调用、以及是否以
`skip_global_compinit` 为前置判断。这一条补上后，2.2 就从「仓库既有实测」升级为本轮直接证据。

### 6.4 若 6.1 通过，仍需补的一条

`--transport ssh` 那条作业**不受本修复影响**：SSH 夹具用 `env -i` 带自己的 HOME，
且登录 shell 默认 `/bin/sh`（`terminal-smoke-sshd.mjs:541`、`:596`），不走 zsh。
所以不要把 local 作业转绿当成 SSH 作业也被修好——那是两个不同的被测对象。

---

## 7. 给下一个接手的人

- 不要再把 `scripts/diagnose-zsh-rc.py` 的 `app` 变体当成产品的等价物。它现在
  （`:179`）比产品多一行 `skip_global_compinit=1`。要么把那行删掉让它真的等价，
  要么在脚本里显式写明「本变体与产品存在此处差异」。本轮没有改这个脚本，
  因为改它会让 Phase 9.0 已记录的那张矩阵失去可比性。
- `docs/issue.md:3874` 那一行**本轮已更正**（原文声称产品 wrapper 的 `.zshenv` 带
  `skip_global_compinit=1`，与 `shell_startup.rs:63-78` 不符），并在 #60 末尾追加了
  本轮的机制、改动与未闭合项。另一条线在用的 `docs/phase9-1/` 未改。
- 本轮未改产品 wrapper。如果将来决定让产品自己防住系统 rc 阻塞，
  改法是在 `zsh_wrapper_files()` 的 `.zshenv` 里加 `skip_global_compinit=1`；
  但那会改变真实用户的 shell 行为（用户可能依赖系统 compinit），
  属于产品决策，不应作为修门禁的副作用顺手改掉。
