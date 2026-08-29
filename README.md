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

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) 8+
- [Rust](https://rustup.rs/) 1.70+ (for Tauri)

### Install

```bash
git clone https://github.com/your-repo/terminal.git
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
│   │       ├── store/    # MobX state management
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
| State | MobX |
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
