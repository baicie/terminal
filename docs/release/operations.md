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

4. 工作流自动执行：校验元数据 → 建 **draft** prerelease → 三平台构建 → macOS 合成 universal DMG → 资产写入 → 校验资产非空 + 生成 `SHA256SUMS.txt` →（若 updater 模式）校验签名与生成 `latest.json` → 全部通过后 **undraft**。
5. 任一步失败：release 保持 draft，不会出现在更新源里。修好后重跑 `workflow_dispatch` 指定同一 tag 即可（已发布过的 release 会被拒绝覆盖，必须升版本）。

## 发布一个 updater-signed 版本

先按 `docs/release/signing-keys.md` 配好 `TAURI_SIGNING_PRIVATE_KEY`，然后手动派发：

```
Actions → Release → Run workflow
  tag: v0.0.1-dev.2
  release_mode: updater-signed
```

缺失密钥时该次运行会在第一步失败，不会产出「假签名」产物。

## 触发 Nightly

`nightly.yml`：每天 18:00 UTC 定时，或手动派发（可勾选 `force` 强制构建）。

- 只在 `main` 有新提交时构建；没有新提交则 `plan` 输出 `needed=false`，后续 job 直接跳过。
- 版本号：`<stable>-nightly.<UTC 日期>.<短 SHA>`，例如 `0.0.1-nightly.20261029.abc123def456`。
- 产物：macOS universal DMG、Windows x64 NSIS、Linux x64 AppImage+DEB，命名 `Terminal-<version>-<asset_key>.<ext>`。
- 固定源码 SHA（`--target "$SHA"`），只发 **prerelease**，附 `SHA256SUMS.txt`；不触碰任何 stable 资产，也不生成 `latest.json`。
- Nightly 一律 unsigned QA；若将来要给 nighty 开自动更新，同样必须走 `updater-signed` 的签名要求。

## 回滚

- 发布出的 prerelease 可以直接 `gh release delete <tag>` 或标记为 draft；
- 已发布的 stable 更新索引不要原地覆盖，必须发新版本号；
- 代码回滚用 `git revert`，不要强推 tag。
