# Native GUI E2E — real WebView automation

Status: **macOS and Linux green in CI; Windows harness works but the app fails to start a terminal there**

This document records what was built, what was proven, and what was not.

---

## 1. The problem this solves

Every previous attempt at GUI acceptance in this repository ended in
`NOT_RUN`. The recorded failures were:

| Attempt | Why it failed |
| --- | --- |
| AppleScript `System Events` | Cannot read inside a WKWebView; `window 1 of process "terminal"` is not addressable |
| `AXUIElementSetAttributeValue` | Returns `-25205` (`kAXErrorAPIDisabled`) for this process even when `AXIsProcessTrusted: true` |
| Synthesized `CGEvent` mouse drag | Window size does not change — the events do not reach the Tauri window |
| `⌘B` keystroke | Swallowed by the terminal |

So the repository had "component tests green, real GUI untested".

## 2. What actually works

The WebdriverIO Tauri **embedded** driver provider. It compiles a W3C WebDriver
HTTP server into the app, binds loopback, and lets a standard WebDriver client
drive the real WKWebView.

```
$ curl -s http://127.0.0.1:4445/status
{"value":{"message":"tauri-plugin-webdriver is ready","ready":true}}

$ lsof -nP -iTCP:4445 -sTCP:LISTEN
terminal  72019  ...  TCP 127.0.0.1:4445 (LISTEN)
```

A session against it reports the **real** engine, not a browser shim:

```json
{"browserName":"webkit","browserVersion":"605.1.15","platformName":"macos"}
```

### Version matrix (verified, not assumed)

| Piece | Version | Note |
| --- | --- | --- |
| `tauri-plugin-wdio-webdriver` (crate) | **1.5.1** | MSRV 1.77 — below this repo's 1.96, no toolchain conflict |
| `@wdio/tauri-service` (npm) | **1.5.1** | matches the crate |
| `webdriverio` | 9.31.9 | |
| `tauri-driver` | **not installed, not needed** | It cannot drive macOS WKWebView; embedded bypasses it |

`tauri-plugin-wdio` (the *other* plugin) is deliberately **not** installed — see §4.

## 3. What the harness proves today

`E2E-01` — 6/6 PASS, real macOS build:

- reaches `tauri://localhost/terminal?tab=...` (not `about:blank`)
- exactly one `[data-terminal-workbench]` and one `.xterm`
- waits for a **shell prompt** to appear, polling instead of sleeping
- types a command and sees the shell's own output twice (command line + result),
  which also proves the input was not delivered twice
- reads `142×39` from the status bar — a number xterm's `FitAddon` produced, not
  one this harness computed
- no `panicked at` in the log

`E2E-02` — walks 1440/1280/1024/900/768/640 and **fails at 900**, correctly:

| Width | left | right | Terminal available |
| --- | --- | --- | --- |
| 1440 | column | column | 964px ✓ |
| 1024 | column | column | 548px ✓ |
| **900** | column | **column** | **424px ✗ (< 504px floor)** |
| 768 | column | overlay | ✓ |
| 640 | column | overlay | ✓ |

That 900px row is a **real product defect on `main`**: the dock stays a column
leaving the terminal below its 60-column floor. It is exactly what PR #44's
`chooseLayout` rewrite fixes. No unit test could have found it — the decision
function is only wrong in how its caller measures the window, and only a real
window shows that.

> This is the harness earning its keep on its first run. A GUI suite that finds
> nothing is usually a suite that is not looking.

## 4. Security: the driver cannot reach production

The requirement was a machine-checkable assertion, not a comment.

**`gui-e2e` Cargo feature**
- declared in `src-tauri/Cargo.toml`, **not** in `default`
- `tauri-plugin-wdio-webdriver` is an `optional = true` dependency, so it is not
  in the dependency graph at all without the feature

**`scripts/check-gui-e2e-isolation.mjs`** asserts four facts:

```
PASS  default dependency graph contains no wdio crate — zero matches
PASS  gui-e2e feature actually pulls the driver in — tauri-plugin-wdio-webdriver v1.5.1
PASS  build directory has no wdio artifact from a default build
PASS  gui-e2e is not in default features — default = []
```

The second assertion exists so the gate cannot pass vacuously: if someone deleted
the plugin registration, assertion 2 would fail and the harness would be known
dead rather than silently green.

**What is NOT installed, on purpose**

