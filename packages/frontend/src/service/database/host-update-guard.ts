/**
 * 确认一次 UPDATE 真的落到了行上。
 *
 * ## 为什么必须检查
 *
 * sqlx 按占位符个数位置绑定、**忽略多余参数**，不会报错（`host-update-args.test.ts`
 * 记下了这条链路：参数错位曾让 `WHERE id = ?` 收到 `agent_forwarding`，UPDATE 匹配
 * 0 行，而调用方照样删掉了 vault 里的旧版本——用户的凭据消失，行却仍指向它）。
 *
 * 参数错位已修，但**结果没修**：并发删除、拼错的 id、绑定行为变化都会走到同一个
 * 终点。所以在删除任何旧秘密之前，这里要求 UPDATE 真的影响了一行。
 *
 * 缺失的 `rowsAffected`（mock、插件版本变化、包装层）按「已匹配」处理——把一个
 * 缺失字段读成 0 会让每一次正常保存都抛错。
 */
export function assertRowUpdated(result: unknown, id: string): void {
  const affected = (result as { rowsAffected?: unknown } | undefined)?.rowsAffected
  if (typeof affected === 'number' && affected === 0) {
    throw new Error(
      `Host ${id} no longer exists, so the update matched no row and nothing was changed`,
    )
  }
}
