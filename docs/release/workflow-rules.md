# 发布与证据规则

> 归纳自 2026-10-29 的实机验证与 CI 真跑。每条规则都标注了它是被哪次真实失败逼出来的，不是凭空约定。
> 相关文档：`docs/release/ci-audit.md`（现状审计）、`release-modes.md`（三级签名）、`signing-keys.md`（密钥）、`operations.md`（操作步骤）、`ci-report.md`（最近一次实测结果）。

## 1. 证据与指纹（最容易踩、代价最大）

| 规则 | 依据 | 违反后果 |
| --- | --- | --- |
| 改任何 `FINGERPRINT_PATHS` 内的文件（`src-tauri/**`、`packages/frontend/src/**`、`scripts/run-*.mjs`、`check-verification-evidence.mjs` 等）都会让六份 `docs/verification` 失效 | evidence gate 直接报 “was recorded against source fingerprint X, but sources now fingerprint as Y” | `pnpm verify` 红，任何「证据有效」的说法都不成立 |
| 顺序固定：**冻结源码 → 派发 macOS 证据 job → 下载产物 → 过门禁** | 门禁脚本、runner 与 workflow 本身都在指纹路径内，采集期间再改任何一处都会让刚采的证据立刻作废 | 白跑一轮 CI |
| 插桩产物必须带 `VITE_TERMINAL_SMOKE_BUILD=1` | 普通 `tauri build` 没有 smoke/probe 入口，runner 会显式拒绝（`findInstrumentedChunkNames` 返回 0） | 采集全红 |
| 证据数值只能来自 runner 输出；写入器要 fail-closed | 2026-10-29 首次采集时写入器拒绝写入 `attempt is not clean: password,password-reconnect` | 假证据进仓库 |
| 证据与二进制的绑定对象是**同一次 CI 运行的 manifest**（`docs/verification/evidence-manifest.json`），不再是本机磁盘文件：`fingerprint` = 当前源码指纹、`debugSha` = 4 份 debug 证据的 `binarySha256`、`releaseSha` = 2 份 release 证据的 `binarySha256`、每份证据 `provenance.runId` = manifest 的 `runId` | CI 构建与本机构建不保证位级一致（换工具链或 feature 集就会得到不同字节），「磁盘文件必须等于 CI 文件」只对跑了采集的那台机器成立 | 证据与产物脱钩，门禁直接红 |
| 六份证据由 `.github/workflows/real-machine-matrix.yml` 的 macOS job 产出，本机只下载：`node scripts/fetch-verification-evidence.mjs --latest`（`--with-binaries` 同时把两个产物放回 `src-tauri/target`） | 写入器 `scripts/build-verification-evidence.mjs` 只从 `evidence-logs/*.log` 取数：缺 case、出现 ❌、`spawnToReadyMs > 10000`、或日志里的 `Measured <profile> binary <sha>` 与本次构建哈希不一致，都拒绝写文件 | 手填/补数的证据过不了 manifest 与 `provenance` 检查 |
| 证据与 manifest 必须来自**同一次 run**；`docs/verification/raw/<runId>/` 保存该次 run 的原始日志并一起提交 | 没有原始日志时，证据里的每个数字都无法复算 | 审计断链 |
| `password` / `password-reconnect` 需要 Docker（Debian OpenSSH 容器），而 GitHub 托管 macOS runner **没有 Docker**；新增的 native 后端能在 runner 上建号并完成口令认证，但 app 侧 channel 始终打不开（`docs/issue.md` #144） | 因此 macOS 证据契约已**有意收窄为 11-case（debug）/ 8-case（release）**，只覆盖该平台测得出的 case | 收窄写在 `scripts/check-verification-evidence.mjs` 的注释里；要恢复 13/10 必须先解决 #144，不是改门禁 |
| 想换二进制又不破坏证据：用独立的 `CARGO_TARGET_DIR` 打包，或打包后把锚定二进制还原 | 本次打 DMG 时用 `CARGO_TARGET_DIR=/tmp/terminal-ship` 保住了证据 | 打包一次就得重采一轮 |
| **不要把 updater 公钥写进 `tauri.conf.json`**：用 CI 的 `--config` 从 `TAURI_UPDATER_PUBKEY` 注入 | `tauri.conf.json` 在指纹路径内，改它就要重采六份证据 | 白跑一轮采集 |
| `$` + 双大括号写法（Actions 表达式）读不到 `$GITHUB_ENV` 写入的值；跨步骤传值要用 job 级 `env` 表达式 | tauri-action 的 `args:` 是表达式求值，不是 shell | 公钥注入悄悄失效，产出未签名的包 |

