# 同步冲突的五处根因（P9.2-1..5）

> 基线 `84f73b0^`（= `2f1d68f`）。每条都按同一顺序写：**修复前是什么代码、它怎么错、修复后靠什么保证**。
> 回退验证命令附在每节末尾，全部可在当前仓库重跑。

## 0. 一张表

| 编号 | 症状 | 根因位置 | 修复后 |
| --- | --- | --- | --- |
| P9.2-1 | 并发写入被静默覆盖 | `resolveConflict` 的 `baseVersion ?? share.version`；`pushChanges` 只判「匹配」 | 三处统一 `classifyBaseVersion`，缺版本 `BASE_VERSION_REQUIRED` |
| P9.2-2 | 敏感共享明文落库 / 密文被旧值覆盖 | 客户端三张表没有 `is_sensitive`/`encrypted_data`；`remoteGuard` 只比 `data` | 安全状态随行存储、随行上送；服务端拒绝自相矛盾载荷 |
| P9.2-3 | HTTP 200 + `{success:false}` 被当成功 | 前端只判 `result.error` | `ApiOutcome` 七种失败原因，冲突只在确证成功后移除 |
| P9.2-4 | REMOTE 没落盘就删冲突 | `adoptRemoteShare` 空数据早返回，调用方照样删 | 优先用冲突里用户看到的那份；区分 deleted/forbidden/incomplete/unavailable |
| P9.2-5 | 同毫秒写入漏判、时钟偏移误判 | `checkConflicts` 只比 `updatedAt` 毫秒 | 有版本以版本为准，毫秒只做无版本时的回退 |

---

## 1. P9.2-1：条件写退化成无条件写（最严重）

### 修复前的代码

```ts
// packages/team-server/src/sync/sync.service.ts @ 84f73b0^
const written = await this.prisma.share.updateMany({
  where: { id: shareId, version: clientData.baseVersion ?? share.version },
  data: buildShareUpdateData(clientData, share, true),
})
```

`share` 是**同一个请求里刚读出来的**。所以 `clientData.baseVersion` 缺省时，
`where.version` 恒等于该行当前版本，`count === 1` 恒成立——**这个条件写永远不会失败**。

### 它怎么错

1. 客户端 A 读到 v5，用户改完，提交 LOCAL 解决但没带 `baseVersion`；
2. 此间客户端 B 写入 v6；
3. A 的请求把 `share` 读成 v6（含 B 的数据），`where.version = 6`；
4. 写成功，B 的 v6 被 A 基于 v5 的内容覆盖。

结果是一次**静默覆盖**：没有冲突、没有报错、B 的数据没了。
这和 `docs/issue.md` #63 修掉的那类缺陷是同一个形状——**用同请求读取的版本当"证明"**。

### 修复

```ts
// packages/team-server/src/sync/sync-conflicts.ts
const verdict = classifyBaseVersion(share.version, clientData.baseVersion)
if (verdict !== 'match') {
  return {
    success: false,
    error: verdict === 'unproven'
      ? 'BASE_VERSION_REQUIRED'
      : 'CONFLICT_STALE_VERSION',
  }
}
```

- `classifyBaseVersion` 是**纯函数**（`sync-protocol.ts`），只有 `match` 放行；
  `unproven`（缺版本/非法）、`stale`、`future`、`legacy-timestamp`、`unverifiable` 全部拒绝。
- `updateMany` 的 `where` 仍然带 `version: share.version`，但此时它只是**最后一道防线**，
  不再是唯一判定。
- `pushChanges` 用同一个函数判定，`checkConflicts` 也用同一个：**三个入口不可能给出不同答案**。

### 客户端的对应约束

`buildLocalResolution()` 只接受「用户在冲突对话框里看到的那一份远端版本」：

```ts
// packages/frontend/src/store/team-actions-sync-conflict.ts
// `baseVersion` is the version of the snapshot the *user was shown* ... never a
// version re-read just before sending.
```

没看过远端快照（push-only 冲突）时**不发明版本**，让它被 `BASE_VERSION_REQUIRED` 明确拒绝。
这里刻意没有采用"发送前重新读取最新版本"的做法——那会把条件写重新变回无条件写，
正是任务书点名禁止的。

### 回归

`packages/team-server/src/__tests__/pg/conflict-cas.pg-spec.ts`，4 条：

