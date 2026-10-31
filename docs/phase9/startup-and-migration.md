# 启动与迁移（P9.0）

## 1. #59 的两层根因

应用能创建 terminal.db，但 schema 初始化从不完成。定位靠的是**启动阶段插桩**，不是读代码。

### 第一层：pragma 表值函数不能用绑定参数

    await select("SELECT name FROM pragma_table_info(?)", [table])

pragma 的参数在语句**预处理阶段**求值，绑定参数不可达。真实插件在 macOS 与 Linux 上都拒绝，
且拒绝值不是 Error 对象——所以日志里只有 error=undefined。

### 第二层：对象方法被取出后脱离实例调用

    const select = database.select          // 接收者丢失
    await select("SELECT ...", [table])

插件的 select 是类方法，内部读 this.path，脱离后抛 undefined is not an object (evaluating this.path)。

### 为什么两层都躲过了单测

**mock 比真实实现宽松**：mock 接受任意参数（第一层），且是普通函数不依赖 this（第二层）。
测试验证的是「我以为的接口」，不是「真实的接口」。

### 为什么同类 bug 出现了两次

第一层修好后我只改了 core 模块，没普查 team 模块，于是同一个 bug 在下一个阶段又挡住启动。
**修一处不等于修一类。** 现在已对全仓做过普查（无未绑定方法取用、无参数化 pragma）。

## 2. 启动阶段插桩

新增两条 Rust 命令（`startup_stage` / `startup_stage_failed`），把阶段写入所有平台的应用日志：

    db-load-started / db-pool-registered / pending-migrations-detected /
    snapshot-started / vacuum-into-started / vacuum-into-finished /
    snapshot-verification-finished / core-schema-finished / ready

设计取舍：追踪是 fire-and-forget（绝不能成为启动失败的原因）；**只在真实 Tauri 环境启用**
（单测会精确断言 invoke 调用次数以校验 bootstrap 顺序）。

## 3. 迁移前快照

保留「快照失败禁止迁移」这条安全不变量，**没有**通过忽略快照错误或改用空库来绕过问题。

- 快照用 VACUUM INTO + 只读重开校验（integrity、列清单、行数）
- 失败则一条 CREATE/ALTER 都不发
- 保留策略：MAX_SNAPSHOT_COPIES = 5。守卫三条：不递归、只认普通文件、名字严格匹配 pre-migration-<数字>[-n].db；
  按文件名 epoch-ms 排序而非 mtime；删除失败只 warn，**函数不返回 Result，结构上不可能阻断迁移**

## 4. 迁移错误分类

只放行 duplicate-column，且按**错误消息**分类而不是 SQLITE_ERROR 码——
该码与 disk I/O error / database is locked / readonly database 共用，按码判断等于继续吞错。

## 5. 迁移漂移

PostgreSQL 把 `pg_current_xact_id()::text::bigint` 规范化成 `((pg_current_xact_id())::text)::bigint`，
而 schema.prisma 写的是前者，Prisma 认为不一致 → CI 的「Verify migrated database matches schema」失败。
对齐 dbgenerated 后 No difference detected。

## 6. 未验证

- Windows 上的 Vault 路径与权限行为（无 Windows 本机环境）
- 跨版本升级（vN → vN+1），CI 只构建一个版本 → NOT_RUN