> 说明：`nightly.yml` 已于 2026-10-29 按项目决定移除，下面几条用 nightly 真跑作为证据的规则仍然有效（它们来自真实失败，与是否保留该 workflow 无关）。

## 2. 采集环境

| 规则 | 依据 |
| --- | --- |
| `run-terminal-smoke`（SSH 矩阵）要求每个 case 前应用在前台；**锁屏时前台恒为 `loginwindow`**，断言必败 | 报错原文 `expected process X to be frontmost, got 162`，PID 162 = loginwindow |
| `cold-start` 与 `shell-probe` 两个 runner **不需要窗口激活**，锁屏也能跑 | 锁屏期间成功采到 debug 冷启动、远程 prompt、shell 14+7、release 冷启动与 shell 矩阵 |
| password 类 case 需要 **Docker 守护进程**在跑 | 首次采集报 `failed to connect to the docker API … docker.sock`，启动 Docker 后两个矩阵重跑全绿 |
| 因此在 CI 上，password 两条**只在 Linux job 的容器里**跑（该步骤为绿），不进 macOS 的 6 份证据 | 曾打算把两者都放进 macOS 契约，实测 runner 无 Docker、native 后端卡在 #144 |
| 采集必须在「无人操作」窗口执行：键盘注入与 AX 探针会抢前台 | 自动化流程一律用 `IOConsoleLocked` + `HIDIdleTime ≥ 120s` + 无其它自动化 三重门控 |

## 3. 发布模式与 tag

| 规则 | 依据 |
| --- | --- |
| **推送 tag 永远只走 `unsigned-qa`**；需要密钥的模式必须显式 `workflow_dispatch` 选择 | 一个 tag 不该意外产生签名产物 |
| `updater-signed` 缺 `TAURI_SIGNING_PRIVATE_KEY`，或 secret `TAURI_UPDATER_PUBKEY` 为空/非 base64 → **直接失败，不降级** | 否则「已签名」变成假话 |

> **2026-11-01 更正（Phase 8 P8.7）**：原文把触发条件写成「`plugins.updater.pubkey` 仍是占位符」，这不准确——仓库里的占位符**不会**让流程失败。实际校验的是 secret `TAURI_UPDATER_PUBKEY` 非空且形如 base64（`release.yml:117-127`）；真实公钥只在 `workflow_dispatch + release_mode=updater-signed` 时经 `--config` 内联。
| `fully-signed` 本阶段命中即失败 | 没有 Apple/Windows 证书 |
| Release **先建 draft + prerelease**，资产校验 + `SHA256SUMS.txt` +（updater 模式下）`.sig` 与 `latest.json` 全部通过后才 undraft | 任一步失败就让它留在草稿，不进更新源 |
| **draft 不能用 `/releases/tags/{tag}` 查**（该端点对草稿返回 404），必须从 `/releases?per_page=100` 按 `tag_name` 选 | run `40810787564` 就是栽在这里 |
| `gh release create` 要同时带 `--draft` 与 `--prerelease` | run `40810656873`：只带 draft 时「必须是 prerelease draft」校验失败 |
| 已发布的 release 拒绝覆盖，必须升版本号 | 防止同号不同物 |
| macOS 的 ad-hoc 签名**不等于** Developer ID，也不构成公证，发布说明必须写明 | 实测 `adhoc, linker-signed`、`TeamIdentifier=not set` |