`tauri-plugin-wdio` would give `browser.tauri.execute()` and mocking. It requires
`withGlobalTauri: true` and `wdio:allow-execute` — both forbidden in a product
build. The embedded `*-webdriver` plugin grants **no IPC permission** (its ACL
set is empty); it is an HTTP server, not a command surface. The W3C
`execute/sync` endpoint it does expose is enough to read xterm's measured size.

Consequence, accepted: the service logs
`Tauri core.invoke not available after 5s timeout` when it tries to query window
state. That warning is the cost of not installing the dangerous plugin.

**Read-only probe**

`packages/frontend/src/features/terminal/gui-e2e-probe.ts` exists because the
terminal renders through WebGL and `.xterm-rows` is empty — the buffer text is
unreachable from the DOM. The probe exposes two reads only: geometry and a text
snapshot. It is gated on `import.meta.env.VITE_TERMINAL_GUI_E2E`, which a
production build never sets; `scripts/run-gui-e2e.mjs` sets it for the harness
build only.

It cannot write, cannot run a shell command, cannot reach a session id, and never
touches credentials or Vault state.

**Isolation**
- `scripts/run-gui-e2e.mjs` creates a throwaway `HOME` and passes it through
  `wdio:tauriServiceOptions.env`; the app cannot see the developer's database,
  Vault or SSH keys
- the profile is deleted after the run
- the WebDriver server binds `127.0.0.1` only

## 5. Keyboard input: the trap

Three approaches were tried before one worked. All three failures looked like
"the app ignored my keystrokes".

| Approach | Result |
| --- | --- |
| `browser.keys(['echo token', 'Enter'])` | typed only `e` — each array element is one key |
| `browser.keys('echo token')` | same |
| per-character `browser.keys(c)` | characters reordered; `gui` arrived as a trailing `g` |

Two separate causes:

1. **`-` is a modifier separator** in WebDriver's key syntax. A token like
   `gui-e2e-123` is parsed as a chord. Tokens must be alphanumeric.
2. **Per-character `keys` races xterm's key handling** and reorders.

What works is `element.addValue()` — the W3C *Element Send Keys* command, which
sends the whole string to the focused element in order. That is still a real
keyboard path (not a DOM injection), and it is what the spec uses.

## 6. The rAF limitation (important, and it is not the product)

The terminal refits through `requestAnimationFrame`. A WKWebView that WebDriver
is driving **does not composite**, so rAF callbacks never fire:

```
BEFORE: 1136  RAF: false  AFTER: {"screenW":1136,"status":"ConnectedLocal142×39"}
```

The window went from 1200 to 700 CSS px, `main` and the workbench shrank to
654px, `.xterm` shrank to 653px — and `.xterm-screen` stayed 1136px because the
`fit()` call is scheduled on a frame that never runs.

**This is an automation-environment property, not a product defect.** A real
user's window composites.

Consequence for acceptance: `REAL_XTERM_COLS` is **PARTIAL**. The value `142×39`
is genuinely xterm's measurement and is read correctly, but the *refit on resize*
path cannot be exercised here. `E2E-02` therefore reports `PARTIAL` rather than
`PASS` when rAF did not run, and says so in its evidence file.

## 6.1 CI 实测结果（run 43564046995，commit 6c3ef77）

| 平台 | Job | 结果 | 说明 |
| --- | --- | --- | --- |
| macOS | `macOS GUI E2E` | **success** | 真实 WKWebView，E2E-01 + E2E-02 全过 |
| Linux | `Linux GUI E2E (informational)` | **success** | Xvfb + WebKitGTK，同样跑通 |
| Windows | `Windows GUI E2E (informational)` | **failure** | 见下 |
| — | `Driver isolation gate` | **success** | 安全隔离门禁 |

### Windows 的实际状态

**跨平台修复全部生效**。与修复前的对比：

| 阶段 | 修复前 | 修复后 |
| --- | --- | --- |
| 前端构建 | 104ms 内静默 exit 1，无输出 | 正常完成 |
| Tauri 构建 | 从未到达 | 正常完成（14 分钟） |
| 二进制 | — | `src-tauri\target\release\terminal.exe` |
| 隔离 profile | — | `C:\Users\RUNNER~1\AppData\Local\Temp\terminal-gui-e2e-...` |
| WebDriver session | 从未到达 | **`msedge 156.0.0.0 windows`** |
| E2E 断言 | — | 失败 |

