# 验收证据：为什么 7 个问题是对的（P9.2-11）

> 当前命令与结果：
>
> ```
> $ node scripts/check-verification-evidence.mjs
> Verification evidence gate failed: 7 problem(s).
> $ echo $?
> 1
> ```
>
> **这不是待办事项，是本轮的真实状态。** 本文说明它为什么必须是这样、
> 本阶段做了什么让这个状态不再能被忽略、以及怎么闭合。

## 1. 7 个问题分别是什么

| # | 对象 | 问题 |
| --- | --- | --- |
| 1 | `evidence-manifest.json` | 记录指纹 `2f62fabd…`，当前源码指纹 `41b45f31…` |
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

## 2. 为什么会失配

`scripts/check-verification-evidence.mjs` 的 `FINGERPRINT_PATHS` 包含：

```js
'src-tauri/src',
'src-tauri/capabilities',
'src-tauri/Cargo.toml',
'src-tauri/Cargo.lock',
'src-tauri/tauri.conf.json',
'packages/frontend/src',
'docs/...' 之外的大部分产品与脚本源码
```

本阶段做了 **russh 0.60.3 → 0.65.0 迁移**和 **15 个依赖升级**，`Cargo.toml` 与
`Cargo.lock` 必然改变；`src-tauri/src` 下 `commands.rs` / `session/ssh.rs` /
`ssh_host_key.rs` / `state.rs` / `terminal_smoke_tests.rs` 也都有实际改动（见第 5 节）。

指纹是对「路径 + 文件内容」按排序后的 SHA-256，所以**任何一次产品源码改动都会让它变**。
这不是门禁太严，而是它的全部意义：**证据必须能说清自己描述的是哪一份代码**。

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

### 3.1 随之而来的直接后果：CI 现在是红的

因为证据确实失效了，这个 job 会在下一次 CI 上失败。**这是正确的**：
它把「六份证据描述旧代码」这件事从一个没人看的本地警告，变成了一个必须处理的红色 job。
在证据重采之前，**合并与发布都必须知道这条红是已知且已解释的**，而不是把它当成噪声忽略——
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

## 6. 怎么闭合（并明确不做的事）

```bash
gh workflow run real-machine-matrix.yml --ref feat/phase9-2-sync-security-hardening
# macOS 作业：7 个场景全部测量 → build-verification-evidence.mjs 生成证据 → upload
node scripts/fetch-verification-evidence.mjs --latest
node scripts/check-verification-evidence.mjs      # 期望 0 problem
```

`scripts/build-verification-evidence.mjs` 会在下列任一情况**拒绝写文件**
（`Evidence build refused: N problem(s). No file was written.`）：

- 任一场景缺失或非绿；
- 日志里测的二进制哈希与本 job 构建并哈希的产物不一致；
- 冷启动三次不齐、或矩阵用例数不足（本地 14 / 真实 SSH 7 / debug SSH 11 / release SSH 8）。

所以不存在"只写一半证据"或"用旧一次的数字凑数"。

**明确不做的事：**

- ❌ 不改证据文件里的指纹让它变绿；
- ❌ 不删 manifest 里的证据条目来缩小检查面；
- ❌ 不把这一步加回 `continue-on-error`；
- ❌ 不在本机 macOS 上重采充当证据（本机不是 CI runner，窗口/输入行为不可代表；
  且 `provenance.source` 必须为 `github-actions`）。

## 7. 状态与归属

| 项 | 状态 |
| --- | --- |
| 证据门禁接入 CI 且阻塞（P9.2-11） | ✅ **完成** |
| 六份证据重采 | 🔴 **NOT_RUN**（BLOCKED_EXTERNAL：需要真实 macOS runner，本轮无法从本地触发构建） |
| 证据门禁当前结果 | 🔴 **7 个问题**（这是正确结果） |

**不得声称**：「证据门禁通过」。它当前失败，而且失败得对。
**不得声称**：「六份证据仍然有效」。它们描述的是 `030fda4`。
