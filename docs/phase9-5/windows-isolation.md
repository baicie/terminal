# Phase 9.5.1 — Windows Profile Isolation

> **Phase 9.5.2 更新**：本文的路径级 `targetIsRealRoaming` 模型已被
> `docs/phase9-5/windows-profile-e2e.md` 的身份+路径+owner+cleanup 状态机取代；
> 旧脚本的 `isolated=true` 不可达，旧 CI 的 success 只证明“总是拒绝”。

> 日期：2026-11-05
> 脚本：`scripts/verify-install/windows-isolation-check.ps1`
> 工作流：`.github/workflows/upgrade-e2e.yml` 的 `windows-isolation-preflight`
> 判定：`WINDOWS_PROFILE_ISOLATION_VERIFIED = PARTIAL`、`WINDOWS_UPGRADE_E2E = NOT_RUN`

## 1. 为什么不能在共享 runner 上装

Tauri 通过 Windows Known Folder API（`SHGetKnownFolderPath(FOLDERID_RoamingAppData)`）
解析应用数据目录。只改 `%APPDATA%` 环境变量不会改变这个路径；在 GitHub 的共享
Windows runner 上，它仍然是 `C:\Users\runneradmin\AppData\Roaming`。旧安装脚本
会清理 `%APPDATA%\Termius`，在共享 profile 上等于删除 runner 的真实用户目录。
因此本轮不安装、不删除、不写入该目录。

## 2. 预检脚本做什么

`windows-isolation-check.ps1` 是**只读**预检：

1. 读取当前身份与 SID、Known Folder Roaming/Local、`APPDATA`/`LOCALAPPDATA`、
   `UserProfile`。
2. 解析目标目录
   `<KnownFolderRoaming>\com.baicie.termius`。
3. 若设置了 `UPGRADE_TEST_ROOT`，判断目标是否严格位于该目录之下。
4. 判断目标是否位于真实 Roaming 之下（`targetIsRealRoaming`）。
5. 读取 `HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall` 中
   `Termius`/`Terminal` 条目，仅记录，不修改。
6. 输出 JSON；`isolated=false` 或 `wouldTouchRealProfile=true` 时以退出码 1
   fail-closed。

工作流包装步骤在确认“拒绝安装”是预期结果后显式 `exit 0`，因此这个 job 的
success 表示**预检正确地拒绝了共享 profile**，不表示 Windows 升级已执行。

## 3. 真实 runner 结果

| 项 | 值 |
| --- | --- |
| run | `41972602296`（`6ffebb1`）；最终脚本 run `41980039459` 也 success |
| job | `Windows profile isolation preflight` — **success** |
| user | `runnervmhao91\runneradmin` |
| SID | `S-1-5-21-3077485881-3661871218-4154919024-500` |
| Known Folder Roaming | `C:\Users\runneradmin\AppData\Roaming` |
| target | `C:\Users\runneradmin\AppData\Roaming\com.baicie.termius` |
| `targetIsRealRoaming` | `true` |
| `targetUnderTestRoot` | `false` |
| `wouldTouchRealProfile` | `true` |
| `isolated` | `false` |
| 现有卸载项 | `[]` |
| 动作 | read-only preflight; no install, delete, or profile write |
| 证据 | `windows-isolation-report` artifact；本地归档见 `docs/phase9-5/evidence/` |

脚本在共享 runner 上返回退出码 1，包装步骤验证 JSON 后成功结束；没有任何
安装或删除动作。

## 4. 这台 runner 不能证明什么

- **没有 Windows 升级 E2E**：没有安装 dev.1、没有 seed、没有升级到 B、没有
  schema/数据校验。
- **没有一次性 profile/VM**：本轮没有创建隔离用户、容器或 VM；只证明“共享
  profile 会被拒绝”。
- **Pageant / OpenSSH Agent / 串口硬件**仍不在本轮范围。

后续若要在 Windows 上做真实升级，必须满足以下之一：

- 一次性 Windows VM（推荐）：快照后安装，结束后销毁；
- 一次性本地用户 profile，且 `UPGRADE_TEST_ROOT` 指向该 profile 下的显式
  测试根目录；
- 预检必须报告 `isolated=true` 且 `wouldTouchRealProfile=false`，否则安装脚本
  必须拒绝执行。

## 5. 判定

- `WINDOWS_PROFILE_ISOLATION_VERIFIED = PARTIAL`：只读预检与 fail-closed 在真实
  `windows-latest` 上通过；隔离 profile/VM 尚未建立。
- `WINDOWS_UPGRADE_E2E = NOT_RUN`：没有 Windows A→B 安装、迁移或数据完整性证据。
- **不得**把本文件的 success 读成“Windows 升级可用”或“Windows 数据安全已验证”。
