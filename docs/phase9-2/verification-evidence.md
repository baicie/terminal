# 验收证据：从 7 个问题到 0 个（P9.2-11）

> **最终状态**（2026-11-02，commit `a093fc7`，run `41434165000`）：
>
> ```
> $ node scripts/check-verification-evidence.mjs
> Verification evidence gate passed for 6 current evidence file(s).
> $ echo $?
> 0
> ```
>
> 但本文的重点不是这个绿。**这个绿必须能说明自己是怎么来的**：
> 它来自在真实 macOS runner 上、对 commit `a093fc7` 的一次重采，
> 而不是来自修改证据里的指纹。在此之前它曾正确地红了 7 个问题（见第 1 节），
> 而那条红之所以存在，是因为门禁被接进了 CI（第 3 节）。

## 0. 两次 run 与它们各自的有效范围

| run | sha | 结果 | 证据是否有效 |
| --- | --- | --- | --- |
| `41432020659` | `e367e3d` | 三平台全绿，证据已生成 | ❌ 指纹对应 `e367e3d`，已被后续提交取代 |
| `41434165000` | `a093fc7`（= 当前 HEAD） | 三平台全绿 | ✅ 已安装，门禁 0 problem |

第一次 run 之后我又提交了一次 `.github/workflows/real-machine-matrix.yml` 的注释更正。
该文件在 `FINGERPRINT_PATHS` 内，所以 run A 的证据在提交的瞬间就失效了——
这正是指纹机制在按设计工作，不是浪费：**测量结果绑定的是代码身份，不是"最近一次成功"**。

## 1. 曾经的 7 个问题分别是什么

| # | 对象 | 问题 |
| --- | --- | --- |
| 1 | `evidence-manifest.json` | 记录指纹 `2f62fabd…`，当时源码指纹 `41b45f31…` |
| 2–7 | 六份证据文件 | 各自记录的 `source.fingerprint` / `provenance.fingerprint` 同为 `2f62fabd…` |

六份文件是：

```
2026-10-11-macos-cold-start-current.json
2026-10-11-macos-remote-shell-prompt-rerun.json
2026-10-11-macos-ssh-matrix-current.json
2026-10-11-macos-shell-interaction-current.json
2026-10-11-macos-release-terminal-gate.json
2026-10-11-macos-release-ssh-matrix.json
```

（文件名里的 `2026-10-11` 是历史命名，内容实际由 run `41231265959` 在 2026-10-31 产出。）

## 2. 为什么会失配（以及重采是怎么让它一致的）

`scripts/check-verification-evidence.mjs` 的 `FINGERPRINT_PATHS` 包含：

```js
'src-tauri/src',
'src-tauri/capabilities',
'src-tauri/Cargo.toml',
'src-tauri/Cargo.lock',
'src-tauri/tauri.conf.json',
'.github/workflows/real-machine-matrix.yml',   // ← 本轮又改了这个文件
'packages/frontend/src',
'scripts/run-*', 'scripts/terminal-smoke-*',
```

本阶段做了 **russh 0.60.3 → 0.65.0 迁移**和 **15 个依赖升级**，`Cargo.toml` 与
`Cargo.lock` 必然改变；`src-tauri/src` 下 `commands.rs` / `session/ssh.rs` /
`ssh_host_key.rs` / `state.rs` / `terminal_smoke_tests.rs` 也都有实际改动（见第 5 节）。

指纹是对「路径 + 文件内容」按排序后的 SHA-256，所以**任何一次产品源码改动都会让它变**。
这不是门禁太严，而是它的全部意义：**证据必须能说清自己描述的是哪一份代码**。

本轮指纹的三个值：

| 阶段 | 指纹 | 说明 |
| --- | --- | --- |
| 阶段起点（`2f1d68f` 时记录的旧证据） | `2f62fabd…` | 描述 `030fda4` |
| 依赖升级后、重采前 | `41b45f31…` | 门禁红的那个值 |
| 计入矩阵注释更正后的最终代码（`a093fc7`） | **`365bdee7…`** | 新证据记录的值，与本地计算结果逐字节一致 |