失败集中在**运行时行为差异**，不是启动：

```
Error: no shell prompt ever appeared in the terminal buffer
Error: window never reached 1440px / 640px
```

即：Windows 上 PowerShell 的提示符形状与 POSIX shell 不同，且 `setWindowSize`
对 Tauri 窗口不生效（与 macOS 上 rAF 受限同类）。

按任务书 §6 的分阶段标准，**第一阶段（构建、启动、建立 session）已达成**；
第二阶段（真实窗口操作断言）Windows 仍 NOT_RUN。

## 7. Not run

| Item | Why |
| --- | --- |
| Windows WebView2 | No Windows host in this session |
| Linux WebKitGTK | No Linux host in this session |
| `DRAWER_GUI_E2E` | The drawer presentation does not exist on `main`; it is PR #44's work. This harness is independent test infrastructure and must not depend on an unmerged branch |
| `HYSTERESIS_GUI_E2E` | Same reason — hysteresis lands with #44, and it is rAF-adjacent |
| `PTY_LIFECYCLE_GUI_E2E` | Needs session-id observation across GUI actions; the read-only probe deliberately does not expose session ids |
| `SFTP_PRODUCT_GUI_E2E` | Needs the OpenSSH fixture wired into the isolated HOME; second phase |

## 8. Running it

```bash
node scripts/run-gui-e2e.mjs                 # build + run everything
node scripts/run-gui-e2e.mjs --no-build      # reuse the current binary
node scripts/run-gui-e2e.mjs --spec specs/e2e-01-startup.e2e.mjs
```

Artifacts land in `e2e/gui/artifacts/<case>/`: a JSON record (platform, git SHA,
binary SHA-256, terminal geometry, window size, DPR, verdict) and a PNG
screenshot captured by WebDriver. Screenshots are written on failure too.

## 9. Mapping to the Terminal Next acceptance matrix

| Matrix item | Case | Status |
| --- | --- | --- |
| Real Tauri GUI click | E2E-01 | **PASS** |
| Real xterm cols | E2E-01 | **PARTIAL** (§6) |
| Layout policy across widths | E2E-02 | **FAIL on main by design** — finds the 900px defect |
| Drawer reachable | E2E-03 | **NOT_RUN** (needs #44) |
| Hysteresis | E2E-04 | **NOT_RUN** (needs #44) |
| PTY lifecycle | E2E-05 | **NOT_RUN** |
| SFTP product path | E2E-06 | **NOT_RUN** |
| Production driver absent | isolation gate | **PASS** |


---

## 10. CI results (run `43566483644`, main `771bf9af`)

| Job | Result | Meaning |
| --- | --- | --- |
| Driver isolation gate | **success** | 5/5 |
| macOS GUI E2E | **success** | E2E-01 6/6, E2E-02 5/5 |
| Linux GUI E2E | **success** | ran for real under Xvfb |
| Windows GUI E2E | **failure** | harness works; the app does not start a shell |

### Windows: the harness is fixed, the app is not

The cross-platform repair did what it was for. The Windows log now shows:

```
[gui-e2e] building frontend with the GUI E2E probe          ← was a 106 ms silent exit
[gui-e2e] binary src-tauri\target\release\terminal.exe     ← .exe resolved
[gui-e2e] isolation env: HOME=. USERPROFILE=. APPDATA=AppData\Roaming
          LOCALAPPDATA=AppData\Local XDG_CONFIG_HOME=.config … ← all five set
```

Every one of those was broken before. The remaining failures are at the
application layer, not the harness:

```
Error: expect(received).toContain(expected)   ← URL never reached /terminal
Error: no shell prompt ever appeared in the terminal buffer
Error: no new prompt appeared after the output
Error: window never reached 1440px
```

So on Windows the app starts, the WebDriver server comes up, and a session is
established — but the terminal never reaches a shell prompt. That is a product
finding this harness produced, and it is **not** something to fix by weakening
the assertion.

`WINDOWS_GUI_E2E` is therefore **FAIL** (it ran and failed), while
`WINDOWS_PROFILE_ISOLATION` is **PASS** (the env is verified on the runner).

### Linux

The Linux job ran under `xvfb-run` and passed. The job name still carries
"(informational)" until it has a few more green runs; the failure mode it guards
against (no display for WebKitGTK) is exactly what Xvfb solves.
