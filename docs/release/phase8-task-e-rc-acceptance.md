# Phase 8.8 Task E - RC 自动化验收记录

> 分支 `feat/phase8-rc-hardening`。本文件只记录**实际发生过**的事情；未执行的项一律标 NOT_RUN，
> 依据 `docs/release/workflow-rules.md` §6「没跑过的必须标 NOT_RUN，不能用编译成功冒充安装/升级验证」。

## 0. 结论速览

| 项 | 自动化实现 | 本次是否执行 | 结论 |
| --- | --- | --- | --- |
| E1 macOS 安装链 | `ci.yml` tauri 作业 + `scripts/verify-install-macos.sh` | 脚本逻辑本地用 **mock DMG** 跑通（正向 1 次 + 反向 2 次）；**真实 DMG 未跑** | **NOT_RUN**（真实产物） |
| E1 Windows 安装链 | `ci.yml` tauri 作业 + `scripts/verify-install-windows.ps1` | 未执行（本机无 pwsh） | **NOT_RUN** |
| E1 Linux 安装链 | `ci.yml` tauri 作业 + `scripts/verify-install-linux.sh` | 未执行（本机非 Linux，无 dpkg/xvfb） | **NOT_RUN** |
| E2 数据库升级兼容 | `scripts/db-schema-upgrade-compat.test.mjs` | **已执行，4/4 通过** | **PASS** |
| E3 证据日志敏感信息审查 | 一次性扫描脚本（不入库） | **已执行**，21 个文件 | **PASS（无需脱敏）** |
| Gatekeeper / SmartScreen(MOTW) / 真实签名公证 | 不可自动化 | — | **NOT_RUN**（见 §2） |

E1 的现状是「自动化已落地、尚未在 runner 上跑过」。要把它变成 PASS，必须 push 后触发 `ci.yml`，
读三个 tauri 作业的日志；在那之前任何「安装链已验证」的说法都不成立。

## 1. E1 改了什么（`.github/workflows/ci.yml` 的 `tauri` 作业）

### 1.1 先修正一个前提

任务书的假设是「三个 Tauri build 作业本来就会产出安装包」。实际不是：
`ci.yml` 里那三个矩阵作业原本最后一步是 `pnpm tauri build --no-bundle --ci -- --locked`，
**`--no-bundle` 不产出任何安装包**。所以直接挂验证步骤会找不到产物。

修正方式（保持既有编译门禁不变，不引入第二次 Rust 编译）：

| 新增步骤 | 条件 | 命令 |
| --- | --- | --- |
| Bundle installer (macOS DMG + .app) | `runner.os == 'macOS'` | `pnpm tauri bundle --bundles app` → `pnpm tauri bundle --bundles dmg`（首次失败重试 1 次，最多 2 次） |
| Bundle installer (Windows NSIS) | `runner.os == 'Windows'` | `pnpm tauri bundle --bundles nsis` |
| Bundle installer (Linux deb + AppImage) | `runner.os == 'Linux'` | `pnpm tauri bundle --bundles deb,appimage` |
| Install Xvfb for the Linux launch check | `runner.os == 'Linux'` | `sudo apt-get install -y --no-install-recommends xvfb` |
| Verify install chain (macOS DMG) | `runner.os == 'macOS'` | `bash scripts/verify-install-macos.sh` |
| Verify install chain (Windows NSIS) | `runner.os == 'Windows'` | `./scripts/verify-install-windows.ps1`（`shell: pwsh`） |
| Verify install chain (Linux deb + AppImage) | `runner.os == 'Linux'` | `bash scripts/verify-install-linux.sh` |

用 `tauri bundle` 而不是再跑一次 `tauri build`：`bundle` 复用 `--no-bundle` 已产出的 release 二进制，
不重复编译，也不需要重复跑前端构建。这也是 `release.yml` 已经在用的调用方式（`release.yml:332`、`:384`）。