## 4. CI / 构建

| 规则 | 依据 |
| --- | --- |
| 改 workflow 后 `actionlint`（含 shellcheck 集成）必须 0 报错 | 本次多次靠它抓到未使用变量、语法错误 |
| `--locked` 要求 `Cargo.toml` 与 `Cargo.lock` 版本同步；批量改版本必须同时改锁文件 | nightly 首次真跑：Linux/Windows `failed to build app` |
| Windows 检出可能是 **CRLF**：不要用 `/^x = ".*"$/m` 或含 `\n` 的正则，用 `[^"]*` / `\r?\n`，并在脚本里**匹配失败即抛错**、再加 `cargo metadata --locked` 自检 | nightly 第二次真跑：Windows `cannot update the lock file` |
| rustup 只认架构三元组；`universal-apple-darwin` 是 **Tauri 的 bundle 目标**，不能传给 `rustup target add` | nightly 首次真跑：`component 'rust-std' for target 'universal-apple-darwin' is unavailable` |
| 根 `package.json` 有 `pnpm.patchedDependencies` 时，任何只 COPY 清单的 Docker 构建都必须同时 `COPY patches patches` | CI 长期红点：镜像构建 `ENOENT patches/@baicie__xterm@0.1.7.patch` |
| macOS **分芯片架构打包**：矩阵按 `aarch64` / `x86_64` 各出一份二进制 → 各自只打 `.app` → `create-dmg` 出 `macos-aarch64.dmg` / `macos-x86_64.dmg`；`create-dmg` 失败要能回落 | 曾用 lipo 合成 universal（run `40811158213` 验证 `lipo -archs` = `x86_64 arm64`），后按项目决定改为分架构；更新载荷也必须逐架构命名，否则两个架构的 `Termius.app.tar.gz` 会互相覆盖 |
| 更新载荷重命名：tauri 以产品名命名 `*.app.tar.gz`，分架构时必须改成 `Terminal_<version>_macos-<arch>.app.tar.gz` 并连带 `.sig` | 否则后上传的架构会 `--clobber` 掉前一个 |

## 5. 分支与标签卫生

| 规则 | 依据 |
| --- | --- |
| 合并后删除分支：先 `git rev-list --count origin/main..<branch>` 确认 **0** 个未合并提交，再删 | 2026-10-29 清理 4 个分支，全部为 0 |
| `git branch -d` 因 “not merged to upstream” 拒删时，不要直接 `-D`：先用 rev-list 确认，再 `-D` | 本次两个分支就是这种情况 |
| 远程分支用 `git push origin --delete` 删，之后 `git fetch --prune` 清失效引用 | — |
| **tag 是发布锚点，不随分支清理删除**（删了会让对应 Release 变 untagged） | 保留 `v0.0.1-dev.0/1/2` 与 nightly tag |
| 临时 worktree 用完 `git worktree remove` + `git worktree prune` | 本次清理了 2 个排查 nightly 用的 worktree |
| 偶发 `git gc --prune=now`：本次 `.git` 从 22 MB 降到 11 MB，`git fsck` 干净 | — |
| `refs/codex/turn-diffs/**` 是工具内部 checkpoint 引用，不是分支；如需彻底瘦身要先确认工具不再依赖 | 清理后仍存在，未动 |

## 6. 文档与状态用语

| 规则 | 依据 |
| --- | --- |
| 文档里的数字必须与实测一致 | `AGENTS.md` 曾长期写 977/194/146/527，实际是 1149/221+3/205/550 |
| 没跑过的必须标 **NOT_RUN**，不能用编译成功冒充安装/升级验证 | 本次 Windows/Linux 安装启动、卸载重装、SQLite 兼容均为 NOT_RUN |
| 发布状态只用五个值：`RELEASE_VERIFIED` / `RELEASE_QA_ONLY` / `READY_FOR_RELEASE` / `PARTIAL` / `BLOCKED` | 当前为 `RELEASE_QA_ONLY`（无 OS 代码签名/公证） |
