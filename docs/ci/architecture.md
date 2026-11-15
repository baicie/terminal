# CI 架构

## 1. 触发边界

| 事件 | 谁跑 | 为什么 |
| --- | --- | --- |
| PR（非 docs）| `ci.yml` + `native-gui-e2e.yml` | 合并前的全部质量门禁 |
| PR（仅 docs）| 同上，所有 job `skipped` | `CI / required` 仍然上报并通过 |
| push → `main` | `ci.yml` | 合并后的集成结论；没有 PR run 可用 |
| push → 功能分支 | **不跑** | 与同一 commit 的 PR run 完全重复（见下）|
| tag `v*` | `release.yml` | 发布 |
| 每周一 03:30 | `real-machine-matrix.yml` | 重采六份实机证据 |
| 手动 | 全部 | 显式运行 |

### 1.1 消除的重复

改造前每个 commit 跑两次完整 CI：

```
43692358326 pull_request  e67ee9f2
43692356593 push          e67ee9f2
```

两次**没有互相取消**，因为 concurrency group 用 `github.ref` 而 push 是
`refs/heads/<branch>`、PR 是 `refs/pull/N/merge`。

改造后 `push` 只监听 `main`。功能分支的 push 不再触发 —— PR run 已经断言了同一棵树，而且
它才是分支保护能 require 的那个。

`cancel-in-progress` 保持只对 PR 为真：新 commit 让旧 PR 结论失效，但 `main` run 的结论是
那个 commit 的记录，不该因为后续 commit 到达而被丢弃。

## 2. 证据的两层契约

```
                 ┌─────────────────────────┐
PR 每次提交 ───▶│ --mode=integrity        │  证据自洽吗？
                 │  schema / manifest /    │  与「当前源码」无关
                 │  raw logs / binary sha /│
                 │  runId 一致 / 无混用    │
                 └─────────────────────────┘

                 ┌─────────────────────────┐
release tag ───▶│ --mode=qualification    │  证据描述的是这次提交吗？
                 │  ↑ 以上全部             │  + 源码指纹比对
                 └─────────────────────────┘
```

### 2.1 为什么必须分开

2026-11-15 实测：`main` 上七个 problem，全部是「recorded against fingerprint
d45be813…, sources now fingerprint as …」。每个 PR 都继承它们，`Repository gates` 在每个
分支上都红，**而没有任何 PR 能修复它**。

后果不是"红色的 CI"，而是：真正的证据问题会藏在这片噪声里。

如果为了消除噪声而**完全删掉**指纹比对，下一次发布就会带着描述旧代码的证据出门。所以
不是删除，是分层。

### 2.2 兼容性

- 默认模式仍是 `qualification`。不带 `--mode` 的调用（含 `pnpm verify`）行为不变。
- 文件格式、manifest 结构、`FINGERPRINT_PATHS` 全部未改。
- 六份历史证据**未修改**。

## 3. 权限

| workflow | 顶层 permissions | 说明 |
| --- | --- | --- |
| `ci.yml` | `contents: read` | 全部只读 |
| `native-gui-e2e.yml` | 待核 | |
| `release.yml` | **`contents: write`** | P1：所有 job 继承写权限，包括只是构建的（见审计 §8）|

## 4. 明确未做

- Phase B 的 SFTP Command E2E 接入（`sftp-command-e2e.mjs` 仍未被任何 workflow 调用）
- Phase C 的 Release Qualification 完整实现
- release.yml 的权限最小化（顶层 `contents: write` 被所有 job 继承）
- updater 发布顺序（任务书 §4.2）