| 用例 | 断言 |
| --- | --- |
| 不提交 baseVersion 时 LOCAL 不得覆盖期间发生的远端更新 | `BASE_VERSION_REQUIRED`，服务端数据仍为 B 的 v6 |
| 缺少 baseVersion 时服务端不得自行用本次读取的版本代替 | 同上（直接防"回退到 `share.version`"复发） |
| 提交过期 baseVersion 必须返回 `CONFLICT_STALE_VERSION` 且不改数据 | 错误码 + 行内容不变 |
| 提交正确 baseVersion 写入成功且版本恰好推进一次 | `version = base + 1`，不是 +2 |

回退验证：

```bash
git show 84f73b0^:packages/team-server/src/sync/sync.service.ts | grep -n 'baseVersion ?? share.version'
```

---

## 2. P9.2-2：敏感数据在客户端根本没有落点

这一条有**三层**，任何一层单独修都不够。

### 第一层：表结构没有这两列

修复前 `connection-schema-team.ts`：

```sql
CREATE TABLE team_shared_hosts (... updated_at INTEGER, dirty INTEGER DEFAULT 0,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE)
```

没有 `is_sensitive`、没有 `encrypted_data`。也就是说**客户端在结构上无法记住一行是不是敏感的**。

修复后：建表语句补两列，并且对已存在的库用 `ALTER TABLE ADD COLUMN` 补齐
（`sharedColumns()` 里的两条迁移项，`is_sensitive INTEGER DEFAULT 0`、
`encrypted_data TEXT`）。老库不会丢数据：默认值把历史行按明文处理，与修复前的行为一致。

### 第二层：`remoteGuard` 只比 `data` 列，导致密文被旧值覆盖

```ts
// 修复前
function remoteGuard(table, dataColumn) {
  return `WHERE (COALESCE(${table}.dirty, 0) = 0 OR ${table}.${dataColumn} = excluded.${dataColumn}) ...`
}
```

敏感行的 `data` **恒为 `{}`**（服务端不存明文）。于是任何一条拉取下来的敏感行，
`data` 与本地完全相同 → 被判定为"内容一样、可以覆盖" → 用**旧密文**盖掉用户刚写的**新密文**。
而 `version` 比较里也有同样的 `data = excluded.data` 分支，同样恒真。

修复后把密文纳入比较：

```sql
AND COALESCE(${table}.encrypted_data, '') = COALESCE(excluded.encrypted_data, '')
```

两个分支（dirty 保护、同版本幂等）都加了。

### 第三层：三条写路径都不携带安全状态

- **pull**（`team-sync-engine.ts`）：`is_sensitive`/`encrypted_data` 随行写入，且
  `remoteVersion` 里也带上 `isSensitive`，让冲突记录本身能证明安全状态。
- **push**（`team-sync-shares.ts`）：敏感行 `data: {}` + `encryptedData`，并显式带 `isSensitive`。
- **resolve**（`buildLocalResolution`）：`isSensitive` 取自**本地存储的行**，
  密文只在敏感行上发送；`RELATIVE` 缺失时返回 `null`，调用方拒绝继续（不猜）。

### 服务端的两道闸

```ts
// packages/team-server/src/sync/share-write-data.ts
function assertPlaintextPayloadHasNoCiphertext(payload) {
  if (payload.isSensitive === false && payload.encryptedData !== undefined) {
    throw new BadRequestException('encryptedData cannot be used when isSensitive is false')
  }
}
```

1. **声明明文却带密文** → `400`，行不动。两个字段互相矛盾时服务端不替任何一方做选择。
2. `resolveConflict` 要求 `clientData.isSensitive` **显式存在**；敏感行没有密文 →
   `SENSITIVE_CIPHERTEXT_REQUIRED`。

并且 `preserveSensitivity = true` 时（LOCAL 冲突解决），**敏感行的 `data` 一律写 `{}`**：

```ts
return existing.isSensitive
  ? { data: {}, encryptedData: payload.encryptedData ?? existing.encryptedData, isSensitive: true, ...permissionData }
  : { data: payload.data as Prisma.InputJsonValue, encryptedData: null, isSensitive: false, ...permissionData }
```

### 回归

`conflict-sensitivity.pg-spec.ts`，6 条，其中两条是**复现用例**（修复前必须红）：

