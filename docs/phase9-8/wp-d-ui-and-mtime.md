# Phase 9.8-D — SFTP 修改时间与 UI 收口

分支 `feat/phase9-8-d-ui-readiness`，base `feat/phase9-7-product-acceptance`。

## 根因

`sftp_list` 把 `metadata.accessed()`（atime）写进 `modified_time`。atime 在每次读取
时变化，启用 `relatime` 的服务端甚至不更新它——列表显示的“修改时间”与文件真实
修改时间无关。服务端不提供时间时旧代码写 `0`，界面显示 1970-01-01，这是一个伪造
的精确时间。

## 修复

- `src-tauri/src/sftp.rs`：改用 `metadata.modified()`；新增
  `modified_time_secs()`，服务端不提供或时间早于 epoch 时返回 `None`；
- `SftpFileItem.modified_time` 改为 `Option<i64>`（序列化为 `null`）；
- 前端类型改为 `number | null`；表格显示 `—`（不显示假日期）；排序把未知时间
  排在有时间的文件之后。

测试：`the_listing_uses_the_real_modification_time_or_none`（正常时间、无时间、
epoch 之前三种情况）；前端 `tsc` 与 SFTP 组件测试通过。

## 本地化回归门禁

新增 `packages/frontend/src/locales/parity.test.ts`：cn / fr 必须与 en 拥有**完全相同
的键集合**，且任何语言不得有空字符串。缺键会退回键名（用户看到
`settings.saveFailed` 这类文本），只抽查样例永远发现不了——因此比较完整键集。

## UI 验证状态

| 项 | 状态 | 说明 |
| --- | --- | --- |
| Hosts / Terminal / SFTP / Vault / Settings / Teams 真实桌面截图 | **NOT_RUN** | 本机 `screencapture -x` 只得到壁纸（无任何应用窗口），Screen Recording 权限未授予；不声称真实 Tauri GUI 已验收 |
| 浏览器级布局检查 | **NOT_RUN** | 前端没有 browser mock 入口：挂载即调用 Tauri `invoke`/SQLite，脱离 Tauri 会停在启动门禁 |
| 窄屏 / Light-Dark / 三语 静态检查 | **PASS（静态）** | 断点类（`sm:` / `md:`）在改动文件保留；新增文案均走 i18n；parity 测试覆盖三语键集 |
| 对话框焦点 / Esc / 未保存确认 | **PASS（既有无回归）** | Phase 9.7 的 Host Dialog 与 Vault 修复测试仍在套件中并通过 |
| 失败态 / 空状态 | **PASS（既有无回归）** | Settings/Hosts 失败态测试、空状态组件未改动 |

## 验收判定

| 项 | 判定 |
| --- | --- |
| SFTP 列表使用真实修改时间 | **PASS** |
| 未知时间不被伪造成 1970 | **PASS** |
| 三语键集一致 | **PASS** |
| 真实 GUI 截图 | **NOT_RUN（权限）** |

## 边界与后续

- 真实截图需要在具备 Screen Recording 与 Accessibility 权限的机器/runner 上补采；
  本仓库现有 real-machine matrix 的截图类步骤同样受此限制。
- 单元格显示与排序的可访问性未新增自动化断言（表格无既有渲染测试）。
