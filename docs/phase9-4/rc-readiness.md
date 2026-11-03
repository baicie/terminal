# Phase 9.4 — RC Readiness

> 日期：2026-11-03
> 基线：`e44d7ab`（stacked branch，PR #6 尚未合并）

## 1. 逐项状态

| 项 | 状态 | 证据 / 原因 |
| --- | --- | --- |
| macOS 冷启动诊断链 | **PASS** | `terminal-mounted`、串行 trace、30/30 阶段完整 |
| macOS 冷启动 20% 根因 | **NOT_RUN** | 30 次未复现；历史失败 Unified Log 未采到 |
| 300 次冷启动样本 | **FAIL（3.7%）** | run `41602408642`：289/300，Wilson 95% 上界约 6.4% |
| RSA Marvin 可达性 | **PASS**（有条件接受） | 见 `rsa-threat-model.md` |
| RSA 上游修复 | **BLOCKED_EXTERNAL** | `patched = []` |
| 单版本安装 + 数据内容保留 | **PASS** | 现有三平台 install job |
| 跨版本升级 / 回滚 | **NOT_RUN** | 无双版本安装链；没有升级事务 |
| updater 真实签名 | **BLOCKED_EXTERNAL** | 公钥仍是占位符 |
| 身份迁移 T1–T12 | **NOT_RUN / BLOCKED_EXTERNAL** | 未改 identifier；无迁移实现 |
| Windows / Pageant / 串口硬件 | **NOT_RUN** | 无实机 |
| 物理键盘 / 中文 IME | **NOT_RUN** | 需人工键入 |

## 2. 四个判定

### READY_FOR_REVIEW

**否，待 300 次样本与文档回写完成。**

### READY_FOR_MERGE

Phase 9.4 是 stacked branch，不能独立合并到 main；PR #6 合并后需要 rebase。
本阶段不自动合并。

### READY_FOR_RC

**否。**

至少还缺：

1. 把 3.7% 失败率降到 1% 以下；当前 300 次样本不足以支持 RC。
2. 历史 20% 失败的 Unified Log 根因，或明确的“环境/时间窗口”解释。
3. `terminal-not-mounted` 与晚挂载失败的产品级修复。
4. 修复后重新做 300 次样本（当前 `8542ca5` 之后已有 probe 配置预算修复）。
5. 跨版本升级、回滚、失败恢复。
6. Windows / Pageant / 串口 / 物理键盘实机验收。

### READY_FOR_RELEASE

**否。** 同 RC，另加：

- notarization / Authenticode；
- updater 真实签名；
- 安装后真实 Vault 解锁与 Team Sync 数据保留；
- 跨版本升级与降级。

## 3. 不允许的绿色方式

- 不把 30/30 写成“20% 已修复”。
- 不把单版本覆盖安装写成跨版本升级。
- 不把 RSA 依赖图可达写成漏洞可利用，也不把可达性分析写成“无风险”。
- 不修改旧证据指纹。
- 不删除失败样本、不跳过失败 probe。
