# Shell 与 WebView 稳定性（P9.2-9 / P9.2-10）

> 两条都必须分开说：**Linux shell probe** 与 **macOS 冷启动**是两个独立被测对象，
> 不能互相归因（这是 Phase 9.0 就定下的规矩，本轮继续遵守）。

## 0. 结论先行

| 项 | 状态 | 依据 |
| --- | --- | --- |
| P9.2-9 Linux zsh 三条 | ✅ **PASS** | run `41432020659`（sha `e367e3d`）与 run `41434165000`（sha `a093fc7`，= 当前 HEAD）的 Linux job 均 success，14 个用例（bash 7 + zsh 7）全绿，含此前三条 |
| P9.2-9 夹具修复本身 | ✅ 已完成 | `3d71988`：`PROBE_HOME_STARTUP_FILES` + `seedProbeHome()` |
| P9.2-10 macOS 冷启动（当前源码） | ✅ **PASS** | run `41434165000`（sha `a093fc7`）重采六份证据，`check-verification-evidence.mjs` **0 problem** |
| P9.2-10 macOS 冷启动（`030fda4` 源码） | ✅ 当时的测量通过 | 见第 2 节数字，**但它描述的是旧代码**，已被本轮重采取代 |

> **两条都在 2026-11-02 由真实 runner 闭合。** 上一版本文把它们记作 NOT_RUN 是对的：
> 那时确实没有任何测量跑在修复后的代码上。状态改变的唯一依据是新的测量，不是时间流逝。

## 1. P9.2-9：Linux zsh 探针

### 1.0 结论：2026-11-02 在真实 runner 上通过

| 项 | 值 |
| --- | --- |
| run | `41432020659`（sha `e367e3d`）、`41434165000`（sha `a093fc7`，= 当前 HEAD） |
| job | `Linux real SSH smoke` → **success** |
| 步骤 | `Run the real Linux shell interaction matrix` → **success** |
| 用例 | **14 个（bash 7 + zsh 7）全部 `ok: true`**，零失败 |
| 关键三条 | `zsh/readline-history` 360 ms、`zsh/readline-tab` 449 ms、`zsh/pty-resize` 1425 ms —— 均通过 |
| 生效夹具 | `3d71988` 的 `seedProbeHome()`（`scripts/run-terminal-shell-probe.mjs:455`） |

命令（CI 实际执行的那一行）：

```
xvfb-run -a pnpm smoke:shell-probe:matrix -- --shells bash,zsh \
  cat-eof,readline-history,readline-tab,vim-edit,nano-edit,pty-resize,ctrl-c-interrupt
```

**为什么这次通过是可信的**：`git merge-base --is-ancestor 3d71988 <run 的 sha>`
对两次 run 都成立；探针在 `mkdtemp` 出的空 `HOME` 上运行（`HOME: runDirectory`），
`seedProbeHome` 在其中写入 `.zshenv` = `skip_global_compinit=1`。
因此被测对象是**产品真实的 shell 注入路径**，不是被绕过的旁路。

### 1.1 上一轮记的 FAIL 是错的，随后更正为 NOT_RUN，现在才是 PASS

`docs/phase9-2/baseline.md` 的初稿把它记成 **FAIL**，理由是「矩阵 run `41231265959`
的 Linux 作业里 zsh 三条超时」。这句话本身没错，**但它测的不是当前代码**。核对过程：

```bash
$ git merge-base --is-ancestor 030fda4 3d71988 && echo YES_ANCESTOR
YES_ANCESTOR                       # 030fda4 是 3d71988 的祖先

$ git show 030fda4:scripts/run-terminal-shell-probe.mjs | grep -c skip_global_compinit
0                                  # 那次运行用的脚本里根本没有这个开关

$ git log --oneline -S"skip_global_compinit" -- scripts/run-terminal-shell-probe.mjs
3d71988 feat(phase9.1): 依赖升级 2 条、Linux zsh 失败机制定位、许可证清单取得

$ gh run list --workflow real-machine-matrix.yml --limit 30 --json createdAt,headSha
# 最新一条仍是 2026-10-31T18:49:26Z / 030fda4；没有任何 run 在 3d71988 或之后
```

也就是说：**「修好之后仍然失败」这件事从未被测量过**。把一次修复前的测量写成当前结论，
比没有结论更糟——它会让下一个人去修一个可能已经不存在的问题。

判定口径：**没有在包含修复的代码上跑过 = NOT_RUN**，不是 FAIL，也不是 PASS。

### 1.2 失败机制（上一轮已定位，这里是摘要）

Debian 的 `/etc/zsh/zshrc` 会调用 `compinit`；`compinit` 在 insecure directories 上停下来问

```
Insecure directories in your $fpath ...
continue [y] or abort compinit [n]?
```

