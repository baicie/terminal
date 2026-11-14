# Release Engineering 实测数据

本目录是 [`../release-engineering-report.md`](../release-engineering-report.md) 的原始数据，
不是手填的表格。

## `binary-matrix.json`

由 `scripts/release-engineering/build-matrix.mjs` 生成。同一 commit、同一 `dist/`，
四个 profile 各构建一次。

- `bytes` / `mib`：二进制大小（`statSync`）
- `sha256`：二进制内容哈希
- `embeddedEntries` / `jsEntryNames`：二进制中能找到的 `dist/index.html`
  引用的 JS 入口数。**这是灰屏的判据**——0 表示前端没被嵌入，窗口会是空壳。
- `commit`：产出这些二进制的源码提交

## `symbols-<profile>.json`

由 `scripts/release-engineering/archive-symbols.mjs` 生成。

- `binarySha256` + `commit`：符号属于哪一次构建
- `symbols.uuidMatches`：`dwarfdump --uuid` 对二进制与 dSYM 的 UUID 比对。
  **不匹配的 dSYM 会给出行号错误的栈，比没有符号更糟**，所以这个字段是
  `pairingComplete` 的必要条件。
- `otherPlatforms`：本机上无法验证的平台显式写 `NOT_RUN`，不省略、不伪造。

## 如何复现

```bash
# 1. 构建前端（Rust 编译期会读 ../dist）
pnpm --filter=@terminal/frontend build

# 2. 四个变体
node scripts/release-engineering/build-matrix.mjs

# 3. 符号配对
for p in release release-strip release-lto release-strip-lto; do
  node scripts/release-engineering/archive-symbols.mjs "$p"
done
```

注意：四个变体各自是独立的 `target/<profile>` 目录，所以每个都是一次全量编译。
墙钟时间主要由依赖编译决定，**不代表某个 profile 的开销**。