`365bdee7…` 是我在下载前**独立**用 `computeSourceFingerprint()` 算出来的，
与 run `41434165000` 在 runner 上算出的值相同。这排除了"证据与本地代码不是同一份"的可能。

## 3. 门禁从前是怎么被绕过的（P9.2-11 要修的就是这个）

修复前，`check-verification-evidence.mjs` 只通过 `pnpm verify` 可达，
而 CI 里**没有任何 job 调用 `pnpm verify`**。后果：

- 一个 commit 可以改产品源码、留下六份描述旧 checkout 的证据文件，而所有 job 全绿；
- 门禁只在开发者本地手动跑时才有作用，等于一个自愿遵守的约定。

本阶段的改动（`.github/workflows/ci.yml`）：

```yaml
  source-size:
    name: Repository gates (source size, evidence, script tests)
    steps:
      - run: pnpm check:source-size
      # Fails when any recorded evidence describes a different checkout than the
      # one being built. It is intentionally NOT advisory: `continue-on-error`
      # here would recreate the exact gap this job was widened to close.
      - name: Verification evidence matches this checkout
        run: node scripts/check-verification-evidence.mjs
      - run: node --test scripts/*.test.mjs
```

三点值得注意：

1. **没有 `continue-on-error`**。加回去就等于把这次修复撤销。
2. **和 `check:source-size` 同 job**：两者都是廉价、离线、关于仓库而非产品构建的检查。
3. **`node --test scripts/*.test.mjs` 也在这里**：门禁脚本自身的测试（现 359 项）
   与门禁同 job 运行，所以改门禁必须同时让它的测试通过。

### 3.1 直接后果：重采之前 CI 确实是红的

因为证据确实失效了，这个 job 在重采前的那几次 CI 上是失败的——`e367e3d`（run `41431670086`）与 `a093fc7`（run `41434168073`）两个提交的 run 都是 **10 个 job 里 9 绿 1 红，红的就是它**。**这是正确的**：
它把「六份证据描述旧代码」这件事从一个没人看的本地警告，变成了一个必须处理的红色 job。

**这条红不是靠关掉门禁消除的，是靠第 6 节的重采消除的。** 在证据装好并提交之前，
合并与发布都必须知道这条红是已知且已解释的，而不是把它当成噪声忽略——
一旦开始忽略它，这次修复就白做了。

## 4. 这条门禁到底校验什么

不是为了"格式好看"，而是五类绑定：

| 绑定 | 校验内容 |
| --- | --- |
| **源码指纹** | 证据里的 `source.fingerprint` 必须等于当前 `FINGERPRINT_PATHS` 的哈希 |
| **产物哈希** | `binary.sha256`（debug）/ `build.sha256`（release）必须等于 manifest 的 `debugSha` / `releaseSha` |
| **产物路径** | 必须精确是 `src-tauri/target/debug/terminal` / `.../release/terminal`（见 `BINARY_BINDING`） |
| **manifest 条目** | 每个文件必须在 `evidenceFiles` 里有条目，且哈希一致 |
| **raw log 归档** | manifest 列出的 7 份 `.log` 必须真实存在于 `docs/verification/raw/<runId>/` |

本轮这五类绑定各自的落地值（run `41434165000`）：

| 绑定 | 值 |
| --- | --- |
| 源码指纹 | `365bdee7…`（证据内 6 处 `source.fingerprint` + manifest 一处） |
| debug 产物 | `ab620842e9c9adc1…`（`src-tauri/target/debug/terminal`） |
| release 产物 | `f64a9113521ff2c4…`（`src-tauri/target/release/terminal`） |
| manifest 条目 | 6 条 `evidenceFiles`，逐条带 `sha256` |
| raw log | 7 份，落在 `docs/verification/raw/41434165000/` |

第 3 条是上一轮修的漏洞：旧实现会**收集文档里任意位置的 `sha256` 字段**并进行匹配，
所以把摘要粘进 note、description 或 fixture 块也能"通过"——而真正命名被测二进制的字段
可以写着别的东西。现在只认固定路径。

