# 产品身份迁移：测试前置复核

> 日期：2026-11-03
> 基线：`e44d7ab`
> 本阶段**不修改** `productName` / `identifier`，不复制或删除用户数据。

## 1. 当前状态

| 项 | 状态 |
| --- | --- |
| `productName` | `Termius`（未改） |
| `identifier` | `com.baicie.termius`（未改） |
| 迁移代码 | 不存在 |
| 自动删除旧数据目录 | 不存在，且禁止 |
| Vault 路径 | `dirs::config_dir()/terminal/vault.json`，与 identifier 解耦（未改） |

## 2. T1–T12 复核

| 编号 | 场景 | 状态 | 说明 |
| --- | --- | --- | --- |
| T1 | legacy 存在、current 不存在 | **NOT_RUN** | 无迁移实现 |
| T2 | 目标已存在且哈希一致 | **NOT_RUN** | 无迁移实现 |
| T3 | 目标已存在且哈希不同 | **NOT_RUN** | 无迁移实现 |
| T4 | 源库损坏 | **NOT_RUN** | 无迁移实现 |
| T5 | 迁移中途 kill 后重启 | **NOT_RUN** | 无迁移状态机 |
| T6 | 磁盘不足 / 复制失败 | **NOT_RUN** | 无迁移实现 |
| T7 | 目标目录只读 | **NOT_RUN** | 无迁移实现 |
| T8 | 旧库迁移后旧路径仍可读 | **NOT_RUN** | 无迁移实现 |
| T9 | Vault 路径保持且可解锁 | **NOT_RUN** | 需真实主密码；不能伪造 |
| T10 | 新 identifier 安装链 | **NOT_RUN** | 未改 identifier；脚本硬编码旧 id |
| T11 | 新 identifier 冷启动探针 | **NOT_RUN** | 同上 |
| T12 | 旧版本 → 新 identifier 升级 | **BLOCKED_EXTERNAL** | 需要双版本安装包与发行决策 |

## 3. 不能提前做的事

- 不把 `APP_BUNDLE_ID`、安装验证脚本和 `tauri.conf.json` 的 identifier 分成
  多个提交分别修改；任何不一致都会让安装/冷启动探针“读到空目录却通过”。
- 不用 `backup_database_before_migration()` 充当身份迁移；它是 schema 迁移前的
  `VACUUM INTO` 快照，不跨目录、不认识 identifier。
- 不在没有 T1–T8 自动化前写“以后能用”的生产迁移骨架；死代码会腐坏。

## 4. 进入实现阶段的前置

1. 产品名称、发行身份和旧版本过渡包方案已批准。
2. T1–T8 的迁移状态机设计冻结：复制、校验、失败删除目标、源不动、幂等。
3. Vault 路径策略单独决策：保持现状或字节级迁移 + 解锁探针。
4. 四个硬编码 identity 点同一提交更新：
   `tauri.conf.json`、`verify-install-macos.sh`、`verify-install-linux.sh`、
   `run-remote-cold-start-stopwatch.mjs`（及其 fixture 测试）。
5. T10–T12 在真实 runner 跑双版本安装链。

**判定：NOT_RUN。** 本阶段只复核了前置条件，没有声称迁移可用。
