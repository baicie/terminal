# Phase 9.5 — Upgrade Data Integrity

> 日期：2026-11-05
> 证据：`docs/phase9-5/evidence/dev1-to-dev2/`、`dev1-to-dev3-current/`

## 1. 判定口径

升级后的数据检查必须区分四层，不能用一个文件哈希代替：

1. **文件存在**：DB、WAL、vault、backup 文件在预期路径。
2. **内容未改变**：vault 的 salt/entries、数据库行的受控字段。
3. **可读取**：通过 SQLite（以及 B 的 app 启动路径）能读出数据。
4. **业务语义仍成立**：hosts/workspaces/settings/team 行的字段值、layout JSON
   的 marker/sidebar、schema 的列集合。

本 harness 以第 3/4 层为主证据；第 1/2 层只作辅助。`row_digest` 与文件 SHA 只
记录，不作为唯一证据。

## 2. 覆盖域

| 域 | 断言 | 结果 |
| --- | --- | --- |
| hosts | A 实际存在的 20 列逐字段比较；B 新增 2 列存在且默认值报告；密码/私钥必须为 NULL | PASS |
| app_settings | A 的所有键逐字段比较（不再只比较 7 个白名单键）；`terminalThemeLight`/`terminalThemeLightMigrated` 一次性迁移单独报告；未知新键记录 | PASS |
| workspaces | id/name/description/icon/color/order/created_at 逐字段；is_active 由 app 拥有，报告不门禁 | PASS |
| workspace_layouts | JSON 可解析；`phase89Marker`、`sidebarVisible` 保留 | PASS |
| Team Sync 本地表 | teams / team_members / team_shared_hosts / sync_queue / user_profile 逐字段；`api_token` 为 NULL | PASS |
| vault | 文件存在、JSON 可解析、salt 字节一致、entries=0；**真实主密码解锁 NOT_RUN** | PASS（文件层） |
| schema | A 的表/列是 B 的子集；新增列显式断言 | PASS |
| backup | 有备份能力的 B：`pre-migration-<epoch>.db` 存在、integrity ok、seeded 行可读 | PASS（当前 B） |
| 行数 | hosts 不减少；workspaces 不增减；team/sync 行仍在 | PASS |

## 3. 真实结果

- dev.1 → dev.2：**全部域 PASS**；pre-migration backup **NOT_RUN**（dev.2 没有
  备份命令）。
- dev.1 → 当前 dev.3-local：**全部域 PASS**；pre-migration backup **PASS**，
  `backup-report.json` 证明备份 integrity ok、hosts/settings/workspace/layout 可读。
- 两次运行的 A/B SHA、版本、identifier、arch、schema 前后列集合均在
  `upgrade-report.json` 中。

## 4. 不能声称的事

- **A 的 app 级读回**：dev.1 的 `store/app.ts` 没有
  `terminalThemeLightMigrated` 写回，因此没有内容依赖的 read-back 探针。本报告
  只能证明 A 创建了真实 schema、受控行可通过 SQL 读回；不能声称“A 的 UI 读到了
  这些行”。该限制标 PARTIAL，未写成 PASS。
- **Vault 真实解锁**：测试 vault 是 schema-valid、零条目的 fixture；没有主密码，
  不执行加解密。真实 Vault 解锁和 Team Sync 服务端升级均 NOT_RUN。
- **Team Sync 服务端**：只验证本地表持久化；没有 server、token 或网络同步。
- **schema 降级**：Phase 9.5.1 已验证 A **读取** B 的加法 schema（数据哈希未变），
  但没有正式降级状态机，也没有 B→A 写回保证；不能把“A 能读”写成“降级安全”。
- **字节级相同**：没有把文件哈希相同当作数据保留证据；哈希只用于 vault/文件
  存在性辅助。

## 5. 判定

`UPGRADE_DATA_INTEGRITY_VERIFIED = YES`（macOS，hosts/settings/workspaces/layout/
Team Sync 本地/vault 文件/schema/backup；不含真实 Vault 解锁与服务端同步）。

Phase 9.5.1 追加：Linux DEB 真实安装链同样逐字段 PASS；当前源码的 CI 升级链见
`ci-current-version-upgrade.md`；中断/恢复/降级见 `rollback-and-recovery.md`。