第 5 条同样防伪造：JSON 是摘要，raw log 才是"确实跑过"的痕迹。
manifest 里列了打不开的日志，等于审计链断了。

## 5. 本阶段的源码改动（它们让指纹失效，也确实是产品改动）

| 文件 | 改动 |
| --- | --- |
| `src-tauri/Cargo.toml` | `russh 0.60 → 0.65`、`ssh-key 0.6 → 0.7.0-rc.11`（加 `rand_core`/`getrandom` features） |
| `src-tauri/Cargo.lock` | 578 增 / 960 删 |
| `src-tauri/src/session/ssh.rs` | `OsRng` → `UnwrapErr(SysRng)`；`Comment` 用 `is_empty()` 断言 |
| `src-tauri/src/ssh_host_key.rs` | `check_server_key` 收 `PublicKeyOrCertificate`；新增 `probe_key_to_record` |
| `src-tauri/src/state.rs` | 同一签名迁移；证书分支明确用其内嵌公钥做 known_hosts 比对；agent-forward 的 `reply` 显式拒绝 |
| `src-tauri/src/commands.rs` | 密钥生成的 RNG 迁移 |
| `src-tauri/src/terminal_smoke_tests.rs` | 夹具密钥生成的 RNG 迁移 |

也就是说：**指纹变化不是噪声，是七处真实的源代码改动**。它们需要被重新测量。
本轮已经重测；此外还有第八处改动在矩阵工作流里（见第 2 节表）。

## 6. 重采是怎么做的（并明确不做的事）

**已执行**（2026-11-02）：

```bash
gh workflow run real-machine-matrix.yml --ref feat/phase9-2-sync-security-hardening
# macOS 作业：12 个测量/生成步骤全绿 → build-verification-evidence.mjs 生成证据 → upload
node scripts/fetch-verification-evidence.mjs --run-id 41434165000
# → Installed 6 evidence file(s) and evidence-manifest.json
# → Installed 7 raw log(s) into docs/verification/raw/41434165000/.
node scripts/check-verification-evidence.mjs      # → 0 problem, exit 0
```

`scripts/build-verification-evidence.mjs` 会在下列任一情况**拒绝写文件**
（`Evidence build refused: N problem(s). No file was written.`）：

- 任一场景缺失或非绿；
- 日志里测的二进制哈希与本 job 构建并哈希的产物不一致；
- 冷启动三次不齐、或矩阵用例数不足（本地 14 / 真实 SSH 7 / debug SSH 11 / release SSH 8）。

所以不存在"只写一半证据"或"用旧一次的数字凑数"——run `41434165000` 能产出六份文件，
本身就是这些前置条件全部满足的证据。

**明确不做的事（本轮一条也没有违反）：**

- ❌ 不改证据文件里的指纹让它变绿 —— 六份文件全部由 run `41434165000` 覆盖写入；
- ❌ 不删 manifest 里的证据条目来缩小检查面 —— 仍是 6 条 `evidenceFiles` + 7 份 raw log；
- ❌ 不把这一步加回 `continue-on-error` —— `ci.yml` 未改这一处；
- ❌ 不在本机 macOS 上重采充当证据 —— 本机只做了下载与安装，`provenance.source` 为 `github-actions`。

## 7. 状态与归属

| 项 | 状态 |
| --- | --- |
| 证据门禁接入 CI 且阻塞（P9.2-11） | ✅ **完成** |
| 六份证据重采 | ✅ **完成**（run `41434165000`，sha `a093fc7`） |
| 证据门禁当前结果 | ✅ **0 problem，exit 0** |

**可以声称**：「证据门禁通过，且证据描述的是当前 HEAD `a093fc7`」——因为 manifest 的
`commit` 是 `a093fc704650ddb55fe800ae413756f14aabf571`，`fingerprint` 是本地独立算出的 `365bdee7…`。

**仍然不得声称**：「macOS 冷启动已证明稳定」。见 `shell-and-webview-stability.md` 2.4：
Phase 9.0 记录的约 20% WebKit 加载失败率没有被修复，三次观测不足以排除它。
