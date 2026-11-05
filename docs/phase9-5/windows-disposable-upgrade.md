# Phase 9.5.3 — Windows Disposable Profile Upgrade

> 日期：2026-11-05
> 代码：`windows-isolation-check.ps1` + `windows-isolation-classify.mjs`
> 判定：`WINDOWS_DISPOSABLE_PROFILE_VERIFIED = NOT_RUN`、`WINDOWS_UPGRADE_E2E = NOT_RUN`

## 1. 本轮完成

- 保留并验证了 Phase 9.5.2 的身份/路径/owner/reparse/existing data/cleanup/VM
  attestation 状态机；
- 8 项负面测试覆盖 SID、Known Folder、reparse、owner、existing install/data、
  cleanup 拒绝、VM attestation、不完整证据；
- `windows-isolation-preflight` 在真实 `windows-latest` 上以精确
  `REFUSED_SHARED_RUNNER_PROFILE` 退出 1，并验证 `evidenceComplete=true`、
  `readOnlyPreflight=true`、无 install/delete；
- artifact 上传 `if-no-files-found: error`。

## 2. 为什么仍不是真实隔离

共享 runner 的 `runneradmin` 不是一次性用户；`New-LocalUser` 创建的用户需要：

- 真实用户 token 下启动应用（`Start-Process -Credential`/计划任务/VM），
  不能只改 `APPDATA`；
- 独立桌面/会话与 Known Folder 重定向验证；
- 用户 Profile 注册、owner/ACL、清理权限和 SID 销毁；
- NSIS A→B 安装、启动、数据字段、vault、Team Sync 本地表、卸载项。

本轮没有创建/销毁真实一次性用户或 VM，因此：

- `WINDOWS_DISPOSABLE_PROFILE_VERIFIED = NOT_RUN`
- `WINDOWS_UPGRADE_E2E = NOT_RUN`

## 3. 可执行方案（下一阶段）

1. 优先 disposable Windows VM：每次 run 创建快照，安装 dev.1，seed，升级 B，
   校验，销毁 VM；
2. 或一次性标准本地用户：
   - `New-LocalUser`，记录 SID；
   - 用该凭据 `Start-Process -LoadUserProfile` 启动 app；
   - 预检 `ISOLATED_DEDICATED_USER`；
   - 只操作该 profile；
   - 结束后按 SID `Remove-LocalUser` + `Win32_UserProfile` 删除，不按路径
     `Remove-Item -Recurse` 盲删；
3. 在真实隔离前，禁止在主 CI 的 Windows job 运行会删除真实 `%APPDATA%` 的旧脚本。

## 4. 判定

- `WINDOWS_DISPOSABLE_PROFILE_VERIFIED = NOT_RUN`
- `WINDOWS_UPGRADE_E2E = NOT_RUN`