**为什么没有新建独立 workflow**：GitHub 只注册默认分支上的 workflow 文件，新建的 `*.yml` 在本分支上用
`workflow_dispatch` 触发会 404（上一轮已实测）。因此只能挂在 `ci.yml` 现有作业里，且未触碰 `main`
与 `release.yml` 的发布行为。

### 1.2 各平台断言与失败行为

三个脚本统一约定：断言失败 → 打印 `[FAIL] 原因` 并 `exit 1` → **作业红灯**；无法在该环境执行的检查打印
`[SKIPPED] 原因`；无法自动化的项打印 `[NOT_RUN] 原因`。没有任何 `|| true` 吞掉断言（唯一标记为
cleanup only 的几处是资源清理，即使失败也不会改变断言结论）。

**macOS（`scripts/verify-install-macos.sh`）**
1. `bundle/dmg` 目录存在、DMG 存在、大小 > 1 MiB —— 打印文件名与字节数
2. `hdiutil attach -nobrowse -readonly` 挂载成功
3. DMG 内 `.app` 复制到临时 Applications 目录
4. `CFBundleIdentifier` 必须等于 `com.baicie.termius`（身份漂移即失败）
5. 直接执行 `Contents/MacOS/` 下的二进制，5 秒后 `kill -0` 仍存活，否则失败并打印日志尾 20 行
6. 覆盖安装：`ditto` 把同一 `.app` 覆盖到已安装位置 → 仍存在、标识符不变、再次启动 5 秒存活
7. 数据保留：仅在「本次运行之前 `~/Library/Application Support/com.baicie.termius` 不存在、运行后出现」时
   才声称「创建」；覆盖安装后断言该目录仍在；若运行前已存在则打印 `[SKIPPED]`（不冒充）
8. `hdiutil detach` 卸载

**Windows（`scripts/verify-install-windows.ps1`）**
1. `bundle/nsis` 下的 `*setup.exe` 存在、大小 > 1 MB；从 `tauri.conf.json` 读 `productName`/`identifier`
2. `Start-Process <setup.exe> /S -Wait` 静默安装；轮询 ≤120s 等 `%LOCALAPPDATA%\<productName>\<productName>.exe` 出现
3. 卸载注册表项：在 HKCU/HKLM（含 WOW6432Node）Uninstall 键里按 `DisplayName` 匹配，必须找到；
   打印 `DisplayName`/`DisplayVersion`/键路径（找不到即失败）
4. 启动 exe，5 秒后 `$proc.HasExited` 必须为 false（否则失败并带退出码）
5. 数据目录 `%APPDATA%\<identifier>`：仅在「运行前不存在、运行后出现」时才声称创建
6. 覆盖安装：再跑一次 `/S`，exe 仍在、再启动 5 秒存活、数据目录仍在
7. 卸载：跑 `uninstall.exe /S`，轮询 ≤180s 直到安装目录消失，否则失败

**Linux（`scripts/verify-install-linux.sh`）**
1. `bundle/deb` 下的 `.deb` 存在、大小 > 1 MiB；`dpkg-deb -f` 打印 Package/Version/Architecture/Depends
2. 用 `dpkg-deb -x` 解包（任务书允许，避免 `dpkg -i` 把整条 WebKitGTK 依赖链拖进断言）→ `/usr/bin` 下有可执行文件
3. `ldd` 不得出现 `not found`（真正验证「缺运行时依赖」这件事，而不是假装通过）
4. `xvfb-run` 启动该二进制，5 秒后 `pgrep -f <绝对路径>` 必须命中（用绝对路径匹配，避免匹配到 Xvfb 壳进程）
5. 覆盖安装：把同一个 `.deb` 再解包覆盖到同一目录 → 二进制仍在、再次存活 5 秒、`~/.local/share/<identifier>` 仍在
6. `.AppImage`：`chmod +x` 后先直跑（FUSE 挂载）；失败则在**同一检查内**重试一次
   `--appimage-extract-and-run`，并把实际使用的模式写进日志（`mode=direct` / `mode=extract-and-run`）；
   两种模式都失败 → 作业红灯

