# Release / Nightly 操作指南

## 发布一个正式（QA 模式）版本

1. **改版本号**（三处必须一致，workflow 会校验，不一致直接失败）：

```bash
# package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml
# 例：0.0.1-dev.2
```

2. 提交并合并到要发布的分支。
3. 打 tag 并推送（tag 必须与三处版本一致，且必须指向该 commit）：

```bash
git tag v0.0.1-dev.2
git push origin v0.0.1-dev.2
```

4. 工作流自动执行：校验元数据 → 建 **draft** prerelease → 三平台构建（macOS 按 `aarch64` / `x86_64` 各出一个 DMG）→ 资产写入 → 校验资产非空 + 生成 `SHA256SUMS.txt` →（若 updater 模式）逐架构校验签名与生成 `latest.json` → 全部通过后 **undraft**。
5. 任一步失败：release 保持 draft，不会出现在更新源里。修好后重跑 `workflow_dispatch` 指定同一 tag 即可（已发布过的 release 会被拒绝覆盖，必须升版本）。

## 发布一个 updater-signed 版本

先按 `docs/release/signing-keys.md` 配好 `TAURI_SIGNING_PRIVATE_KEY`，然后手动派发：

```
Actions → Release → Run workflow
  tag: v0.0.1-dev.2
  release_mode: updater-signed
```

缺失密钥时该次运行会在第一步失败，不会产出「假签名」产物。

## Nightly 通道（已移除）

`nightly.yml` 已按项目决定删除，仓库现在只有 `ci.yml`、`release.yml`、`real-machine-matrix.yml` 三条 workflow。

- 历史上发布过的 nightly prerelease 与 `nightly-<version>` tag 保留在 Releases 里作为记录，不再更新；
- 它当年验证出的三个缺陷（rustup 不认 `universal-apple-darwin`、版本改写没同步 `Cargo.lock`、Windows CRLF 让正则静默不匹配）已写入 `docs/release/workflow-rules.md`，仍然有效；
- 需要每晚构建时，用 `release.yml` 的 `workflow_dispatch` 手动派发即可，不必恢复定时通道。

## 回滚

- 发布出的 prerelease 可以直接 `gh release delete <tag>` 或标记为 draft；
- 已发布的 stable 更新索引不要原地覆盖，必须发新版本号；
- 代码回滚用 `git revert`，不要强推 tag。