| 用例 | 修复前 | 修复后 |
| --- | --- | --- |
| 前端旧载荷（`isSensitive:false` 且无 baseVersion）把敏感记录降级为明文 | 明文落库 | 拒绝，行保持密文 |
| LOCAL 未显式声明 isSensitive 时不得推断为明文 | 推断成明文 | `SENSITIVE_STATE_REQUIRED` |

另有权限 2 条（LOCAL 不改 `permission`、非创建者不能借冲突解决写入）与
「任一校验失败都保持数据库原状」1 条。

---

## 3. P9.2-3：HTTP 200 里的 `{success:false}` 被当成成功

### 修复前的代码

```ts
// packages/frontend/src/store/team-actions-sync.ts @ 84f73b0^
const result = await teamApi.resolveConflict(...)
if (result.error) { set({ syncError: result.error }); return }
// ...然后无条件过滤掉冲突
set(state => ({ syncConflicts: state.syncConflicts.filter(i => i.shareId !== shareId) }))
```

`ApiResponse.error` 只描述**传输层与 HTTP 状态**。服务端返回 `200 { success: false, error: '...' }`
时它是 `undefined`，于是：

1. 这次解决被当作成功；
2. 冲突从 UI 与 store 里被删掉；
3. 服务端什么都没写。

用户的本地编辑从此既不在冲突列表里，也没有同步上去——**假成功**。

### 修复

新增 `ApiOutcome<T>`（`team-api-types.ts`），把失败原因枚举出来：

| reason | 触发 |
| --- | --- |
| `not-configured` | 没配置 endpoint/token |
| `http` | 非 2xx（**带 status**，因为 404/403/5xx 的恢复方式不同） |
| `network` | fetch 抛错 |
| `timeout` | 15s 超时 abort |
| `invalid-json` | 200 但 body 不是 JSON |
| `missing-data` | 200 但 body 为空 |
| `operation-failed` | 200 且 body 明确 `success !== true` |

`operationResult()` 专门处理"200 也可能是拒绝"的端点。调用方只有 `outcome.ok === true`
才删冲突。

### 关键设计点

`ApiOutcome` 的 `http` 分支带 `status`，"gone (404)" / "no longer allowed (403/401)" /
"temporarily broken (5xx)" 因此可以被调用方**分支处理**，而不是靠匹配错误消息字符串。
P9.2-4 就是靠这个把 404 与其它失败分开的。

---

## 4. P9.2-4：REMOTE 没落盘就删冲突

### 修复前的代码

```ts
async function adoptRemoteShare(get, shareId, remote) {
  if (!hasData(remote.data)) return          // ← 静默返回
  ...
}
// 调用方
if (resolution === 'REMOTE' && conflict !== undefined) {
  const remote = conflict.remoteVersion
  if (typeof remote.version === 'number') {
    await adoptRemoteShare(get, shareId, { version, updatedAt, data })   // ← 没检查返回值
  }
}
set(state => ({ syncConflicts: state.syncConflicts.filter(...) }))       // ← 照样删
```

两个独立缺陷叠在一起：

1. **敏感行永远走空数据分支**：敏感行的 `remoteVersion.data` 在旧代码里是 `{ encrypted: true }`
   （服务端 `checkConflicts` 的占位），`hasData()` 判为有值但内容不是真实快照；
   而 pull 得来的冲突里 `data` 可能是 `{}`（服务端不返回明文），直接早返回。
2. **push-only 冲突完全没有快照**：`conflict.remoteVersion.version` 不是 number，
   整个 `if` 跳过，一个字节都没落盘，然后冲突被删。

### 修复

`adoptRemoteShare` 现在返回 `boolean`，且对敏感行有明确分支：

```ts
if (!remote.isSensitive && !hasData(remote.data)) return false
```

调用方三种来源，优先级从高到低：

1. **冲突里用户实际看到的那份快照**（`conflict.remoteVersion.version` 是 number）——
   **不重读**。重读会拿到比用户同意的更新的版本，等于替用户做了一个他没做的决定。
2. **push-only 冲突**回源 `GET /teams/:id/shares/:id`（`fetchRemoteSnapshot`）。
3. 都没有 → 报错并保留冲突。

`fetchRemoteSnapshot` 把失败分成四类，**只有 `deleted` 会连带清理本地行**：