### 1.3 本地能够验证到的部分（真实执行，非推测）

- `bash -n` 两个脚本：通过；`shellcheck`：0 报警；`actionlint .github/workflows/ci.yml`：0 报警（含新步骤）
- macOS 脚本在一个**手工构造的 mock DMG**（内含标识符为 `com.baicie.termius` 的 `Termius.app`、
  `Contents/MacOS/Termius` 为 `sleep 30` 的脚本）上跑完整流程：全部 `[PASS]`，退出码 0；
  覆盖安装、卸载、临时目录清理均正常工作
- 反向验证（证明断言不是空转）：
  - 篡改 `CFBundleIdentifier` 为 `com.example.renamed` → `[FAIL] CFBundleIdentifier=com.example.renamed, expected com.baicie.termius`，`exit=1`
  - 把可执行内容改成 `exit 1`（启动即退出）→ `[FAIL] first launch: process exited within 5s`，`exit=1`
  - 缺 `bundle/dmg` 目录 → `[FAIL] bundle directory missing …`，`exit=1`
- **这一轮 mock 跑出一个真实缺陷并已修**：最初的「app 数据目录」判断只检查目录是否存在，而本机早已存在该目录，
  于是把「本次启动创建的」误报成 PASS。现改为比较启动前后的状态，运行前已存在时打印 `[SKIPPED]`。

### 1.4 仍未验证的部分（不要当成通过）

- 真实 DMG（`tauri bundle` 在 macOS runner 上的产物）从未挂载过 —— NOT_RUN
- `verify-install-windows.ps1` 从未被执行：本机没有 pwsh，PowerShell 语法也没有经过解析器校验 —— NOT_RUN
- `verify-install-linux.sh` 从未执行：本机不是 Linux —— NOT_RUN
- `create-dmg` 在 runner 上偶发失败（`release.yml` 就是因为这个才写了重试与回落），这里只做了重试 1 次、
  没有做回落；若两次都失败，作业会红灯 —— 这是有意选择（宁可红，也不要静默降级）

## 2. 无法自动化、必须标 NOT_RUN 的项

| 项 | 为什么不能自动化 | 标记 |
| --- | --- | --- |
| macOS Gatekeeper「无法验证开发者」弹窗 | 需要真人在 GUI 安全对话框上点击「仍要打开」；runner 上无人可点，脚本既不能点也不能断言，强 dismiss 等于伪造结论 | NOT_RUN |
| Windows SmartScreen / Mark-of-the-Web 拦截 | MOTW 由「从网络下载」这一事实触发，CI 本地构建的 exe 不带 MOTW；且拦截页是人工决策的 GUI | NOT_RUN |
| 真实代码签名（Developer ID / Authenticode）与公证 | CI 无证书；ad-hoc 签名不等于 Developer ID，也不构成公证（见 `workflow-rules.md` §3） | NOT_RUN |
| 桌面环境的安装体验（.desktop 菜单项、文件关联） | runner 无桌面会话可观察 | NOT_RUN |
| 覆盖安装后的**数据保留** | 有条件自动化：仅当应用在 5 秒内真的写出了配置目录才断言；否则 `[SKIPPED]` 并写明原因 | 条件执行 |

## 3. E2 数据库升级兼容性

### 3.1 选择

迁移这一层在**前端 TypeScript**（`packages/frontend/src/service/database/connection-schema-core.ts`），
Rust 侧没有等价迁移实现。因此不在 Rust 侧另写一份「拷贝出来的 schema」去测（那样测不到真实代码），
而是用 **Node 测试直接驱动真实迁移函数 + 真实 SQLite 文件**：

