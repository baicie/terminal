# Phase 8 — Release Candidate Hardening

> 分支 `feat/phase8-rc-hardening`，基线 `main` `301cf04`。
> 本目录是 Phase 8 的交付文档集。

## 文档索引

| 文件 | 内容 |
| --- | --- |
| [baseline.md](./baseline.md) | P8.0 基线与证据治理：代码基线、环境核查、门禁基线、风险矩阵、文档一致性核查 |
| [audit.md](./audit.md) | P8.2 SQLite 事务正确性审计：证据链、真实失败模式、方案对比 |
| [security.md](./security.md) | P8.1 Vault 安全与迁移：verifier 设计、旧格式三路径、独占创建、13 条测试 |
| [reliability.md](./reliability.md) | P8.3/P8.4 可靠性：Linux stale-output 根因、输出静默丢弃、修复清单 |
| [ui-review.md](./ui-review.md) | P8.6 UI/UX 打磨记录 |
| [release-readiness.md](./release-readiness.md) | P8.7 发布工程审查：身份、许可证、资产矩阵、updater、三平台验收 |
| [final-report.md](./final-report.md) | 最终报告：阶段状态、修复清单、CI、三个 READY 判定 |

## 阶段状态速览

| 阶段 | 状态 | 提交 |
| --- | --- | --- |
| P8.0 基线与证据治理 | ✅ COMPLETE | `bfeb895` `0725989` |
| P8.1 Vault 安全与迁移 | ✅ COMPLETE | `08dc637` `d243a55` `67698c9` |
| P8.2 SQLite 事务正确性 | ✅ 审计 + 修复 COMPLETE | `37b853d` `082c3ce` |
| P8.3 Linux SSH/PTY 收口 | 🟡 PARTIAL（判据缺陷已修，实机需重跑） | `26ace99` `1c8629c` `3e40823` |
| P8.4 终端生命周期与背压 | 🟡 PARTIAL（静默丢弃已修，压力用例部分） | `3e40823` |
| P8.5 Team Sync 故障恢复 | ✅ COMPLETE（13 例真库测试） | `b559225` `3ce7c21` |
| P8.6 UI/UX 打磨 | 见 final-report | — |
| P8.7 RC 工程 | 🟡 PARTIAL（文档与许可已收口，实机验收 NOT_RUN） | `0feb8b6` `7795eac` `6432343` `c919e2d` |

## 两条贯穿全阶段的原则

### 1. 证据绑定源码指纹，因此只在源码冻结后重采一次

`scripts/check-verification-evidence.mjs` 第 288 行把**自身**列进 `FINGERPRINT_PATHS`。改门禁 = 改指纹 = 6 份证据失效。这是有意的自指保护（防止改门禁让自己通过），不是缺陷。

Phase 8 改动了大量 fingerprinted 路径，因此：**证据重采在全部阶段源码冻结后统一执行一次**。在此之前 `evidence gate` 在分支上保持红色，并在各处如实标注——这是唯一同时满足「不伪造证据」与「不浪费 CI」的路径。

### 2. 文档会朝两个方向腐化

Phase 7 结束时发现「问题已解决却写着没解决」（5 处），Phase 8 P8.7 又发现「已经做过却写着从未做过」（10 处，最典型是 updater-signed 实际已在 dev.2 用真实密钥跑通，而多处文档仍写从未执行）。

两个方向同样有害：前者让人重复劳动，后者让人误判风险等级。所有状态声明都必须能被当前的代码或 CI 复现。

## 关键结论（供快速判断）

1. **导入不再是「最坏可见失败」**：审计确认真实最坏是半导入落盘不报错 + 他人写入被静默回滚。已改为 Rust 单连接单事务，12 条真库故障注入测试覆盖。
2. **Vault 不再接受错误密码**：引入域分离 HMAC verifier + 常量时间比较；create 改为 `create_new` 独占创建，无 TOCTOU。
3. **Linux stale-output 是判据缺陷不是环境问题**：marker 无前导换行被粘在 prompt 后，而判定用整行精确相等。已两边都修。
4. **输出丢弃不再静默**：新增 droppedBytes/droppedChunks 计数与 warn，维持不变量 `accepted = parsed + dropped`（静止态）。
5. **三平台安装/升级仍未验证**：这是 RC 的硬阻塞项，CI 全绿不能替代。