| reason | 判定 | 处理 |
| --- | --- | --- |
| `deleted` | HTTP 404 | 服务端确实没有了：删本地行 + 删冲突（唯一诚实的收敛） |
| `forbidden` | HTTP 401/403 | 保留冲突 + 报错 |
| `incomplete` | 无 version / 明文却无内容 | 保留冲突 + 报错 |
| `unavailable` | 网络/超时/其它 | 保留冲突 + 报错 |

### 顺带修掉的权限缺陷

旧代码对 **REMOTE 也要求 creator**：

```ts
if (share.sharedBy !== userId) return { success: false, error: 'Only creator can resolve share conflicts' }
```

REMOTE 不写服务端，只是采纳一份自己已经能读到的快照，因此**不需要写权限**。
旧逻辑让非创建者的冲突永远无法解决——这不是安全，是功能死锁。现在检查只对 LOCAL 生效。

### 回归

`dual-client-sync.pg-spec.ts` 的 C3/C4/C5/C6/C7 五条：

- C3 REMOTE 必须真正落库并只推进到服务端版本，然后才删冲突；
- C4 读不到快照时冲突必须保留；
- C5 服务端拒绝解决时冲突必须保留；
- C6 空响应体与非法 JSON 都必须视为失败；
- C7 解决期间服务端又有人写入 → LOCAL 必须被拒绝为过期版本。

---

## 5. P9.2-5：毫秒墙钟不是版本

### 修复前的代码

```ts
if (membership && share.updatedAt.getTime() > item.updatedAt) { /* conflict */ }
```

两个方向的错：

1. **漏判**：同一毫秒内的两次写入，`getTime()` 相等，判为"没冲突"，后来的写入被覆盖。
2. **误判**：客户端时钟比服务端快 → 每个共享都被报成冲突；慢 → 冲突被漏掉。

### 修复

`checkConflicts` 在有 `version` 时以版本为准：

```ts
const agreed = item.version === undefined ? null : classifyBaseVersion(share.version, item.version)
const isConflict = agreed === null || agreed === 'legacy-timestamp'
  ? share.updatedAt.getTime() > item.updatedAt
  : agreed !== 'match'
```

毫秒只保留给**无法证明版本**的旧客户端，且明确注释了为什么它不是契约。

### 回归

`conflict-version-protocol.pg-spec.ts`，5 条：

| 用例 | 要点 |
| --- | --- |
| 同一毫秒内的更新仍必须被判为冲突 | 直接钉死漏判 |
| 版本一致时不得报告冲突，即使墙钟更晚 | 钉死时钟快导致的误判 |
| 服务端版本领先时必须报告冲突，即使客户端墙钟更晚 | 钉死时钟慢导致的漏判 |
| 未证明版本时保留毫秒回退，但只有确实更晚才报冲突 | 旧客户端行为不回归 |
| 敏感记录的冲突报告不得外泄明文 | `remoteVersion.data` 必须是 `{}` |

---

## 6. 五个缺陷的共同形状

不是五个独立 bug，是**两个模式的五次发作**：

| 模式 | 发作处 |
| --- | --- |
| **用"同一次请求里读到的值"当证明** | P9.2-1 的 `share.version` 兜底 |
| **把"没读到"当成"没有变化"** | P9.2-2 的空 `data`、P9.2-3 的 `error === undefined`、P9.2-4 的空快照 |

修复的写法也因此是同一套：**把"无法证明"变成显式的失败**，而不是让它落到某个默认分支。
`BASE_VERSION_REQUIRED`、`SENSITIVE_CIPHERTEXT_REQUIRED`、`incomplete`、`operation-failed`
都是这个原则的产物。

## 7. 复现全部结论

```bash
# 修复前的两处关键代码
git show 84f73b0^:packages/team-server/src/sync/sync.service.ts | grep -n 'baseVersion ?? share.version'
git show 84f73b0^:packages/frontend/src/store/team-actions-sync.ts | grep -n 'syncConflicts.filter'

# 回归（需要真实 PostgreSQL）
pnpm --filter=team-server test:pg

# 只跑本轮新增的四套
pnpm --filter=team-server exec vitest run --config vitest.pg.config.ts \
  src/__tests__/pg/conflict-cas.pg-spec.ts \
  src/__tests__/pg/conflict-sensitivity.pg-spec.ts \
  src/__tests__/pg/conflict-version-protocol.pg-spec.ts \
  src/__tests__/pg/dual-client-sync.pg-spec.ts
```
