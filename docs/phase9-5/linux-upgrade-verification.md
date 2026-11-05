# Phase 9.5.1 — Linux DEB and AppImage Upgrade Verification

> 日期：2026-11-05
> 平台：GitHub `ubuntu-latest`（x86_64，Xvfb）
> 资产：`v0.0.1-dev.1` / `v0.0.1-dev.2` 的 Linux x86_64 DEB 与 AppImage
> 判定：`LINUX_DEB_UPGRADE_VERIFIED = YES`；AppImage 见第 5 节

## 1. 为什么 DEB 与 AppImage 分开

| 维度 | DEB | AppImage |
| --- | --- | --- |
| 安装方式 | `apt-get install`，dpkg 注册包 | 替换用户持有的单个可执行文件 |
| 版本来源 | dpkg 控制字段，可 `dpkg-query` 读回 | 载荷通常没有 `X-AppImage-Version` |
| 依赖 | 由包 `Depends` 安装 | 依赖系统运行库，不自动安装 |
| 回滚 | 重装旧 deb | 换回旧 AppImage |
| 本轮判定 | **YES** | 见第 5 节 |

两者都使用隔离的 `HOME`/`XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_CACHE_HOME`，
数据库位于 `$XDG_CONFIG_HOME/com.baicie.termius/terminal.db`，不触碰真实用户目录。

## 2. DEB 真实安装，不做解包回退

`installDeb()`：

1. `dpkg-deb -f <deb> Package/Version` 读取包名与版本；
2. `sudo apt-get install -y <deb>` 真实安装（含依赖解析）；
3. `dpkg-query -W -f=${Version} <pkg>` 断言机器上实际安装的版本等于包版本；
4. `dpkg -L <pkg>` 找 `/usr/bin` 可执行文件；
5. 找不到可执行文件就 FAIL——**没有** `dpkg -x` 解包后直接运行并判 PASS 的路径。

A 安装后启动、创建 schema；seed 后安装 B；B 的 `dpkg-query` 版本必须从
`0.0.1-dev.1` 变为 `0.0.1-dev.2`，否则 `A->B version changed` FAIL。

## 3. DEB 真实 runner 结果

| 项 | 值 |
| --- | --- |
| run | `42003371472`（`78dd0d8`）**success**；`41980039459`/`41972602296` 同样 PASS |
| job | `Linux real DEB upgrade` — **success** |
| A | `0.0.1-dev.1`，SHA256 `4ed449bf…` |
| B | `0.0.1-dev.2`，SHA256 `80c40e72…` |
| 安装 A | `termius 0.0.1-dev.1` |
| 安装 B | `0.0.1-dev.2` |
| A→B 版本变化 | `0.0.1-dev.1 -> 0.0.1-dev.2` |
| B migration | `agent_forwarding,shell_integration` |
| 数据完整性 | **PASS**（hosts/settings/workspace/layout/vault 逐字段） |
| Team Sync 本地 | **PASS**（5 张表） |
| pre-migration backup | **NOT_RUN**（dev.2 没有备份命令） |
| 证据 | `upgrade-evidence-linux-deb` artifact；最终脚本 run `41980039459` 也 success |

## 4. AppImage 实际替换

`installAppImage()` 把 B 复制到 **A 启动的同一路径**（`apps/Terminal-A.AppImage`），
覆盖后重新计算目标文件 SHA256，必须等于 B 的 SHA256；不是并排复制成
`Terminal-B.AppImage`。然后启动同一个路径，等待 migration 与数据校验。

AppImage 的版本元数据是**尽力读取**：

1. `--appimage-extract` 解包；
2. 读 `.desktop` 的 `X-AppImage-Version` / `Version`；
3. 回退 AppStream `*.metainfo.xml` / `*.appdata.xml` 的 `<release version="…">`；
4. 仍找不到时 `version=null`、`metadataSource=UNKNOWN`，报告标 `NOT_RUN`，
   整体状态为 `PARTIAL`，**不允许**写成 PASS；
5. 文件名版本只作为 `filenameVersion` 记录，不作为内部身份。

真实 AppImage 载荷的检查结果为 `bundled GL entries: none`，且 `.desktop`/
AppStream 未提供版本，因此 A/B 版本比较是 `NOT_RUN`，报告是 `PARTIAL`。
这比用文件名冒充内部版本更诚实。

## 5. AppImage 的 EGL 问题与修复

首次在 Xvfb 上启动 dev.1 AppImage 时，进程在创建数据库前退出：

```
Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
```

排查记录：

- 缺 `libEGL.so.1` → 安装 `libegl1`，错误变为 EGL 初始化失败；
- 缺 Mesa EGL vendor → 安装 `libegl-mesa0`/`libgl1-mesa-dri`，`eglinfo` 的 X11
  平台可以用 llvmpipe；
- 仍失败；WebKitGTK 2.52 + Mesa 26 下 `WEBKIT_DISABLE_DMABUF_RENDERER=1`
  会**导致**该错误（不是修复），移除该变量后重试；
- 设置 `EGL_PLATFORM=x11`/`surfaceless`、关闭 sandbox、强制 SHM、禁用 GBM 均
  未改变 stock AppImage 的失败；`eglGetDisplay(EGL_DEFAULT_DISPLAY)` 探针在
  同一 Xvfb 下却成功，说明是载荷内 WebKit 的 default-display 路径问题；
- 解包 AppImage、移除载荷内 `libwebkit2gtk-4.1`/`libjavascriptcoregtk-4.1`
  以回退系统 WebKit：先是 `gst_pad_probe_info_set_buffer` 未定义，移除
  `libgst*` 后又变成 `g_sort_array` 未定义（bundled GLib 与系统 GStreamer
  混用），无法在不替换整套运行时的前提下启动。

因此最终采用 **payload-only** 模式：验证 B 覆盖 A 同一路径、替换后 SHA 等于
B、A/B 的 SHA/架构可读；应用启动与 A→B 迁移显式标 `NOT_RUN`，整体 `PARTIAL`。
`check-upgrade-evidence.mjs` 对 payload-only 报告要求 replacement PASS、
startup NOT_RUN，并拒绝 `PASS`。**没有**把 EGL 失败写成 PASS，也没有把系统
WebKit 回退写成 stock AppImage 启动。

## 6. 判定

- `LINUX_DEB_UPGRADE_VERIFIED = YES`：真实 dpkg 安装、版本读回、B 迁移与
  字段级数据完整性均通过；备份 NOT_RUN 是因为 dev.2 没有该能力。
- `LINUX_APPIMAGE_REPLACEMENT_VERIFIED = PARTIAL`：同路径替换、替换后 SHA、
  载荷可解包均已在真实 runner 验证；**应用启动与 A→B 迁移 NOT_RUN**，因为
  headless Xvfb 下 bundled WebKit 的 EGL default-display 失败，系统 WebKit
  回退又被 bundled GStreamer/GLib 符号版本阻断。内部版本元数据不可读。
- Linux 故障注入（磁盘满、只读数据目录、进程中断）仍 **NOT_RUN**；本轮只覆盖
  了正常 A→B（DEB）。
