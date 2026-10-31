# Terminal — Modern SSH/SFTP Client

A cross-platform terminal application built with Tauri, React, and TypeScript. Connect to remote servers via SSH, transfer files with SFTP, manage SSH keys, and collaborate with your team — all in a modern, keyboard-driven interface.

## Features

| Feature | Description |
|---------|-------------|
| **SSH Connections** | Password, key-based, and certificate authentication. Jump host support. |
| **SFTP File Transfer** | Dual-pane file browser, drag-and-drop upload/download, progress tracking, checksum verification. |
| **Terminal Emulation** | Full xterm.js integration with search, Unicode 11, ligatures, and WebGL acceleration. |
| **Port Forwarding** | Local (`-L`), remote (`-R`), and dynamic (SOCKS5) port forwarding. |
| **SSH Key Management** | Generate Ed25519/RSA/ECDSA keys, import existing keys, Keychain integration. |
| **Code Snippets** | Save and reuse command snippets with variable substitution. |
| **Command Completion** | Tab completion for commands, paths, hosts, and snippets. |
| **Batch Script Execution** | Run a command across multiple hosts simultaneously. |
| **Team Collaboration** | Share hosts and snippets across a team with encrypted credentials. |
| **Cloud Sync** | Sync data across devices via WebDAV, S3, or a custom REST API. |
| **Multi-tab & Split Pane** | Work on multiple sessions side by side. |
| **Keyboard Shortcuts** | Fully keyboard-driven with customizable shortcuts. |
| **Cross-platform** | Windows, macOS, and Linux. |

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 24.16.x（`.node-version`）
- [pnpm](https://pnpm.io/) 10.34.x（`packageManager`）
- [Rust](https://rustup.rs/) 1.96.0（`rust-toolchain.toml`，含 clippy / rustfmt）

> 三个都是仓库固定版本，`.github/workflows/*.yml` 与 `package.json` 的 `engines` 按它们校验。

### Install

```bash
git clone https://github.com/baicie/terminal.git
cd terminal
pnpm install
```

### Run

```bash
# Full Tauri application (desktop window)
pnpm tauri dev

# Frontend only (web, no SSH/SFTP)
pnpm dev
```

### Build

```bash
# Production build (creates native installer)
pnpm tauri build
```

## Release Artifacts

Release 由 `.github/workflows/release.yml` 在 **8 个原生 runner 打包 job** 上按架构分别打包（6 个 runner 标签：`macos-15`、`macos-15-intel`、`windows-11-arm`、`windows-latest`、`ubuntu-24.04-arm`、`ubuntu-24.04`；macOS 每个架构先编二进制再单独打 DMG，因此是 8 个 job），产出 **8 个安装包 + `SHA256SUMS.txt`**：

| 平台 | 架构 | 目标三元组 | 安装包 |
| --- | --- | --- | --- |
| macOS | Apple Silicon | `aarch64-apple-darwin` | `Terminal_<ver>_macos-aarch64.dmg` |
| macOS | Intel | `x86_64-apple-darwin` | `Terminal_<ver>_macos-x86_64.dmg` |
| Windows | ARM64 | `aarch64-pc-windows-msvc` | `Terminal_<ver>_windows-aarch64-setup.exe`（NSIS） |
| Windows | x64 | `x86_64-pc-windows-msvc` | `Terminal_<ver>_windows-x86_64-setup.exe`（NSIS） |
| Linux | ARM64 | `aarch64-unknown-linux-gnu` | `Terminal_<ver>_linux-aarch64.AppImage` + `.deb` |
| Linux | x64 | `x86_64-unknown-linux-gnu` | `Terminal_<ver>_linux-x86_64.AppImage` + `.deb` |

- macOS **不再合成 universal 包**：两个架构各自 `.app` → 各自 DMG，更新载荷也按架构命名（`Terminal_<ver>_macos-<arch>.app.tar.gz`），否则会互相覆盖。
- Windows 只出 NSIS；Linux 出 AppImage 与 deb（`src-tauri/tauri.conf.json` 里 `targets: "all"` 被工作流的 `--bundles` 覆盖）。
- 发布模式三档：`unsigned-qa`（默认，无签名）、`updater-signed`（加 updater `.sig` 与唯一 `latest.json`）、`fully-signed`（预留，当前命中即失败）。**推送 tag 永远只走 `unsigned-qa`**，需要密钥的模式必须人工 `workflow_dispatch`。
- 当前**没有** Apple Developer ID / 公证、也没有 Windows Authenticode：DMG 与 NSIS 都是未签名产物，Gatekeeper / SmartScreen 会告警。详见 `docs/release-readiness.md`。

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Switch tab |
| `Ctrl+T` | New local terminal |
| `Ctrl+K` | Command palette |
| `Ctrl+W` | Close current tab |
| `Ctrl+\` | Split horizontally |
| `Ctrl+]` | Split vertically |
| `F11` | Toggle fullscreen |

See **Settings → Keyboard Shortcuts** for the full list.

## Project Structure

```
terminal/
├── packages/
│   ├── frontend/          # React + TypeScript frontend
│   │   └── src/
│   │       ├── view/     # Page components (hosts, terminal, sftp...)
│   │       ├── components/ # Reusable UI components
│   │       ├── service/  # SSH, SFTP, storage services
│   │       ├── store/    # Zustand state management
│   │       ├── hooks/    # Custom React hooks
│   │       └── locales/  # i18n (en / fr / cn)
│   └── team-server/      # NestJS team collaboration server
├── src-tauri/            # Rust backend (SSH, SFTP, PTY, storage)
└── docs/                 # Developer documentation
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite |
| UI | shadcn/ui, Tailwind CSS, Radix UI |
| Terminal | xterm.js |
| Backend | Tauri 2.x (Rust) |
| SSH/SFTP | russh |
| State | Zustand |
| Storage | SQLite (local), WebDAV / S3 / REST API (remote) |

## Development

```bash
# Run all tests
pnpm test

# Lint and format
pnpm lint
pnpm format

# Bundle analysis
pnpm analyze:bundle
```

For architecture details, API references, and contributing guidelines, see the [developer docs](docs/).

## License

MIT
