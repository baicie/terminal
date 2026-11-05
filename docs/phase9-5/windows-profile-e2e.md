# Phase 9.5.2 — Windows One-Time Profile E2E

> 日期：2026-11-05
> 代码：`windows-isolation-check.ps1`（证据收集）+ `windows-isolation-classify.mjs`（状态机）
> 测试：`windows-isolation-classify.test.mjs`（8 项）
> 判定：`WINDOWS_ISOLATION_VERIFIED = PARTIAL`、`WINDOWS_UPGRADE_E2E = NOT_RUN`

## 1. 旧实现的缺陷

旧脚本用 `target = Roaming\com.baicie.termius`，再把“target 在 Roaming 下”
当作真实 profile；这个条件恒为真，`isolated=true` 永远不可达。CI 的 success
只证明“脚本总是拒绝”，不能证明隔离逻辑正确。

## 2. 新状态机

`windows-isolation-classify.mjs` 是纯函数，按顺序判定：

1. `evidenceComplete=false` 或字段缺失 → `REFUSED_EVIDENCE_INCOMPLETE`；
2. 无 `expectedSid` → `REFUSED_SID_MISMATCH`；
3. 当前 SID == `runnerSid`、SYSTEM 或 RID 500 → `REFUSED_SHARED_RUNNER_PROFILE`；
4. 当前 SID != expected → `REFUSED_SID_MISMATCH`；
5. Known Folder Roaming/Local 不等于 `<profile>\AppData\Roaming|Local` →
   `REFUSED_FOLDER_REDIRECTED`；
6. 任一组件是 reparse point → `REFUSED_REPARSE_POINT`；
7. `testRoot != userProfile` 或 app 写入路径逃出 testRoot →
   `REFUSED_UNSAFE_TEST_ROOT`；
8. testRoot owner SID != expected → `REFUSED_OWNERSHIP`；
9. 存在 Termius 卸载项 → `REFUSED_EXISTING_INSTALL`；
10. pre-install 阶段存在 app 数据 → `REFUSED_EXISTING_DATA`；
11. `-VerifyCleanup` 的创建/删除失败 → `REFUSED_CLEANUP_PERMISSION`；
12. `disposable-vm` 缺少 run-bound `runId/instanceId/imageId` →
    `REFUSED_VM_ATTESTATION`；
13. 全部通过 → `ISOLATED_DEDICATED_USER` / `ISOLATED_DISPOSABLE_VM`。

PowerShell 只负责收集 SID、Known Folder、ProfileList、owner、reparse、卸载项、
数据目录、cleanup probe 和 OutFile 安全性；决策在 Node 中，可跨平台单测。

## 3. 负面测试

```bash
node --test scripts/verify-install/windows-isolation-classify.test.mjs
```

8 项通过：有效一次性用户、共享 runner、SID 缺失/不匹配、Known Folder 重定向、
reparse/unsafe test root、错误 owner、已有安装/数据、cleanup 拒绝、VM attestation、
不完整证据。

## 4. CI 真实结果

`windows-isolation-preflight`（最终 run `42003371472`）：

1. 先在 Windows runner 跑上述 state-machine 测试；
2. 以当前 runner SID 作为 `ExpectedSid` 和 `RunnerSid` 调用 PS；
3. 断言 exit code **恰好 1**、`reasonCode=REFUSED_SHARED_RUNNER_PROFILE`、
   `evidenceComplete=true`、`readOnlyPreflight=true`；
4. 输出 `windows-isolation.json` 和 `windows-isolation-assertions.json`，
   `if-no-files-found: error`。

这证明共享 runner 会被精确拒绝，且 refusal 不是 crash；**不证明**一次性用户
成功路径。

## 5. 仍未完成

- 没有创建一次性本地用户或 disposable VM，也没有以该用户运行真实 A→B；
- 没有验证 `verify-install-windows.ps1` 在真实隔离 profile 中的安装/卸载；
- junction/ACL 的 handle 级 canonicalization 仍是路径级检查；
- `WINDOWS_UPGRADE_E2E = NOT_RUN`，不得把预检 success 读成 Windows 升级通过。

## 6. 判定

- `WINDOWS_ISOLATION_VERIFIED = PARTIAL`：状态机、负面测试、真实共享 runner
  fail-closed 已通过；一次性 profile/VM 未建立。
- `WINDOWS_UPGRADE_E2E = NOT_RUN`。
