# Phase 9.5.2 — Upgrade Evidence Scenario Contract

> 日期：2026-11-05
> 代码：`scripts/verify-install/upgrade-evidence-contract.mjs`、`check-upgrade-evidence.mjs`
> 测试：`upgrade-evidence-contract.test.mjs`（10 项）+ 既有 gate 测试
> 判定：`UPGRADE_EVIDENCE_CONTRACT_VERIFIED = YES`（真实 CI 报告见第 6 节）

## 1. 为什么需要场景级契约

旧的 gate 只要求 `B migration` 和 `data integrity after B` 两个 check，其他场景
可以靠“check 名字存在”蒙混。例如：

- 顶部 `status=PASS`，但 `faultAssessment.overall=PARTIAL`；
- restore 只比较文件哈希，不证明 A 真的启动；
- downgrade 只要 A 能读加法 schema 就算 PASS，不检查 B 列数据；
- interrupted 只要求 `interrupted mid-migration` 这个名字，不要求 detail 里
  有“缺失列”；
- 报告可以用 `scenario: normal` 掩盖 `fault: corrupt-db`；
- 安装包元数据 `status/FAIL`、`problems` 非空或 `expected.sha256=null` 仍被接受。

现在每个场景有独立的 required checks、required facts 和 required detail。

## 2. 场景表

| 场景 | 必需 check（全部 PASS） | 必需 fact（全部 PASS） |
| --- | --- | --- |
| `normal` | A/B metadata、install A/B、A DB/schema/stop/seed/read-back、B migration/stop、data integrity、`vault crypto unlock after B` | 无 |
| `corrupt-db` | `corrupt DB preserved`、`corruption detected by the app` | FAULT_INJECTED、APPLICATION_FAILURE_OBSERVED、ORIGINAL_DATA_PRESERVED、NO_PARTIAL_MIGRATION |
| `read-only-data-dir` | `read-only data dir preserved DB`、`read-only failure detected by the app`、`no partial migration`、`read-only recovery` | 五事实全部 |
| `restart-idempotent` | B migration、`second B launch`、`restart idempotent`、data integrity | ORIGINAL_DATA_PRESERVED、NO_PARTIAL_MIGRATION、RECOVERY_SUCCEEDED |
| `interrupted` | `interrupted after backup`、`interrupted mid-migration`（detail 必须含 `missing`）、pre-migration backup、B migration、data integrity、recovery | FAULT_INJECTED、ORIGINAL_DATA_PRESERVED、NO_PARTIAL_MIGRATION、RECOVERY_SUCCEEDED |
| `restore-backup` | B migration、data integrity、backup readable、`restored DB matches backup`、`restored A launch`、`backup restore`（detail 必须含 `A launched`） | 无 |
| `downgrade` | A metadata、`downgrade A launch`、downgrade readability、`downgrade preserved B columns`、downgrade did not destroy data | 无 |
| `linux-deb` | A/B metadata、install A (deb)、A DB/schema/stop/seed/read-back、B installed version、A->B version changed、B migration/stop、data integrity | 无 |
| `linux-appimage` | `AppImage payload replacement` PASS、`AppImage app startup` NOT_RUN；`status=PARTIAL` | 无 |
| `linux-appimage-full` | payload replacement、app startup、B migration、data integrity | 无 |

`normal` 的 backup 是可选检查：历史 dev.2 没有备份命令，标 NOT_RUN 仍可 PASS；
但 `--expect-backup` 的当前 B 必须 PASS。

## 3. 状态规则

- `PASS`：所有 required checks 和 facts 均 PASS，且 `faultAssessment.overall=PASS`。
- `PARTIAL`：只允许 `allowPartial: true` 的 `linux-appimage` payload-only；必须
  有 `notRun` 列表和缺失项。
- `FAIL`、`NOT_RUN`、`BLOCKED_EXTERNAL`：一律不是绿色证据，gate 拒绝。
- `payloadOnly=true` 不能 PASS；`AppImage app startup` 必须是 `NOT_RUN`。
- `faultAssessment.required/failed/missing/overall` 必须与 scenarios 表和 facts
  推导完全一致；`fault.<FACT>` check 必须与 facts 一致。
- `report.scenario` 必须等于从 `fault/mode/payloadOnly` 推导的场景，不能拿
  `normal` 标签掩盖故障。
- `contractVersion=2` 报告必须有 40-hex `sourceSha`、非空 `runId`、A/B
  `status=PASS`、空 `problems`、64-hex `expected.sha256` 且等于实测 SHA。
- 历史报告（无 `contractVersion`）走 legacy 路径；CI 使用 `--require-contract`
  强制新报告带契约。

## 4. 负面测试

`upgrade-evidence-contract.test.mjs` 覆盖：

1. 所有 10 个场景的有效报告通过；
2. PASS + fault overall PARTIAL 被拒绝；
3. 缺少 required check/fact 被拒绝；
4. restore 缺 `A launched` 被拒绝；
5. downgrade 缺 A metadata / B 列检查被拒绝；
6. restart 缺第二次启动证据被拒绝；
7. interrupted detail 缺 `missing` 被拒绝；
8. payload-only 不能 PASS，startup PASS 被拒绝；
9. full AppImage 只有 replacement 被拒绝；
10. `--require-contract` 缺 contractVersion 被拒绝；
11. scenario 标签伪装被拒绝；
12. 非 allowlist 的 FAIL/PARTIAL/NOT_RUN/BLOCKED 被拒绝。

运行：

```bash
node --test scripts/verify-install/*.test.mjs
node scripts/verify-install/check-upgrade-evidence.mjs --require-contract <report.json>...
```

## 5. 失败即红

- `upgrade-e2e.mjs` 的 `applyFaultAssessment` 现在会先看全局 FAIL check，再取
  fault overall，避免“FAIL check + PASS status”。
- `main()` 只要任何 check 为 FAIL 就退出 1，与 report.status 无关。
- workflow 的 `Fail closed on incomplete upgrade evidence` 无
  `continue-on-error`，并使用 `--require-contract`。

## 6. 真实结果

| 项 | 值 |
| --- | --- |
| 本地脚本测试 | 46 passed / 2 skipped（Node 22 无 argon2；Node 24 全过） |
| 本地真实 normal 报告 | PASS，`vault crypto unlock after B` PASS |
| 本地 restore/downgrade/interrupted | 均 PASS，新增 A/B 启动与 B 列检查 |
| CI | 见 `phase9-5-2-implementation.md` 的最终 run |

## 7. 不能声称

- 契约验证的是报告是否完整/自洽，不是对安装包字节的远程证明；SHA 来自
  `asset-metadata.mjs` 对实际文件的读取，gate 只能校验字段一致。
- 历史 Phase 9.5.1 报告没有 `contractVersion`，仍按 legacy 规则读取，不能把
  它们当作新契约已验证。