这个提问用 `read -q` 读回答，而 **`read -q` 只从终端吃一个字符**。探针是盲打的
（`status === 'connected'` 就立刻发 setup 命令，不等提示符），于是被吃掉的正是
setup 命令的第一个字符：`printf` → `rintf`、`SHELL_PROBE_DIR` → `HELL_PROBE_DIR`。
后果恰好落在必须由 ZLE 解释字节的三条用例上（`readline-history` / `readline-tab` /
`pty-resize`），另外四条不受影响——与产品门禁自己记录的失败集合 **3/3 吻合**。

完整推导（含逐条实验、`read -q` 的语义、以及「为什么"卡死"是错的说法」）在
`docs/phase9/linux-zsh-probe-diagnosis.md`。

### 1.3 修的是夹具，不是产品

```js
// scripts/run-terminal-shell-probe.mjs（3d71988 起）
export const PROBE_HOME_STARTUP_FILES = {
  '.zshenv': 'skip_global_compinit=1\n',
  '.zshrc': "PS1='probe$ '\n",
}
```

放在探针的合成 `HOME` 而不是改产品 wrapper，是因为产品 wrapper 的 `.zshenv`
**本来就转发到 `$HOME/.zshenv`**：

```rust
// src-tauri/src/session/shell_startup.rs
pub(crate) fn zsh_wrapper_files() -> [(&'static str, String); 4] {
    [
        (".zshenv", source_zsh_user_rc(".zshenv")),   // 只有一行转发
        ...
    ]
}
```

于是种子文件**经由产品真实的注入链**生效，不绕过被测对象。

### 1.4 为什么没有顺手改产品

把 `skip_global_compinit=1` 写进产品 wrapper 只需要一行，且能让所有 Linux 用户免于这个坑。
**本轮没有这么做**，理由：

- 它会改变真实用户的 shell 启动行为。用户可能依赖系统 `compinit`（补全定义、`zcompdump` 缓存）；
  关掉它属于产品决策，不该作为"修门禁"的副作用发生。
- 任务书的约束是「任何全局 shell 初始化行为变更必须保留用户真实 rc 兼容性」。
  在 `.zshenv` 里加开关确实是兼容性的一个**未评估**改动，需要单独设计（例如只在检测到
  系统 rc 会提问时才加、或提供设置项）。

**遗留风险（推断，未测）**：一个 `$HOME` 为空或没有 `.zshenv`/`.zshrc` 的真实 Debian 新账户，
在应用里应当遇到同样的 compinit 提问。这条在本机无法验证，必须由 Linux 实机确认。
**本轮仍然没有测它**：探针夹具正是为了绕开这个提问而把 `HOME` 造得"像个正常账户"，
所以 1.0 的绿灯不能读成"真实空账户也安全"。它测的是产品的注入链，不是系统 rc 的边界。

### 1.5 怎么复跑（已在本轮执行）

```bash
gh workflow run real-machine-matrix.yml --ref feat/phase9-2-sync-security-hardening
# 看 jobs 里的 "Linux real SSH smoke" → "Run the real Linux shell interaction matrix"
# 14 条（bash 7 + zsh 7）应全 PASS
```

若将来仍失败，读 `pty-diagnostics-linux` artifact：
出现 `zsh-compinit-prompt` → 机制确认，说明夹具没生效；
两条 marker 都没有 → 机制不是 compinit，1.2 作废，重新定位。

**不要**用调大 `RESULT_TIMEOUT_MS`（现为 60 s，用例内 deadline 30 s）或跳过失败用例来"修复"。
那两条都被任务书点名禁止，而且对 1.2 的机制完全无效——字节被吃掉不是慢。

## 2. P9.2-10：macOS 冷启动

### 2.1 当前有效的测量（`a093fc7`，run `41434165000`，2026-11-02）

源码指纹 `365bdee7…`，`check-verification-evidence.mjs` 报 **0 problem**。

| 场景 | spawn→ready（三次） | 结论 |
| --- | --- | --- |
| debug 本地冷启动 | **7679 / 4042 / 3301 ms** | 三次都 < 10 s |
| release 本地冷启动 | **4692 / 3621 / 3128 ms** | 三次都 < 10 s |
| debug 远程冷启动（提示符观测） | **5061 ms**（单次） | < 10 s |
| debug SSH 认证矩阵 | 11 例全绿，首连 3123–7506 ms | — |
| release SSH 认证矩阵 | 8 例全绿，首连 2681–3642 ms | — |
| 本地 shell 交互矩阵 | 14 例（bash 7 + zsh 7）全绿 | — |

二进制：debug `ab620842…`、release `f64a9113…`，与 manifest 的 `debugSha` / `releaseSha` 一致。