- `scripts/db-schema-upgrade-compat.test.mjs`（`node:test` + `node:sqlite` 的 `DatabaseSync`，全部落在 `mkdtemp` 的真实文件上，**没有任何 mock**）
- 直接 `import` 真实的 `initializeCoreSchema` / `initializeTeamSchema`，走的是应用启动时同一条代码路径
- 放在 `scripts/` 而不是 `packages/frontend/src/` 是刻意的：`packages/frontend/src` 在
  `FINGERPRINT_PATHS` 里，新增一个文件就会让 `docs/verification` 里仍有效的证据失效（`workflow-rules.md` §1）
- 加入既有 CI 门禁 `node --test scripts/*.test.mjs`（`ci.yml` 的 `source-size` 作业），无需改 vitest 配置

### 3.2 用例（4 个，全部通过）

| # | 测试名 | 覆盖 |
| --- | --- | --- |
| 1 | `upgrade snapshot: VACUUM INTO backup reopens with identical row counts` | 升级前快照：`VACUUM INTO` 备份文件非空、可打开、`integrity_check=ok`、hosts/connection_logs/settings/teams 行数与主库一致、抽查字段值一致 |
| 2 | `legacy database: current migrations keep every row and backfill defaults` | 旧库升级：按「当前 schema 减去增量 ALTER 列」建库并插数据 → 跑当前迁移（连跑两次验证幂等）→ 行内容与升级前逐字段相同、`agent_forwarding=0`/`shell_integration='off'`/`certificate, jump_host_id, jump_host_auth_type, error_message, error_raw` 为 NULL、新表（scripts/script_executions/workspaces/workspace_layouts/ssh_keys）已建、旧式 INSERT 仍可用 |
| 3 | `old client on the new schema: legacy SELECT/INSERT stay valid and do not corrupt` | 新库被旧客户端打开：旧列清单的 SELECT、`SELECT *`、旧式 INSERT/UPDATE 全部不报错；新列拿到默认值；`integrity_check=ok`、`PRAGMA foreign_key_check` 为空；随后新客户端再启动迁移不报错、行数正确 —— **纯增量结论成立，无回归** |
| 4 | `failure recovery: an aborted migration leaves the original database readable` | 失败恢复：在 `idx_connection_logs_started_at`（位于迁移的重复列 try/catch 之外）注入失败 → 迁移抛出、数据库重开可读、行数与内容仍在、`integrity_check=ok`；再完整重跑一次迁移可收敛 |

### 3.3 实际输出（本机 Node v22.12.0，`node --experimental-strip-types --experimental-sqlite --test scripts/db-schema-upgrade-compat.test.mjs`）

```
ok 1 - Phase 8.8 E2 - database upgrade compatibility (real SQLite files)
    ok 1 - upgrade snapshot: VACUUM INTO backup reopens with identical row counts
    ok 2 - legacy database: current migrations keep every row and backfill defaults
    ok 3 - old client on the new schema: legacy SELECT/INSERT stay valid and do not corrupt
    ok 4 - failure recovery: an aborted migration leaves the original database readable
# tests 4
# pass 4
# fail 0
```

### 3.4 顺带发现（未擅自改动）

`connection-schema-core.ts:44` 的 `catch {` 会吞掉**所有** ALTER 失败，而不只是「列已存在」：
磁盘满、权限错误、SQLITE_BUSY 这类真实故障同样被静默忽略，之后的 `slice(15)` 语句照跑。
建议后续把捕获收窄为只忽略 duplicate column 一类错误。本轮不改（不在 Task E 的验收范围内，
且该文件在指纹路径内）。

## 4. E3 证据日志敏感信息审查

范围：`docs/verification/raw/` 全部 21 个文件（3 个 run 目录 × 7 份，其中 `41077965521` 为 `.gz`，
已逐个解压后扫描，不是只看压缩字节）。**未删除、未修改任何文件。**

