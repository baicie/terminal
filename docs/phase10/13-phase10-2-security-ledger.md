# Phase 10.2 — 安全与迁移风险台账

- 基线：`main = e843e39`（Phase 10.1.1 已合入）
- 本轮判定沿用 Phase 10.1.1 的 `PHASE10_1_1_VERDICT=PARTIAL`
- 本文只记录**风险状态**，不把任何 NOT_RUN 写成 PASS

## 1. 四种状态必须分开记

任务书 G2 的核心要求。以下四件事互不等价，混为一谈是这类台账最常见的错误：

| 状态 | 含义 | 当前 |
| --- | --- | --- |
| **新写入安全** | 今天保存一台主机，秘密不会进 SQLite 明文列 | ✅ PASS（代码 + 测试） |
| **历史明文仍存在** | 旧版本写下的明文可能仍在 `password` / `private_key` 列 | ⚠️ 取决于用户是否执行过迁移 |
| **迁移已完成** | 用户显式点击迁移、逐行写 Vault 并读回验证 | 🔴 **用户未执行** |
| **历史 WAL / 旧备份已清除** | 已写成明文的历史 WAL 帧与导出文件被擦除 | 🔴 **未做，需单独授权** |

「新写入安全」成立**不代表**这台机器上没有明文。迁移入口在设置面板，需用户显式
点击；本轮未在真实用户数据库上执行，按规范也不应执行。

## 2. G1 — 团队共享主机的明文路径

### 现状

`team_shared_hosts.host_data` 是第二条明文写入路径：

- `components/share-host-dialog/index.tsx` 提供「包含密码 / 私钥」选项；
- 用户勾选且**未**启用加密时，`hostData.password` / `host_data.private_key` 被
  `JSON.stringify` 写入同一 SQLite 文件，并同步到服务端；
- 启用加密时走 `password_encrypted` / `private_key_encrypted`，不写明文。

### 评估

这是**用户显式选择、带警告的主动操作**，不是静默泄露：用户要分享凭据给队友，
且可以选择加密。它不经过任何导入入口，因此不影响「所有导入路径」这条边界声明。

### 建议（未实施，属产品决策）

1. 默认关闭「包含秘密」，需要用户主动开启并二次确认；
2. 未启用加密时禁止包含秘密（把「明文共享」变成不可达状态）；
3. 已存在的明文共享行需要迁移说明，**不能静默丢弃** —— 那会让队友手里的主机
   突然没有凭据，且没有任何提示。

### 为什么本轮不改

改默认值会改变已有用户的行为（他们可能正在依赖这个功能），属于产品决策；
按任务书「如调整现有行为，必须做兼容分析与迁移说明」，本轮只记录不实施。

`SHARE_HOST_CREDENTIAL_PLAINTEXT=PARTIAL`（保持 Phase 10.1 的记录，未变好也未变坏）。

## 3. G2 — Vault 与历史数据

见 §1 的四种状态表。补充两条容易误读的事实：

- `cargo audit` / 门禁全绿**不代表**没有明文残留。它只表示「没有未记录的 advisory」，
  与凭据存储形态无关。
- Phase 10.1.1 修复的是**写入路径**（导入不再写明文列、部分更新不再丢秘密）。
  它不触碰已经写下的历史数据。

## 4. G3 — 依赖 Advisory

| Advisory | 状态 | 真实风险 | 缓解 |
| --- | --- | --- | --- |
| `RUSTSEC-2023-0071`（rsa 0.10.0-rc.18，Marvin 攻击） | **不可修** | 时序侧信道可恢复 RSA 私钥，需攻击者能测量解密耗时 | `patched = []`，russh 与 ssh-key 精确钉死该版本；实际利用需要极精确的时序测量，且本应用的 SSH 连接不是高频高精度远程可测量场景 |
| `RUSTSEC-2026-0459`（libsqlite3-sys 0.30.1 捆绑 SQLite） | **不可修** | 构造 db + `-wal` 页大小不一致时返回未初始化页缓存内存 | sqlx 0.9.0 要求 `<0.38.0`，tauri-plugin-sql 2.6.0 要求 `sqlx ^0.8`，整条链够不到修补版 `>= 0.39.0`。输入边界：需要攻击者能同时提供 `.db` 与 `.wal`，而应用只打开自己的数据目录 |

**不得声称「生产依赖审计为 0 个已知漏洞」。** `cargo audit` 绿只表示没有**未记录**的
advisory；这两条是已记录且上游无修复的真实风险。

## 5. G4 — 跨进程并发

`CROSS_PROCESS_CONCURRENT_IMPORT=NOT_VERIFIED`（沿用 Phase 10.1.1 的判定）。

已有的保护：

- `tauri-plugin-single-instance` 是最先注册的插件，第二个进程在第一行代码前退出；
- `instance.lock` 运行时锁在任何数据库访问前持有，`RuntimeLockHandle` 校验 inode，
  锁文件被删除或替换即失效；
- 恢复路径有 `RecoveryLock`（OS 文件锁 + 进程内互斥）。

**但这仍然不等于「证明不存在两个导入写入方」**：

- 没有测试专门验证「两个进程同时导入同一主机」；
- 单实例插件与运行时锁是为**启动**与**恢复**设计的，没有被拿来做导入并发验证；
- 若将来引入后台同步或多窗口写路径，这条保护不会自动延伸。

因此保持 `NOT_VERIFIED`。要升级为 PASS，需要一条真实的双进程导入竞争测试。

## 6. 本轮对安全边界的改动

| 改动 | 影响 |
| --- | --- |
| `identity_file_path` 新列 | 导入不再把路径塞进 `private_key`（Phase 10.2-B2）。未新增秘密存储位置 |
| 连接层遇 `identityFilePath` 明确拒绝 | 不在连接时隐式读任意文件 |
| 导入向导 | 走与手动保存相同的 `addHost`，没有第二套写入路径 |
| Vault 恢复面板 | 仍只写 Vault，Vault 不可用时拒绝保存，不退化为明文 |

没有新增绕过 Vault 的路径。

## 7. 判定

```
CREDENTIAL_NEW_WRITES_SAFE=PASS
CREDENTIAL_HISTORY_MIGRATED=NOT_RUN
CREDENTIAL_HISTORY_WAL_ERASED=NOT_RUN
SHARE_HOST_CREDENTIAL_PLAINTEXT=PARTIAL
RUSTSEC_2023_0071=UNRESOLVED_BASELINED
RUSTSEC_2026_0459=UNRESOLVED_BASELINED
CROSS_PROCESS_CONCURRENT_IMPORT=NOT_VERIFIED

SECURITY_RELEASE_BLOCKERS=2（RSA 与 SQLite 两条上游无修复的 advisory；签名/公证另计）
```