**一个必须说清的巧合**：debug 本地冷启动的**第一次**又是 `7679`，与上一轮（`030fda4`）相同。
这不是复制旧值——三次 `capturedAt`（`2026-11-02T11:12:00.577Z` 起）、`pid`（20151 / 20416 / 20469）、
`nonce` 全部是新的，后两次（4042 / 3301）也与旧值（4462 / 4109）不同。
一个 7.6 秒量级里出现整数相同完全可能；如果只凭这个数字判断，会把两次独立测量误认成一次。

**形态与上一轮一致，仍然值得记住**：

- debug 的**第一次**总是明显更慢（7679 vs 4042 / 3301）。冷启动预算要按首次算。
- `windowReady` 仍恒为 `false`。远程模式下 AX 探针固定为 `none`，这个字段从来不是证据。

### 2.2 上一轮的数字（`030fda4`，run `41231265959`）——已被取代

| 场景 | 三次 spawn→ready | 结论 |
| --- | --- | --- |
| debug 本地冷启动 | 7679 / 4462 / 4109 ms | 三次都 < 10 s |
| release 本地冷启动 | 4666 / 4759 / 4291 ms | 三次都 < 10 s |
| debug 远程冷启动（提示符观测） | 7025 ms（单次） | < 10 s |

同一个二进制 SHA-256（debug `12d908e6…`、release `f6e323be…`）与当时的 manifest 一致，
所以这一组数字在当时是可信的。

**两个值得记住的形态**：

- debug 的**第一次**总是明显更慢（7679 vs 4462 / 4109）。冷启动预算要按首次算，
  不能拿后两次的均值自我安慰。
- `windowReady` 在三组里**恒为 false**。远程模式下 AX 探针固定为 `none`，
  所以这个字段从来不是证据——它在早期被误读成"窗口没显示"，实际是探针没接线。

### 2.3 为什么必须重测（本轮已执行）

本阶段的依赖升级把 `tauri`、`tauri-plugin-updater`、`tauri-plugin-notification`、
`rustls`、`tokio` 等 15 个 crate 换了版本，并把 `russh` 从 0.60 迁到 0.65。
`src-tauri/src`、`Cargo.toml`、`Cargo.lock` 全在 `FINGERPRINT_PATHS` 里，
所以 2.2 那组数字**描述的是 `030fda4` 的代码，不是当前代码**。
`check-verification-evidence.mjs` 当时因此报 7 个问题——这是门禁在正确工作。
本轮重采后指纹为 `365bdee7…`，0 problem。

### 2.4 已知的历史不稳定（不是本阶段引入的）

Phase 9.0 的本机实测：10 次远程冷启动里 **2 次失败**，失败时 `stages` 为 `none recorded`，
并抓到 `didFailProvisionalLoadForFrame code=-1004`——即 **WebKit 主框架加载失败**，
与 SSH 快慢无关（SSH 三段协议合计 70 ms，占总耗时 2.8%）。

这条**没有被本阶段修掉**，也不该被本阶段的任何改动声称修好了。它意味着即便重采通过，
冷启动仍然是一个**概率性**通过的场景：一次通过不等于稳定。
本轮的三次观测（7679 / 4042 / 3301）没有出现 `-1004`，但**三次不足以排除约 20% 的失败率**
（三次全过的概率在 20% 单次失败率下约为 51%）。所以 P9.2-10 的 PASS 意思是
「这一轮在真实 runner 上测到了」，不是「已证明稳定」。

### 2.5 本阶段对冷启动做了哪些改动

诚实地说：**没有针对冷启动的产品改动**。相关改动只有两类：

1. 依赖升级（可能影响启动耗时，方向和幅度未知）；
2. russh 0.65 的 API 迁移（`check_server_key` 现在收 `PublicKeyOrCertificate`）——
   它只在连接时执行，不在启动路径上，但它是 `src-tauri/src` 的改动，因此同样让指纹失效。

所以 P9.2-10 的闭合**只能靠重采**，不能靠推理。

### 2.6 怎么复跑

```bash
gh workflow run real-machine-matrix.yml --ref feat/phase9-2-sync-security-hardening
# macOS 作业跑完 7 个场景后，会把证据打进 artifact：
node scripts/fetch-verification-evidence.mjs --latest
node scripts/check-verification-evidence.mjs     # 应报 0 problem
```

`scripts/build-verification-evidence.mjs` 在任一场景不完整或非绿时**拒绝写文件**
（`Evidence build refused: N problem(s). No file was written.`），所以不存在
"只写一半证据"的情况。**不要**手工改证据里的指纹让它变绿。

## 3. 两条的共同教训

| 判断 | 错在哪 |
| --- | --- |
| 「上次跑了，失败了，所以现在是 FAIL」 | 没核对那次跑的是不是当前代码 |
| 「上次跑了，成功了，所以现在是 PASS」 | 同上，而且更危险——成功的那次会被当成稳定性证明 |

唯一的正确形态是：**证据必须绑定被测代码的身份**。本项目用源码指纹做这件事，
代价是每次改产品源码都要重采，收益是"什么时候的结论"永远不会被记错。