| 检查项 | 命中 | 位置（示例） | 判定 |
| --- | --- | --- | --- |
| 绝对路径（macOS 家目录） | 69 处 / 15 文件 | `raw/41077965521/debug-local-cold-start.log.gz:2`、`raw/41112206442/release-ssh-matrix.log` 等，值恒为 `/Users/runner` | CI 托管 runner 的临时账户，非个人身份 |
| 绝对路径（Linux 家目录） | 9 处 / 3 文件 | `raw/41112206442/debug-remote-cold-start.log:16` = `/home/REMOTE_COLD_MARKER`、`/home/REMOTE_PROMPT_MARKER` | 测试夹具标记，不是真实用户 |
| 用户/host 身份 | 769 处 | 形如 `runner@127.0.0.1:` 的 shell 提示符 | 仅 `runner`；无本机用户名、无 `fv-az…` 真实 hostname |
| IPv4 | 772 处 / 12 文件 | 全部为 `127.0.0.1` | 回环地址，无内网/公网 IP |
| token / 密钥 / 密码 | 0 | — | 无 `ghp_/_…`、无 `AKIA…`、无 `-----BEGIN … PRIVATE KEY-----`、无 `ssh-rsa/ed25519 AAAA…`、`password`/`Bearer`/`Authorization` 均 0 次 |
| CI 环境变量值 | 0 | — | 无 `ACTIONS_RUNTIME_TOKEN`/`GITHUB_TOKEN`/`RUNNER_TEMP` 等名字或其值 |
| MAC 地址 / 硬件序列号 | 0 | — | — |
| 本机用户名 `liuzhiwei` / `MacBook` | 0 | — | — |

结论：**未发现需要脱敏的敏感信息**，不建议改动这 21 个文件，也不建议删除任何一份。
唯一可讨论的是 `/Users/runner` 与 `runner@…` 这类 CI 账户痕迹——它与本仓库公开的 `ci.yml`、
`real-machine-matrix.yml` 完全一致，不构成信息泄露。
若未来某次采集把真实用户名写进日志，建议的方向是**在写入端**（`scripts/build-verification-evidence.mjs`）
做 redaction 并保留原始日志不动，而不是事后删改原始证据。

## 5. 与本次改动无关、但必须上报的既有问题

`node scripts/check-verification-evidence.mjs` 在**本次改动之前**就已经是红的：`exit=1`，
`Verification evidence gate failed: 7 problem(s)`，涉及
`2026-10-11-macos-cold-start-current.json`、`…-ssh-matrix-current.json`、`…-shell-interaction-current.json`
（3 份 current 证据）、`…-remote-shell-prompt-rerun.json`、`…-release-ssh-matrix.json`、
`…-release-terminal-gate.json` 与 `evidence-manifest.json`，原因是源码指纹已是 `98f87e1a…`
而记录里是 `a6cd9881…`。

这也是本轮把 E2 测试放在 `scripts/` 而不是 `packages/frontend/src/` 的原因：后者会再改一次指纹，
把现在还绿的 3 份 current 证据也一起弄红。修复它需要重采一轮 macOS 证据（跑 `real-machine-matrix.yml`
→ 下载 → 过门禁），不在 Task E 范围内。

## 6. 本轮改动清单

| 文件 | 性质 |
| --- | --- |
| `.github/workflows/ci.yml` | 修改：`tauri` 作业新增 7 个步骤（4 个打包/环境 + 3 个安装链验证） |
| `scripts/verify-install-macos.sh` | 新增 |
| `scripts/verify-install-windows.ps1` | 新增 |
| `scripts/verify-install-linux.sh` | 新增 |
| `scripts/db-schema-upgrade-compat.test.mjs` | 新增 |
| `docs/release/phase8-task-e-rc-acceptance.md` | 新增（本文件） |

未触碰：`release.yml`、`main`、`docs/verification/` 下任何既有文件、任何 `|| true` 式吞失败。

## 7. Phase 8.9 Task 5 - 三平台真实数据保留验收（2026-10-31 追加）

