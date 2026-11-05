# Phase 9.5 — Real Release Upgrade Matrix

> 日期：2026-11-05
> 资产来源：GitHub Releases `v0.0.1-dev.1`、`v0.0.1-dev.2`
> 所有 SHA256 均由本机重新计算并与 Release digest / `SHA256SUMS.txt` 对照。

## 1. 已核验的真实资产

| 版本 | 平台/架构 | 资产 | 大小 | SHA256 | 核验 |
| --- | --- | --- | --- | --- | --- |
| `0.0.1-dev.1` | macOS arm64 | `Terminal_0.0.1-dev.1_macos-aarch64.dmg` | 11,298,182 | `73cf7483…` | PASS |
| `0.0.1-dev.2` | macOS arm64 | `Terminal_0.0.1-dev.2_macos-aarch64.dmg` | 12,035,266 | `2c9a0ca3…` | PASS |
| `0.0.1-dev.1` | Linux x64/arm64 | `.deb` / `.AppImage` | — | `4ed449bf…` / `8fdef570…` | 资产存在；适配器 NOT_RUN |
| `0.0.1-dev.2` | Linux x64/arm64 | `.deb` / `.AppImage` | — | `80c40e72…` / `0641b59f…` | 资产存在；适配器 NOT_RUN |
| `0.0.1-dev.1` | Windows x64/arm64 | `-setup.exe` | — | `be51f04a…` / `ce59349e…` | 资产存在；适配器 NOT_RUN |
| `0.0.1-dev.2` | Windows x64/arm64 | `-setup.exe` | — | `e068a8ae…` / `178ff483…` | 资产存在；适配器 NOT_RUN |

macOS 资产元数据（`asset-metadata.mjs` 直接读 DMG，不依赖文件名）：

| 项 | dev.1 | dev.2 |
| --- | --- | --- |
| CFBundleIdentifier | `com.baicie.termius` | `com.baicie.termius` |
| CFBundleShortVersionString | `0.0.1-dev.1` | `0.0.1-dev.2` |
| 可执行文件 | `terminal` | `terminal` |
| 架构 | `arm64` | `arm64` |
| hosts 表新增列 | — | `agent_forwarding`、`shell_integration` |
| Team 本地表 | teams / team_members / team_shared_hosts / sync_queue / user_profile | 同左 |
| updater 资产 | 无 | `.app.tar.gz` + `.sig`、`latest.json` |

## 2. 兼容性结论

- 两个历史版本的 **identifier 相同**、**架构相同**、**schema 为加法迁移**：
  dev.1 的 hosts 表缺 `agent_forwarding`/`shell_integration`，dev.2 启动时补列。
- dev.1 没有 updater 资产；dev.2 有 updater `.app.tar.gz`/`.sig` 与 `latest.json`，
  但 `tauri.conf.json` 的 `pubkey` 仍是占位符，运行时更新链未验证。
- dev.1 的前端 schema 代码使用 `catch {}` 吞掉所有 ALTER 错误，dev.2 只忽略
  duplicate-column；当前产品（Phase 9.4.2）还要求迁移前 `VACUUM INTO` 备份。
  因此 **dev.2 作为 B 时没有 pre-migration 备份**，报告标 `NOT_RUN`，不伪造。
- 两个版本之间没有自动回滚/降级契约；B→A 未验证。`backup` 能力只在当前产品
  的 B 中存在。

## 3. 资产获取命令

```bash
gh release download v0.0.1-dev.1 \
  -p 'Terminal_0.0.1-dev.1_macos-aarch64.dmg' -p 'SHA256SUMS.txt' -D assets/dev1
gh release download v0.0.1-dev.2 \
  -p 'Terminal_0.0.1-dev.2_macos-aarch64.dmg' -p 'SHA256SUMS.txt' -D assets/dev2
(cd assets/dev1 && grep 'macos-aarch64.dmg' SHA256SUMS.txt > expected.txt && shasum -a 256 -c expected.txt)
(cd assets/dev2 && grep 'macos-aarch64.dmg' SHA256SUMS.txt > expected.txt && shasum -a 256 -c expected.txt)
```

## 4. 不能假设的事

- 不能假设 `Terminal_*.dmg` 文件名等于真实版本；harness 读 DMG 内 `Info.plist`。
- 不能假设当前源码构建的 DMG 与已发布 dev.2 字节相同；本机 dev.2 构建的 SHA
  为 `eb167acc…`，与发布资产 `2c9a0ca3…` 不同，因此本轮使用**发布资产**。
- 不能假设 dev.2 具备当前产品的迁移备份能力；它没有。
- 不能用 Linux 脚本的 `[SKIPPED]`/解包回退把“没有真正安装”写成升级通过。
- Windows 的 `%APPDATA%` 不是隔离目录；禁止在真实用户 profile 上运行升级/故障
  测试，必须使用一次性 profile 或 VM。

## 5. 判定

| 项 | 结果 |
| --- | --- |
| 历史资产可下载且 digest 匹配 | **YES**（macOS dev.1/dev.2；Linux/Windows 资产存在但未执行） |
| dev.1 → dev.2 schema 兼容 | **YES**（加法迁移；E2E 见 `upgrade-e2e.md`） |
| 跨版本升级已验证 | **PARTIAL**（macOS 真实发布资产；Linux/Windows NOT_RUN） |
| 回滚 / 降级 | **NOT_RUN** |
