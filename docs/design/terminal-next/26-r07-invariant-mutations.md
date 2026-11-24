# R07 — T14/T15 不变量的变异测试

> 要求：每个变异要记录**实际红测试**，不能使用空转测试、注释型变异或未触达调用路径的 mock。

六个不变量，全部执行；两个存活变异已定位原因并分别处理。

---

## 一、总表

| # | 不变量 | 变异 | 结果 | 变红的测试 |
| --- | --- | --- | --- | --- |
| 1 | 同目标冲突 | `contested = false`（恒不冲突） | **红 4 项** | 见 §二 |
| 2 | 校验期间的 session claim | `readHold = null`（不取读 claim） | **红 2 项** | 见 §三 |
| 3 | 重复启动幂等 | 删 `startedIds.has()` 守卫 | **存活** | 死代码，见 §四 |
| 4 | 迟到哈希隔离 | 删 `verifyingIds.add(id)` | **红 1 项** | 见 §五 |
| 5 | 校验失败 → INDETERMINATE | `failChecksum` 记成 `success: true` | **存活 → 补测后红** | 见 §六 |
| 6 | 移除记录不影响在途校验 | `applied` 守卫换成 `if (args)` | **存活** | 多层防线，见 §七 |

---

## 二、变异 1：`contested` 恒 false

```diff
- const contested =
-   target === null || contendedAtStart ||
-   isContended(targetKeyOf(target), 'writers') ||
-   completionsOf(targetKeyOf(target)) > completionsAtStart
+ const contested = false
```

实际变红 4 项：

```
× a first transfer whose path was overwritten mid-check cannot claim verified
× a write in progress blocks certification even before it finishes
× a write that finishes during the check is caught as before
× records an explicit reason rather than throwing its way to indeterminate
```

第一条与第二条是核心：**写入进行中**就必须阻止认证，而不仅是写入完成后。

---

## 三、变异 2：不取读 claim

```diff
- const readHold = target ? beginRead(target) : null
+ const readHold = null
```

实际变红 2 项：

```
× a first transfer whose path was overwritten mid-check cannot claim verified
× a write that finishes during the check is caught as before
```

第二项正是读 claim 的职责：一个在检查窗口内完成的写入，只有读 claim 还在时才能被
`isContended(...)` 观察到。

---

## 四、变异 3：重复启动守卫 —— **存活，因为它是死代码**

删掉后 32/32 全过。查了可达性：

```ts
function nextQueued(skip: Set<string>): TransferRecord | undefined {
  for (...) {
    const record = transfers[index]
    if (record.status === 'queued' && !skip.has(record.id)) return record
  }
}
```

`nextQueued` 只返回 `status === 'queued'` 的记录。而 `startedIds` 的成员在 `startRun` 之前
已经 `transition(id, 'running')`，不再是 `queued`。所以「已被启动却还在 queued」这个前提
在当前状态机下不可达。

**判定：防御性死代码。不为它伪造测试。** 如果将来有路径能把记录重置回 `queued` 而不清
`startedIds`，这个守卫就是唯一拦住重复执行的东西——保留，但不声称它有测试覆盖。

---

## 五、变异 4：迟到哈希隔离

```diff
- verifyingIds.add(id)
+ // removed
```

实际变红 1 项：

```
× clearFinished removes a verifying record without leaking its tracking
```

---

## 六、变异 5：**存活，补测后变红**

```diff
  useTransferQueue.getState().setChecksumResult(id, 'remote', {
-   success: false,
-   error: message,
+   success: true,
  })
```

原有 7 项全过。原因查清了：`checksumVerdict` 从不读 `success`，它只看
`localStatus` / `remoteStatus`。而 `success: true` 且无 `hash` 会得到
`remoteStatus: 'done'` + 空 hash → 派生函数把「done 但无 hash」当成 malformed →
`indeterminate`。

**这是一层偶然的第二防线，不是第一道。** 第一道应该是「这次检查根本没跑」要被记录成
错误。补了一个直接断言该契约的用例：

```ts
it('a session that is closing makes the check fail with an explicit reason', ...)
```

断言四件事：`remoteStatus === 'error'`、verdict 是 `indeterminate`、
`failedSide === 'remote'`、error 文案能被用户读懂（`/connection/i`），
并且两个昂贵的 hash **从未被调用**。

重新应用变异 5 后，新用例变红：

```
× a session that is closing makes the check fail with an explicit reason
```

---

## 七、变异 6：`applied` 守卫 —— 存活，有三层防线

```diff
- if (applied && args) handOffVerification(id, args)
+ if (args) handOffVerification(id, args)
```

全过。逐层查证：

| 层 | 机制 | 有覆盖？ |
| --- | --- | --- |
| 1 | `transition` 对非法状态返回 false | 是 |
| 2 | `settle()` 删 `pendingArgs`，第二次 done 时 `args` 是 `undefined` | **是**（变异 6c 红 2 项） |
| 3 | `applied &&` 守卫 | **否** |

变异 6c（不删 `pendingArgs`）变红 2 项：

```
× 100 个任务跑完后没有幽灵任务或槽位泄漏
× 取消排队任务是真的取消：后端从未收到该任务
```

结论：`applied` 是**冗余的第三道防线**。与 §四 不同的是，这一处的注释写明了它的理由
（「重复 done 不得第二次哈希远端文件」），且那条理由在层 2 被破坏时是真实的保护。保留，
不声称有直接覆盖。

---

## 八、顺带修掉一处冗余

`verifyChecksum` 的 promise 链上有**两个连续的 `.finally()`**，第一个已经
`verifyingIds.delete(id)` + `claim.release()`，第二个又做一遍。这是我在 R01 的改动
（`3f75b51`）里引入的。

`claim.release()` 是幂等的（源码里有注释与 `released` 标志），所以它不是功能缺陷 ——
但它是「同一个清理写两遍」的形态，读代码的人会以为第二个 finally 还有别的职责。
已删除重复的那个，33 项相关测试仍全过。

---

## 九、判定

```
SAME_TARGET_CONFLICT_GUARDED          = PASS（变异 1 红 4）
SAME_TARGET_IN_FLIGHT_WRITE_VISIBLE   = PASS（变异 1 第 2 条 + 变异 2 第 2 条）
READ_CLAIM_DURING_VERIFICATION        = PASS（变异 2 红 2）
DUPLICATE_DONE_IDEMPOTENCE            = PASS（既有测试；变异 6c 红 2）
LATE_HASH_ISOLATION                   = PASS（变异 4 红 1）
CHECK_FAILURE_IS_INDETERMINATE        = PASS（补测后变异 5 红 1）
RECORD_REMOVAL_DOES_NOT_CANCEL_CHECK  = PASS（T15 既有测试）
DUPLICATE_START_GUARD                 = NOT_COVERED（死代码，不伪造测试）
APPLIED_GUARD                         = NOT_COVERED（第三道防线，上游两层有覆盖）
```

service 层全量：**75 文件 / 712 项通过**。