Phase 8.8 的三个脚本只验证"目录存在 / 部分 sha256 不变"。这一节记录把它们升级为**内容级断言**之后的状态。

### 7.1 共同机制：一个跨平台断言器

新增 `scripts/verify-install/data-retention.mjs`（Node 内建 `node:sqlite`，因此三个平台都不依赖 sqlite3 CLI；
Node 24 免 flag，Node 22.5+ 自动改用 `--experimental-sqlite`，两者都不可用时脚本直接 fail，不允许在无数据证据的情况下报 pass）。
子命令：`integrity` / `schema` / `seed` / `snapshot` / `verify` / `wait` / `digest` / `test-break`（后者需
`VERIFY_INSTALL_TEST_MUTATION=1`，仅供反向验证）。

写入的受控数据（全部无真实凭证）：

| 对象 | 内容 | 断言方式 |
| --- | --- | --- |
| 主机记录 | `hosts` 一行：`phase89.invalid:2222`、`auth_type=agent`、`password`/`private_key` 为 NULL、固定时间戳 | 22 个字段逐字段比较 + 两个凭证列必须仍为 NULL |
| 应用设置 | `settings.key='app_settings'` 的 JSON：theme/language/fontSize/terminalTheme/scrollback + 每次运行唯一的 `phase89Marker` | 7 个字段逐字段比较 + marker 保留 |
| 工作区配置 | `workspaces` 一行（`"order"=7`、`is_active=1`）+ `workspace_layouts.layout_data` JSON | 7 个字段 + layout 仍为合法 JSON 且 marker / `sidebarVisible` 保留 |
| 测试 Vault | `dirs::config_dir()/terminal/vault.json`，格式合法的空库（salt + `entries:{}`） | 文件仍在、仍可解析、salt 逐字节相同、条目数仍为 0；文件哈希仅作记录 |

**为什么不是"看哈希没变"**：`app_settings` 里预置 `terminalThemeLightMigrated=false` 与旧默认
`terminalThemeLight=solarized-light`。应用启动时 `store/app.ts hydrateFromDatabase` → `getAppSettings`
会读这一行并把 `terminalThemeLightMigrated` 写回 `true`（实测同时把 `solarized-light` 改写为
`github-light`）。因此"应用真的读过我们写的数据"是一个**内容相关副作用**，被 `verify --expect-app-write`
硬断言；应用没启动或没读到这一行时该断言必然失败（已用反向实验证明）。同时 `workspaces` 条数必须不变——
应用在 `workspaces` 为空时会自建 Default 工作区，条数不变说明它读到了我们那一行而不是重建。

### 7.2 数据目录隔离（测出来的，不是假设的）

| 平台 | 隔离手段 | 实测结论 |
| --- | --- | --- |
| macOS | `HOME` 指向临时目录（应用用 `tauri app_config_dir` → `dirs::config_dir()`） | **有效**：数据库出现在 `$HOME/Library/Application Support/com.baicie.termius/terminal.db`，且 runner 真实 HOME 下同名文件 sha256 保持不变（脚本把"泄漏到真实 HOME"做成硬断言） |
| Linux | `XDG_CONFIG_HOME/XDG_DATA_HOME/XDG_CACHE_HOME/HOME` 全部指向临时目录 | 依据 `dirs-sys` 源码（`XDG_CONFIG_HOME` 绝对路径优先）+ 脚本断言：数据库必须落在 `$XDG_CONFIG_HOME/com.baicie.termius/terminal.db`，并且 `$HOME/.config`、`$HOME/.local/share` 下不得出现副本 |
| Windows | 先重定向 `APPDATA`/`LOCALAPPDATA` 到临时目录，再**测量**是否被采纳 | 预期不被采纳：Tauri 用 `dirs::config_dir()` → `SHGetKnownFolderPath(FOLDERID_RoamingAppData)`，**不读** `%APPDATA%`。脚本据此分两支：采纳了就 PASS；没采纳就打印 `[LIMITATION]` 说明原因，并在"干净起步"前提下改用真实每用户目录继续验证——限制被记录，不会伪装成隔离成功 |

