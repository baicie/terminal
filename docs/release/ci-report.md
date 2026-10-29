# CI 测试报告（P6/P7）

> 生成时间：2026-10-29
> 分支 `codex/terminal-reliability-matrix`，提交 `18012ab`（CI 改造所在提交）
> 原则：跑过的写 PASS，没跑过的写 NOT_RUN，不把编译成功当成安装验证。

## 1. 真实 CI 运行（GitHub hosted runners）

**Run `40808864624`（CI）→ `completed / success`，8 个 job 全绿。**

| Job | 结果 | 说明 |
| --- | --- | --- |
| Frontend quality | ✅ success | lint / typecheck / vitest / build:budget |
| Team Server quality | ✅ success | prisma validate+generate / typecheck / lint / test / build + PostgreSQL 迁移 |
| Production source-size gate | ✅ success | 550 个生产文件行数门禁 |
| Rust quality | ✅ success | fmt --check / check / clippy -D warnings / test |
| **Team Server container** | ✅ **success** | **修复前一直 failure**；本次 `COPY patches patches` 后通过（真实 Docker Build） |
| Tauri build (macos-latest) | ✅ success | `tauri build --no-bundle --ci` |
| Tauri build (ubuntu-latest) | ✅ success | 同上 |
| Tauri build (windows-latest) | ✅ success | 同上 |

上一次运行（`40798218743`）为 failure，唯一失败 job 就是 `Team Server container`；本次已消除。

## 2. 本地可执行的验证

| 检查 | 方法 | 结果 |
| --- | --- | --- |
| workflow 语法 + 表达式 + shellcheck | `actionlint 1.7.12`（含 `shellcheck 0.11.0` 集成）对 4 个 workflow 全量扫描 | ✅ PASS，0 problems |
| workflow 结构 | `yaml.safe_load` 解析 release.yml：5 个 job、`release_mode`/`tag` 两个输入、verify 三步 | ✅ PASS |
| 全量质量门禁 | `pnpm verify`（本机 Node 24.16.0） | ✅ PASS，退出码 0（前端 1144 / Team Server 103 / Rust 221+3 / 脚本 205 / 550 文件 / bundle budget / evidence gate） |
| nightly 版本派生逻辑 | 在临时副本上执行 nightly 的版本改写脚本 | ✅ PASS：`package.json`、`tauri.conf.json`、`Cargo.toml` 三处同时变为 `0.0.1-nightly.20261029.abc123def456` |
| nightly `plan` 判定逻辑 | 本地执行同一段 bash（真实 `gh release list`） | ✅ PASS：无既有 nightly 时 `needed=true`，版本 `0.0.1-nightly.20261029.18012ab5c497`，tag 与 SHA 一致 |
| macOS DMG 生成 | `create-dmg` 用真实 `Termius.app` 运行 workflow 里的同一条命令 | ✅ PASS：产出 12,038,232 字节 DMG，挂载后含 `Termius.app` 与 `Applications` 软链 |
| macOS `.app` 打包 | `VITE_TERMINAL_SMOKE_BUILD=` 未设置时 `tauri build --no-bundle` | ✅ PASS：`Termius.app`（29 MB）内嵌前端，runner 判别 `chunks=0`（确认非插桩包） |
| 本地 Docker 复现 | `docker build -f packages/team-server/Dockerfile .` | ⚠️ **本地未通过**：`pnpm install` 阶段出现 `ECONNRESET`（registry.npmjs.org 大流量拉取在本机网络下被重置）。**注意这已不是 patches 问题**——修复前该步骤在解析依赖前就 `ENOENT` 立刻退出；现在能进到下载阶段。该镜像构建的正确性由 CI run `40808864624` 的 success 证明 |

## 3. 未运行（NOT_RUN）及原因

| 项目 | 状态 | 原因 |
| --- | --- | --- |
| `release.yml` 端到端 | **NOT_RUN** | 需要打 tag 或 `workflow_dispatch`，会创建公开 Release；任务明确要求「未经授权不创建正式公开 Release」，未执行 |
| `nightly.yml` 端到端 | **NOT_RUN** | 定时任务针对 `main`；手动触发会真的创建一个 nightly prerelease，同样属于未经授权的公开产物 |
| `updater-signed` 模式 | **NOT_RUN** | 仓库没有 `TAURI_SIGNING_PRIVATE_KEY`；按规则「缺少私钥立即失败，不得临时生成并假装已配置」，未伪造密钥 |
| `fully-signed` 模式 | **NOT_RUN** | 本阶段不购买 Apple/Windows 证书，该模式设计为命中即失败 |
| Windows 安装/启动、Linux AppImage 启动、卸载重装 | **NOT_RUN** | 本机是 macOS，且这些需要真实安装动作；CI 里只有编译产物，不代表安装通过 |
| SQLite 首次初始化/旧数据兼容/用户数据目录不被覆盖 | **NOT_RUN** | 需要在真机安装后运行应用并操作数据库；本轮未做（不虚构结论） |

## 4. 结论

- **可自动化的门禁已真实变绿**：8/8 job success，其中包含此前长期失败的镜像构建。
- **发布链路已具备结构、模式与门禁**，但 `Release` / `Nightly` 两条链路尚未真正跑过一次，属于「实现完成、执行未验证」。
- **Updater 只有产物侧**：仓库还没有 `tauri-plugin-updater`，所以即使产出 `.sig` 与 `latest.json`，应用也不会自动更新；这一点在 `docs/release/release-modes.md` 与 `signing-keys.md` 中已写明。

**最终状态：`PARTIAL`**

- unsigned-qa 通道：代码与门禁齐备，CI 全绿 → 只差一次授权触发的 tag 运行即可升为 `READY_FOR_RELEASE`；
- updater-signed 通道：实现完成但缺密钥，未验证；
- fully-signed：按设计不启用。