另外发现并记录的一个事实：Vault 并**不在** identifier 目录下，而是
`dirs::config_dir()/terminal/vault.json`（`src-tauri/src/vault.rs` 的 `get_vault_path`）。三个脚本都按两个路径分别断言。

### 7.3 本机能跑的部分（真实执行）

macOS 用本机打包出的真实 DMG 全流程跑通（`pnpm tauri bundle --bundles dmg` → `bash scripts/verify-install-macos.sh`）：

- 正向：**102 PASS / 0 FAIL / 4 NOT_RUN**，exit 0。关键行包括
  `first launch initialised the database 5s after launch`、
  `the app read the seeded row and persisted terminalThemeLightMigrated=true (content-dependent read proof)`、
  `nothing was written to the runner's own HOME`、`overwrite install kept ... a byte-identical executable`。
- 反向（`VERIFY_INSTALL_FAULT_INJECT=delete-host`，故意在快照之后删掉主机行）：exit **1**，输出
  `[FAIL] hosts: the row is gone after the install/relaunch cycle`。
- 断言器反向（直接篡改 SQLite）：改 `port`/`username` 与删 layout 行 → exit 1，报出
  `[FAIL] hosts.port == 1 (expected 2222)` / `[FAIL] hosts.username == "x"` / `[FAIL] workspace_layouts: the layout row is gone`；
  未篡改时同一份数据 exit 0。
- 静态门禁：`bash -n`、`shellcheck -x`、`node --check`、`actionlint` 全部 exit 0。

Linux / Windows 脚本本机**未执行**（本机为 macOS，无 dpkg/Xvfb、无 pwsh）：Linux 只过 `bash -n` + `shellcheck`，
Windows 只做了括号/引用结构与人工复核，本机 **NOT_RUN**（不要在报告里当成通过）。

### 7.4 仍然 NOT_RUN 的项（逐条原因）

- Gatekeeper / SmartScreen / Authenticode / 公证：需要人工点击的 GUI 安全决策与签名身份，CI 无法触发或观察。
- 真实 UI 读回（打开主机列表看到那条记录）：需要 GUI 自动化栈；可自动化的替代证据是"应用启动写回 + 逐字段 SQL 读回"。
- Vault 加密往返（建库/解锁/读条目）：需要交互式主密码，且会写入凭证；加密正确性由 `src-tauri vault_tests` 在 rust 作业覆盖，这里只断言文件持久性。
- Linux 桌面会话里的菜单集成：runner 无桌面环境与会话总线；`.desktop` 只能做结构断言（Type/Name/Icon/Exec 指向包内二进制，`desktop-file-validate` 可用时再校验一次）。
- Windows 跨版本升级（vN→vN+1）：CI 只构建一个版本；同版本覆盖安装的 NSIS 路径已验证，跨版本需要两个 release 安装包。

### 7.5 本节改动的文件

| 文件 | 性质 |
| --- | --- |
| `scripts/verify-install/data-retention.mjs` | 新增（跨平台断言器） |
| `scripts/verify-install-macos.sh` | 重写为"隔离 HOME + 写入 + 覆盖安装 + 逐字段读回" |
| `scripts/verify-install-linux.sh` | 重写：新增真实 `dpkg` 安装、`.desktop` 断言、包移除后数据保留、AppImage 独立数据周期 |
| `scripts/verify-install-windows.ps1` | 重写：新增数据目录测量、覆盖安装后逐字段读回、卸载后的用户数据策略断言（对照 `deleteAppDataOnUninstall` 配置） |
| `.github/workflows/ci.yml` | 修改：步骤改名、新增 `x11-utils`/`desktop-file-utils`、新增证据 artifact 上传（`if: always()`） |
| `.gitignore` | 修改：忽略 `verify-install-evidence/` |

